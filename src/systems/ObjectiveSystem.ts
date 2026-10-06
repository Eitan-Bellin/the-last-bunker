import type { BuildingType, GameState, ResourceType, RuinKind } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { ResourceSystem } from './ResourceSystem';
import { bus } from '../core/EventBus';
import { RESEARCH, REFINEMENTS, refinementResearch } from '../data/research';
import { getDef } from '../data/buildingDefs';
import { MAX_FLOORS } from '../data/zones';
import { refinementLevel, researchCount } from './ResearchSystem';
import { COSMETICS, WEEKLY_CREDITS, challengeProgress, getChallenge, pickChallenge, snapshot, weekKey, type ChallengeDef } from '../data/challenges'; // [LateGame B4]

export type ObjectiveAction =
  | { kind: 'build'; type: BuildingType }
  | { kind: 'ruin'; restoresTo?: BuildingType; ruinKind?: RuinKind; lore?: string }
  | { kind: 'people' }
  | { kind: 'research' }
  | { kind: 'surface' }
  | { kind: 'journal' }
  // [Q2] Where the guide sends the player (see src/systems/Guide.ts).
  | { kind: 'projects' }
  | { kind: 'dig' }
  | { kind: 'rooms' }
  | { kind: 'ruins' }
  | { kind: 'command' }
  | { kind: 'genesis' }
  | null;

export interface Objective {
  id: string;
  icon: string;
  text: Record<string, string>;
  progress: (s: GameState) => [number, number];
  reward: Partial<Record<ResourceType, number>>;
  action: ObjectiveAction;
  /** Skipped silently when it can no longer apply (e.g. bunkers that never had ruins). */
  skipIf?: (s: GameState) => boolean;
  /** Relative goals: the counter whose value is saved as the baseline when the step begins. */
  metric?: (s: GameState) => number;
}

const has = (s: GameState, t: BuildingType) => s.buildings.some(b => b.type === t);
const ready = (s: GameState, t: BuildingType) => s.buildings.some(b => b.type === t && !(b.isConstructing && b.level === 1));
const staffed = (s: GameState, t: BuildingType) => s.buildings.some(b => b.type === t && b.assignedSurvivorIds.length > 0);
const researched = (s: GameState) => Object.values(s.research).filter(r => r.completed).length;
const explored = (s: GameState) => s.explorationMap.filter(h => h.explored).length - 1;
const bool = (v: boolean): [number, number] => [v ? 1 : 0, 1];
const noRuinFor = (s: GameState, t: BuildingType) => !has(s, t) && !s.ruins.some(r => r.restoresTo === t);
const noRuins = (s: GameState) => s.ruins.length === 0 && (s.ruinsCleared ?? 0) === 0;

const ONBOARDING: Objective[] = [
  {
    id: 'restoreGenerator', icon: '[[generator]]', reward: { materials: 20 }, action: { kind: 'ruin', restoresTo: 'generator' },
    text: { he: 'שקמו את הגנרטור הישן ב־B3 (הקישו על החדר ההרוס)', en: 'Restore the old generator on B3 (tap the wrecked room)' },
    progress: s => bool(ready(s, 'generator')),
    skipIf: s => noRuinFor(s, 'generator'),
  },
  {
    id: 'firstNote', icon: '[[note]]', reward: { food: 20, water: 20 }, action: { kind: 'ruin', lore: 'welcome' },
    text: { he: 'פנו את ההריסות ב־B1. מישהו השאיר שם משהו', en: 'Clear the rubble on B1. Someone left something there' },
    progress: s => bool(s.lore.includes('welcome')),
    skipIf: s => !s.lore.includes('welcome') && !s.ruins.some(r => r.lore === 'welcome'),
  },
  {
    id: 'readNote', icon: '[[journal]]', reward: { materials: 10 }, action: { kind: 'journal' },
    text: { he: 'קראו את הפתק ביומן', en: 'Read the note in the journal' },
    progress: s => bool(s.lore.length > 0 && (s.loreUnread?.length ?? 0) < s.lore.length),
    skipIf: s => s.lore.length === 0 && noRuins(s),
  },
  {
    id: 'pump', icon: '[[water]]', reward: { materials: 15 }, action: { kind: 'ruin', restoresTo: 'waterPump' },
    text: { he: 'שקמו את משאבת המים ב־B2', en: 'Restore the water pump on B2' },
    progress: s => bool(ready(s, 'waterPump')),
    skipIf: s => noRuinFor(s, 'waterPump'),
  },
  {
    id: 'farm', icon: '[[farm]]', reward: { materials: 20 }, action: { kind: 'ruin', restoresTo: 'farm' },
    text: { he: 'שקמו את החווה ב־B2. הזרעים עוד שם', en: 'Restore the farm on B2. The seeds are still there' },
    progress: s => bool(ready(s, 'farm')),
    skipIf: s => noRuinFor(s, 'farm'),
  },
  {
    id: 'staff', icon: '[[worker]]', reward: { food: 25, water: 25 }, action: { kind: 'people' },
    text: { he: 'שבצו עובדים בחווה ובמשאבה', en: 'Assign workers to the Farm and the Pump' },
    progress: s => [Number(staffed(s, 'farm')) + Number(staffed(s, 'waterPump')), 2],
  },
  {
    id: 'generator', icon: '[[power]]', reward: { materials: 20 }, action: { kind: 'people' },
    text: { he: 'שבצו עובד בגנרטור (B3)', en: 'Assign a worker to the Generator (B3)' },
    progress: s => bool(staffed(s, 'generator')),
  },
  {
    id: 'drain', icon: '[[wave]]', reward: { scrap: 20 }, action: { kind: 'ruin', ruinKind: 'flooded' },
    text: { he: 'נקזו אזור מוצף ב־B3', en: 'Drain a flooded area on B3' },
    progress: s => bool(!s.ruins.some(r => r.flooded) || s.ruins.filter(r => r.flooded).length < 4),
    skipIf: s => !s.ruins.some(r => r.flooded) && noRuins(s),
  },
  {
    id: 'workshop', icon: '[[workshop]]', reward: { materials: 25 }, action: { kind: 'ruin', restoresTo: 'workshop' },
    text: { he: 'הצילו את הסדנה מהמים (B3)', en: 'Rescue the workshop from the water (B3)' },
    progress: s => bool(ready(s, 'workshop')),
    skipIf: s => noRuinFor(s, 'workshop'),
  },
  {
    id: 'lab', icon: '[[laboratory]]', reward: { knowledge: 15 }, action: { kind: 'build', type: 'laboratory' },
    text: { he: 'בנו מעבדה (B3)', en: 'Build a Laboratory (B3)' },
    progress: s => bool(has(s, 'laboratory')),
  },
  {
    id: 'hazmat', icon: '[[gasmask]]', reward: { scrap: 20 }, action: { kind: 'research' },
    text: { he: 'חקרו "חליפות מגן"', en: 'Research "Hazmat Suits"' },
    progress: s => bool(!!s.research['hazmatSuits']?.completed),
  },
  {
    id: 'expedition', icon: '[[surface]]', reward: { materials: 40 }, action: { kind: 'surface' },
    text: { he: 'השלימו משלחת ראשונה לפני השטח', en: 'Complete a first expedition to the surface' },
    progress: s => [Math.min(1, s.stats.totalMissionsCompleted), 1],
  },
  {
    id: 'pop5', icon: '[[people]]', reward: { food: 40 }, action: null,
    text: { he: 'הגיעו ל־5 ניצולים (קבלו נוודים או מצאו מחנות)', en: 'Reach 5 survivors (accept wanderers or find camps)' },
    progress: s => [Math.min(5, s.survivors.length), 5],
  },
  {
    id: 'canteen', icon: '[[canteen]]', reward: { materials: 40 }, action: { kind: 'ruin', restoresTo: 'canteen' },
    text: { he: 'החזירו לחיים את חדר האוכל (B1)', en: 'Bring the canteen back to life (B1)' },
    progress: s => bool(ready(s, 'canteen')),
  },
  {
    id: 'upgrade', icon: '[[up]]', reward: { materials: 50 }, action: null,
    text: { he: 'שדרגו חדר כלשהו לרמה 3 (המראה שלו ישתנה)', en: 'Upgrade any room to level 3 (it will look restored)' },
    progress: s => bool(s.buildings.some(b => b.level >= 3)),
  },
  {
    id: 'radio', icon: '[[radioTower]]', reward: { knowledge: 30 }, action: { kind: 'research' },
    text: { he: 'בנו חדר רדיו (דורש מחקר)', en: 'Build a Radio Room (needs research)' },
    progress: s => bool(has(s, 'radioTower')),
  },
  {
    id: 'research5', icon: '[[research]]', reward: { blueprints: 1 }, action: { kind: 'research' },
    text: { he: 'השלימו 5 מחקרים', en: 'Complete 5 researches' },
    progress: s => [Math.min(5, researched(s)), 5],
  },
];

/** Objective ids of the onboarding before the restoration update, for migrating old saves. */
const LEGACY_IDS = ['farm', 'pump', 'staff', 'generator', 'workshop', 'lab', 'hazmat', 'expedition', 'pop5', 'canteen', 'upgrade', 'radio', 'research5'];

/** Hexes still unexplored (the home hex counts as explored). */
const unexplored = (s: GameState) => s.explorationMap.filter(h => !h.explored).length;
const totalLevels = (s: GameState) => s.buildings.reduce((sum, b) => sum + b.level, 0);
/** Nothing left to build or upgrade: every room is maxed and there is no level left to dig. */
const bunkerMaxed = (s: GameState) => s.currentFloors >= MAX_FLOORS
  && s.buildings.every(b => b.level >= (getDef(b.type)?.maxLevel ?? b.level));
/** Some research can still be done: an unfinished fixed node, or a refinement level the storage can hold. */
const researchLeft = (s: GameState) => RESEARCH.some(r => !s.research[r.id]?.completed)
  || REFINEMENTS.some(ref => Object.entries(refinementResearch(ref, refinementLevel(s, ref.id)).cost)
    .every(([r, v]) => (s.resources[r as ResourceType]?.cap ?? Infinity) >= (v ?? 0)));

/**
 * Endless goals after onboarding: four tracks that cycle with rising targets.
 * Targets are relative ("N more from now", baseline saved in `objectiveBase` when the step begins),
 * so a player who is ahead never gets a goal that is already done, and they are capped by what is
 * left (map, research), with tracks that have run out skipped, so the chain never dead-ends.
 */
function dynamicObjective(i: number, step: number): Objective {
  const tier = Math.floor(i / 4) + 1;
  const relative = (metric: (s: GameState) => number, target: (s: GameState, base: number) => number) => ({
    metric,
    progress: (s: GameState): [number, number] => {
      const base = s.objectiveBase?.step === step ? s.objectiveBase.value : metric(s);
      const n = Math.max(1, target(s, base));
      return [Math.max(0, Math.min(n, metric(s) - base)), n];
    },
  });
  switch (i % 4) {
    case 0: {
      // Arrivals and births both count; the head count itself can dip when people die or leave.
      const n = Math.min(2 + tier, 10);
      return {
        id: `dyn-pop-${tier}`, icon: '[[people]]', reward: { food: 40 * tier, water: 40 * tier }, action: null,
        text: { he: `קבלו עוד ${n} ניצולים לבונקר`, en: `Welcome ${n} more survivors` },
        ...relative(s => s.stats.totalSurvivorsRecruited, () => n),
      };
    }
    case 1: {
      const n = Math.min(2 + tier * 2, 16);
      return {
        id: `dyn-explore-${tier}`, icon: '[[map]]', reward: { scrap: 30 * tier }, action: { kind: 'surface' },
        text: { he: `חקרו עוד ${n} משושים בשטח`, en: `Explore ${n} more surface hexes` },
        ...relative(s => Math.max(0, explored(s)), (s, base) => Math.min(n, s.explorationMap.length - 1 - base)),
        skipIf: s => s.explorationMap.length > 0 && unexplored(s) === 0,
      };
    }
    case 2: {
      const n = Math.min(3 + tier * 2, 20);
      return {
        id: `dyn-levels-${tier}`, icon: '[[up]]', reward: { materials: 80 * tier }, action: null,
        text: { he: `הוסיפו עוד ${n} רמות חדרים (בנייה או שדרוג)`, en: `Add ${n} more room levels (build or upgrade)` },
        ...relative(totalLevels, () => n),
        skipIf: bunkerMaxed,
      };
    }
    default: {
      const n = Math.min(1 + tier, 6);
      return {
        id: `dyn-research-${tier}`, icon: '[[research]]', reward: { knowledge: 40 * tier }, action: { kind: 'research' },
        text: { he: `השלימו עוד ${n} מחקרים`, en: `Complete ${n} more researches` },
        ...relative(researchCount, () => n),
        skipIf: s => !researchLeft(s),
      };
    }
  }
}

export class ObjectiveSystem {
  private sm: StateManager;
  private resources: ResourceSystem;
  /** [Q2] After the tutorial a long-game run shows the guide's step (what blocks the Act) instead of the generic tasks. Set by the engine. */
  guide: ((state: GameState) => Objective | null) | null = null;

  constructor(sm: StateManager, resources: ResourceSystem) {
    this.sm = sm;
    this.resources = resources;
  }

  current(state: GameState): Objective {
    const step = state.tutorialStep ?? 0;
    if (step < ONBOARDING.length) return ONBOARDING[step];
    // [Q2] The guide answers "what do I do now and why"; the endless generic tasks only fill in when it has no step.
    const guided = this.guide?.(state);
    return guided ?? dynamicObjective(step - ONBOARDING.length, step);
  }

  /** Maps a tutorial step saved under the old onboarding list onto the current list. */
  static migrateStep(oldStep: number): number {
    if (oldStep >= LEGACY_IDS.length) return ONBOARDING.length + (oldStep - LEGACY_IDS.length);
    const idx = ONBOARDING.findIndex(o => o.id === LEGACY_IDS[oldStep]);
    return Math.max(0, idx);
  }

  /**
   * [LateGame B4] The weekly challenge is a separate track: it never touches `tutorialStep`.
   * A new one is picked on the first check of each (local) week, counted from that moment.
   */
  weekly(state: GameState): { def: ChallengeDef; cur: number; target: number; done: boolean } | null {
    const w = state.lateGame?.weekly;
    const def = getChallenge(w?.id);
    if (!w || !def) return null;
    return { def, cur: challengeProgress(state, def, w.base), target: def.target, done: w.done };
  }

  private updateWeekly(): void {
    const state = this.sm.state;
    const w = state.lateGame?.weekly;
    if (!w || state.survivors.length === 0 || !state.storyFlags.includes('intro:done')) return;
    const week = weekKey(Date.now());
    if (w.week !== week || !getChallenge(w.id)) {
      const def = pickChallenge(state, week);
      this.sm.applyDelta({ path: 'lateGame.weekly', value: { ...w, week, id: def.id, base: snapshot(state), done: false } });
      return;
    }
    if (w.done) return;
    const def = getChallenge(w.id)!;
    if (challengeProgress(state, def, w.base) < def.target) return;
    const cosmetic = COSMETICS[w.won % COSMETICS.length];
    this.sm.applyDelta({ path: 'lateGame.weekly', value: { ...w, done: true, won: w.won + 1, cosmetics: w.cosmetics.includes(cosmetic) ? w.cosmetics : [...w.cosmetics, cosmetic] } });
    if (state.resources.credits) this.resources.gain(this.sm, { credits: WEEKLY_CREDITS });
    bus.emit('weekly:done', def, cosmetic);
  }

  update(): void {
    this.updateWeekly();
    const state = this.sm.state;
    const obj = this.current(state);
    // A guide step is a pointer, not a task: the Act itself finishes it (no reward, the tutorial step stays put).
    if (obj.id.startsWith('guide:')) return;
    if (obj.skipIf?.(state)) {
      this.sm.applyDelta({ path: 'tutorialStep', value: (state.tutorialStep ?? 0) + 1 });
      return;
    }
    // A relative goal starts counting from the moment it appears.
    const step = state.tutorialStep ?? 0;
    if (obj.metric && state.objectiveBase?.step !== step) {
      this.sm.applyDelta({ path: 'objectiveBase', value: { step, value: obj.metric(state) } });
      return;
    }
    const [cur, target] = obj.progress(state);
    if (cur < target) return;
    this.resources.gain(this.sm, obj.reward);
    this.sm.applyDelta({ path: 'tutorialStep', value: (state.tutorialStep ?? 0) + 1 });
    bus.emit('objective:complete', obj);
  }
}

import type { GameState } from '../core/GameState';
import { projectDone } from './projects';
import { relationLevel } from './trade';

/**
 * The long game's Acts (long-game plan, section 5): the run's chapters. Eras stay the bunker's look and story beats;
 * Acts set how far the bunker may grow (room level, people, floors) and what it must achieve to move on. Each Act
 * ends with its charter: big projects (src/data/projects.ts, `charter`) built in stages with resources and crew.
 * There are seven Acts (ACTS below, MAX_ACT); Genesis opens when the last Act is complete. [plan4:GP-12]
 */
/** [Q2] What kind of work a goal is, so the guide (src/systems/Guide.ts) can say what blocks it and where to go. */
export type GoalKind = 'era' | 'ruins' | 'research' | 'dig' | 'levels' | 'pop' | 'outposts' | 'influence' | 'seedVault';

export interface ActGoal {
  kind: GoalKind;
  /** For 'levels' goals: the room level (Mk) the goal counts. */
  level?: number;
  text: Record<'he' | 'en', string>;
  progress: (s: GameState) => [number, number];
}

export interface ActDef {
  id: number;
  name: Record<'he' | 'en', string>;
  tagline: Record<'he' | 'en', string>;
  /** Highest room level (Mk) in this Act. */
  levelCap: number;
  /** Most people the bunker can hold in this Act (beds beyond it stay empty). */
  popCap: number;
  /** Deepest floor count that may be dug in this Act. */
  floorCap: number;
  /** What it takes to finish this Act (the charter projects are added to these). */
  goals: ActGoal[];
  /** Projects that make up this Act's charter. */
  charter: string[];
  /** [UX] What this Act opens, in plain words (shown on its title card). */
  opens?: Record<'he' | 'en', string>;
}

const researched = (s: GameState) => Object.values(s.research).filter(r => r.completed).length;
const allCleared = (s: GameState): [number, number] => {
  // A cleared ruin leaves the list: done = cleared, left = what still stands.
  const left = s.ruins?.length ?? 0;
  const done = s.ruinsCleared ?? 0;
  return left === 0 ? [1, 1] : [done, done + left];
};
const atLeast = (have: number, want: number): [number, number] => [Math.min(have, want), want];
/** Rooms at or above a level. */
const roomsAt = (s: GameState, level: number) => s.buildings.filter(b => b.level >= level && !(b.isConstructing && b.level === level)).length;

export const ACTS: ActDef[] = [
  {
    id: 1,
    name: { he: 'מערכה I · לשרוד', en: 'Act I · Survive' },
    tagline: { he: 'להחזיר חיים למקום מת', en: 'Bring a dead place back to life' },
    levelCap: 3, popCap: 12, floorCap: 5,
    goals: [
      // [phase3] Said as what it takes, not as an era number: the guide lists the steps under it (Guide.ts 'era').
      { kind: 'era', text: { he: 'הפעילו את הבונקר והגיעו ל־10 ניצולים', en: 'Get the bunker running and reach 10 survivors' }, progress: s => atLeast(s.era ?? 0, 2) },
      { kind: 'ruins', text: { he: 'פנו את כל ההריסות', en: 'Clear every ruin' }, progress: allCleared },
      { kind: 'research', text: { he: 'השלימו 10 מחקרים', en: 'Complete 10 researches' }, progress: s => atLeast(researched(s), 10) },
    ],
    charter: ['vaultSeal'],
  },
  {
    id: 2,
    name: { he: 'מערכה II · לשקם', en: 'Act II · Rebuild' },
    tagline: { he: 'מבונקר לבית', en: 'From a bunker to a home' },
    levelCap: 5, popCap: 40, floorCap: 8, // [phase3] 40 (was 30): casual players sat ~10 days at a full house
    goals: [
      { kind: 'dig', text: { he: 'חפרו 8 קומות', en: 'Dig 8 levels' }, progress: s => atLeast(s.currentFloors, 8) },
      { kind: 'research', text: { he: 'השלימו 22 מחקרים', en: 'Complete 22 researches' }, progress: s => atLeast(researched(s), 22) },
      { kind: 'levels', level: 5, text: { he: '10 חדרים ברמה 5', en: '10 rooms at level 5' }, progress: s => atLeast(roomsAt(s, 5), 10) },
    ],
    charter: ['radioMast', 'purifier'],
    // [phase3] Caravans wait for Act III (with the outposts), the seasons for Act IV.
    opens: { he: 'נפתחים: מנהל העבודה, ודוקטרינות חשמל ומזון במחקר, ובהמשך המערכה חוזים עם העולם בחוץ. החלטות שאינן דחופות מחכות בתיבת ההחלטות.', en: 'Opens: the Foreman, power and food doctrines in research, and later in the Act contracts with the world outside. Decisions that can wait now wait in the Decisions inbox.' },
  },
  {
    id: 3,
    name: { he: 'מערכה III · להתיישב', en: 'Act III · Settle' },
    tagline: { he: 'קהילה שמייצרת בעצמה', en: 'A community that makes its own' },
    levelCap: 7, popCap: 65, floorCap: 11,
    goals: [
      // [phase3] One step, said as what it means (40 people, power, the surface, contracts, a district: listed under it by the guide).
      { kind: 'era', text: { he: 'הצמיחו עיר מתחת לאדמה', en: 'Grow into a city under the ground' }, progress: s => [(s.era ?? 0) >= 3 ? 1 : 0, 1] },
      { kind: 'dig', text: { he: 'חפרו 11 קומות', en: 'Dig 11 levels' }, progress: s => atLeast(s.currentFloors, 11) },
      { kind: 'levels', level: 7, text: { he: '8 חדרים ברמה 7', en: '8 rooms at level 7' }, progress: s => atLeast(roomsAt(s, 7), 8) },
    ],
    charter: ['greenhouse', 'archive', 'metroTunnel'],
    // [phase3] One system at a time (SYSTEM_SCHEDULE): components and the society doctrine now, the first law after 2 days, outposts
    // and caravans after 4, the defense doctrine after 6.
    opens: { he: 'נפתחים: רכיבים (פס הרכבה בבית המלאכה) ודוקטרינת חברה. אחרי יומיים החוק הראשון, אחרי 4 ימים מאחזים ושיירות, ואחר כך דוקטרינת הגנה.', en: 'Opens: components (Assembly Line in the workshop) and the society doctrine. The first law follows in 2 days, outposts and caravans in 4, then the defense doctrine.' },
  },
  {
    id: 4,
    name: { he: 'מערכה IV · להתרחב', en: 'Act IV · Expand' },
    tagline: { he: 'עיר שלמה מתחת לעולם', en: 'A whole city beneath the world' },
    levelCap: 9, popCap: 110, floorCap: 14,
    goals: [
      { kind: 'dig', text: { he: 'חפרו 14 קומות', en: 'Dig 14 levels' }, progress: s => atLeast(s.currentFloors, 14) },
      // [ux-wp2 M1] 4 rooms (was 6): the Mk9 wait was days of nothing to decide.
      { kind: 'levels', level: 9, text: { he: '4 חדרים ברמה 9', en: '4 rooms at level 9' }, progress: s => atLeast(roomsAt(s, 9), 4) },
      { kind: 'pop', text: { he: 'הגיעו ל־90 ניצולים', en: 'Reach 90 survivors' }, progress: s => atLeast(s.survivors.length, 90) },
    ],
    charter: ['wall', 'deepFoundry'],
    opens: { he: 'נפתחים: סגסוגות (כבשן קשת בגנרטור), חדרים עד רמה 9, עוד מאחזים, ועונות השנה.', en: 'Opens: alloys (Arc Furnace in the generator), rooms up to level 9, more outposts, and the seasons.' }, // [phase3] seasons
  },
  {
    id: 5,
    name: { he: 'מערכה V · לעלות', en: 'Act V · Rise' },
    tagline: { he: 'שחר מעל האפר', en: 'Dawn above the ash' },
    levelCap: 10, popCap: 150, floorCap: 17,
    goals: [
      { kind: 'outposts', text: { he: 'החזיקו 3 מאחזים', en: 'Hold 3 outposts' }, progress: s => atLeast(((s.longGame?.world.outposts ?? []) as unknown[]).length, 3) },
      { kind: 'dig', text: { he: 'חפרו 17 קומות', en: 'Dig 17 levels' }, progress: s => atLeast(s.currentFloors, 17) },
      // [ux-wp2 M1] 5 rooms (was 8).
      { kind: 'levels', level: 10, text: { he: '5 חדרים ברמה 10', en: '5 rooms at level 10' }, progress: s => atLeast(roomsAt(s, 10), 5) },
    ],
    charter: ['surfaceGate', 'skyDome'],
    opens: { he: 'נפתחים: נתונים (כספת נתונים במעבדה), רמה 10, חוק שני.', en: 'Opens: data (Data Vault in the lab), level 10, a second law.' },
  },
  {
    id: 6,
    name: { he: 'מערכה VI · למשול', en: 'Act VI · Govern' },
    tagline: { he: 'רפובליקה בין שכנים', en: 'A republic among neighbours' },
    levelCap: 10, popCap: 190, floorCap: 20,
    goals: [
      { kind: 'influence', text: { he: 'צברו 1,500 השפעה', en: 'Gather 1,500 influence' }, progress: s => atLeast(Math.floor(s.resources.influence?.amount ?? 0), 1500) },
      { kind: 'pop', text: { he: 'הגיעו ל־150 ניצולים', en: 'Reach 150 survivors' }, progress: s => atLeast(s.survivors.length, 150) },
      { kind: 'dig', text: { he: 'חפרו 20 קומות', en: 'Dig 20 levels' }, progress: s => atLeast(s.currentFloors, 20) },
    ],
    charter: ['tradeLeague', 'constitution'],
    opens: { he: 'נפתחים: השפעה (אולם המועצה בחדר האוכל), חוק שלישי.', en: 'Opens: influence (Council Hall in the canteen), a third law.' },
  },
  {
    id: 7,
    name: { he: 'מערכה VII · בראשית', en: 'Act VII · Genesis' },
    tagline: { he: 'מה שיעבור לעולם הבא', en: 'What will cross into the next world' },
    levelCap: 10, popCap: 190, floorCap: 24,
    goals: [
      { kind: 'dig', text: { he: 'חפרו 24 קומות', en: 'Dig 24 levels' }, progress: s => atLeast(s.currentFloors, 24) },
      { kind: 'pop', text: { he: 'הגיעו ל־170 ניצולים', en: 'Reach 170 survivors' }, progress: s => atLeast(s.survivors.length, 170) },
      { kind: 'seedVault', text: { he: 'השלימו את כספת הזרעים (מחקר)', en: 'Complete the Seed Vault (research)' }, progress: s => [s.research.seedVault?.completed ? 1 : 0, 1] },
    ],
    charter: ['ark', 'genesisCore'],
    opens: { he: 'נפתחים: ליבות זרע (כור הזרעים), התיבה וליבת בראשית.', en: 'Opens: seed cores (the Seed Forge), the Ark and the Genesis Core.' },
  },
];

/** The deepest the bunker can ever go in this release, and the highest room level. */
export const MAX_ACT = ACTS.length;

const DAY = 86_400;

/** [phase3] The systems an Act opens one at a time (economy-pacing fix 7). */
export type SystemId = 'inbox' | 'foreman' | 'laws' | 'outposts' | 'contracts' | 'caravans' | 'doctrine2' | 'seasons';

/**
 * [phase3] When each system opens: its Act, and how long (world seconds) after that Act begins. Generalizes the old [Q7]
 * `lateActTwoSystems` stagger: Act II opens the Inbox and the Foreman on day 0 and contracts after 2.5 days; Act III opens one thing
 * at a time (laws +2 days, outposts and caravans +4 days, the second doctrine fork +6 days); the seasons wait for Act IV.
 * Every later Act has them all from its first day.
 */
export const SYSTEM_SCHEDULE: Record<SystemId, { act: number; after: number }> = {
  inbox: { act: 2, after: 0 },
  foreman: { act: 2, after: 0 },
  laws: { act: 3, after: 2 * DAY },
  outposts: { act: 3, after: 4 * DAY },
  // [phase3] Contracts stay in Act II (+2.5 days, as [Q7]): moving them to Act III took Act II's main materials income away and the
  // engaged sims reached Act III at day 11.5 instead of 7.7 (+50%). The lead may move them once Act II pays its charters another way.
  contracts: { act: 2, after: 2.5 * DAY },
  caravans: { act: 3, after: 4 * DAY },
  doctrine2: { act: 3, after: 6 * DAY },
  seasons: { act: 4, after: 0 },
};

/** [phase3] The doctrine forks that wait for a scheduled system (the others open with their research node's Act). */
export const FORK_SYSTEM: Record<string, SystemId> = { defense: 'doctrine2' };

/** [phase3] Research ids of the delayed fork, for "already in use" below. */
const DELAYED_FORK_NODES = ['fortress', 'rangers', 'diplomacy'];

/**
 * [phase3] A save from before the schedule must not lose what it already uses: a law in force, an outpost held, a contract waiting
 * in the inbox, a caravan on the road, or a delayed doctrine chosen keeps that system open.
 */
function inUse(state: GameState, id: SystemId): boolean {
  const lg = state.longGame!;
  switch (id) {
    case 'laws': return (lg.policy?.laws?.length ?? 0) > 0;
    case 'outposts': return ((lg.world?.outposts ?? []) as unknown[]).length > 0;
    case 'contracts': return (lg.inbox?.items ?? []).some(i => i.kind === 'contract');
    case 'caravans': return (state.activeMissions ?? []).some(m => m.type === 'caravan');
    case 'doctrine2': return DELAYED_FORK_NODES.some(r => !!(state.research[r]?.completed || state.research[r]?.isResearching));
    default: return false;
  }
}

/** [phase3] Is this system open in this run now? Bunkers from before the long game keep the old rule (everything from Act II). */
export function systemOpen(state: GameState, id: SystemId): boolean {
  const lg = state.longGame;
  if (!lg) return false;
  const at = SYSTEM_SCHEDULE[id];
  if (lg.meta.legacy) return lg.meta.act >= Math.min(at.act, 2);
  if (lg.meta.act > at.act) return true;
  if (lg.meta.act < at.act) return false;
  return inUse(state, id) || lg.meta.worldT - lg.meta.actSince >= at.after;
}

/** [phase3] World seconds until a system opens in the current Act (0: open; Infinity: a later Act). */
export function systemOpensIn(state: GameState, id: SystemId): number {
  if (systemOpen(state, id)) return 0;
  const lg = state.longGame;
  const at = SYSTEM_SCHEDULE[id];
  if (!lg || lg.meta.act !== at.act) return Infinity;
  return Math.max(0, at.after - (lg.meta.worldT - lg.meta.actSince));
}

/** [phase3] A doctrine fork that waits for its scheduled system (FORK_SYSTEM). */
export function forkOpen(state: GameState, fork: string): boolean {
  const sys = FORK_SYSTEM[fork];
  return !sys || systemOpen(state, sys);
}

/**
 * [Q7] Kept for its callers (ContractSystem.active, orders, seasons): the contracts' schedule (Act II + 2.5 days).
 * [phase3] seasons.ts should ask `systemOpen(state, 'seasons')` (Act IV) instead.
 */
export function lateActTwoSystems(state: GameState): boolean {
  return systemOpen(state, 'contracts');
}

export function actOf(state: GameState): ActDef {
  const n = state.longGame?.meta.act ?? 1;
  return ACTS[Math.min(ACTS.length, Math.max(1, n)) - 1];
}

/** Every goal of the Act, charter projects included, with its progress. */
export function actGoals(state: GameState, act: ActDef = actOf(state)): { text: Record<'he' | 'en', string>; progress: [number, number]; project?: string }[] {
  return [
    ...act.goals.map(g => ({ text: g.text, progress: g.progress(state) })),
    ...act.charter.map(id => ({ text: { he: '', en: '' }, progress: [projectDone(state, id) ? 1 : 0, 1] as [number, number], project: id })),
  ];
}

export function actComplete(state: GameState, act: ActDef = actOf(state)): boolean {
  return actGoals(state, act).every(g => g.progress[0] >= g.progress[1]);
}

/** A room type's highest level right now: its own top level, held to the Act's ceiling. */
export function levelCapFor(state: GameState, defMax: number): number {
  // Rooms with fewer levels (districts and halls: 5) count each level as two Mk steps.
  return Math.min(defMax, Math.max(1, Math.floor((actOf(state).levelCap * defMax) / 10)));
}

import { projectMorale } from '../data/projects';
import { lawMorale } from '../data/laws';
import type { GameState, SurvivorState, SurvivorStats, BuildingInstance } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { SeededRandom } from '../core/Random';
import { bus } from '../core/EventBus';
import { getDef, effectiveLevel, workforceMultiplier } from '../data/buildingDefs';
import { hasFeature, researchBuildingMult, researchMorale } from './ResearchSystem';
import { chainFactor } from '../data/chains';
import { incidentBlocks } from '../data/incidents';
import { specMax, specTotal } from '../data/specializations';
import { griefFor } from './DeathSystem'; // [Danger C5]
import { MAX_RANK, MENTOR_BOOST, rankOf, rankOfXp, trainingCost, trainingGain } from '../data/mastery'; // [LateGame B3]
import type { ResourceSystem } from './ResourceSystem';

const FIRST_NAMES_EN = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery', 'Quinn', 'Dana',
  'Max', 'Eli', 'Kai', 'Sage', 'Rowan', 'River', 'Sky', 'Phoenix', 'Blake', 'Drew'];
const FIRST_NAMES_HE = ['דני', 'יעל', 'אורי', 'נועה', 'עידו', 'מיכל', 'איתי', 'שירה', 'ליאור', 'תמר',
  'רועי', 'הילה', 'גל', 'דנה', 'אלון', 'ענבל', 'עמית', 'רונית', 'ניר', 'הדר'];

/** Story characters who can join keep their own names. */
const STORY_NAMES_HE: Record<string, string> = { Maya: 'מאיה', Gideon: 'גדעון' };

export const TRAITS = [
  'naturalLeader', 'greenThumb', 'engineer', 'medic', 'scavenger',
  'paranoid', 'glutton', 'lazy', 'tough', 'quickLearner',
  'charming', 'loner', 'optimist', 'pessimist', 'nightOwl',
];

export const STAT_KEYS: (keyof SurvivorStats)[] = ['strength', 'intelligence', 'agility', 'charisma', 'endurance'];
const STAT_CAP = 20;
const MORALE_DRIFT_PER_SECOND = 0.01;
const MAX_CANTEEN_BONUS = 22;

export interface MoraleFactor {
  key: string;
  value: number;
}

let nextSurvivorId = 1;

export function xpForNextLevel(level: number): number {
  return 120 * level;
}

export class PopulationSystem {
  syncNextId(state: GameState): void {
    let max = 0;
    const pending = state.activeEvent?.data?.survivor as SurvivorState | undefined;
    const group = (state.activeEvent?.data?.group as SurvivorState[] | undefined) ?? [];
    for (const s of [...state.survivors, ...(pending ? [pending] : []), ...group]) {
      const num = parseInt(s.id.replace('s_', ''), 10);
      if (num > max) max = num;
    }
    nextSurvivorId = max + 1;
  }

  /** [Danger C4] healthFloor: while the player is away, hunger can hurt but never kill (offline safety net). */
  update(sm: StateManager, dt: number, healthFloor = 0): void {
    const state = sm.state;
    if (state.survivors.length === 0) return;

    const now = state.stats.totalPlayTime;
    const starving = state.resources.food.amount <= 0;
    const thirsty = state.resources.water.amount <= 0;
    const medbays = state.buildings.filter(b => b.type === 'medbay' && effectiveLevel(b) > 0 && b.assignedSurvivorIds.length > 0
      && !incidentBlocks(state, b));
    const healMult = specMax(state, 'healMult', 'medbay');
    const gymMult = specMax(state, 'xpMult', 'trainingRoom');
    let medicine = state.resources.medicine.amount;

    const died: SurvivorState[] = [];
    const leveled: { survivor: SurvivorState; stat: keyof SurvivorStats }[] = [];

    // Most of a survivor's mood is the same for everyone: work it out once per step, not once per person (it was O(n²)).
    const mood = this.sharedMood(state);
    const survivors = state.survivors.map(original => {
      const s: SurvivorState = { ...original, stats: { ...original.stats } };

      const target = this.fastTargetHappiness(state, s, mood);
      s.happiness = Math.max(0, Math.min(100, s.happiness + (target - s.happiness) * MORALE_DRIFT_PER_SECOND * dt));

      if (starving || thirsty) {
        const loss = (starving ? 0.1 : 0) + (thirsty ? 0.15 : 0);
        s.health -= (s.traits.includes('tough') ? loss / 2 : loss) * dt;
      } else if (s.health < 100) {
        let heal = 0.05;
        if (medbays.length > 0 && medicine > 0) {
          heal = healMult;
          medicine = Math.max(0, medicine - 0.02 * dt);
        }
        s.health = Math.min(100, s.health + heal * dt);
      }

      if (healthFloor > 0 && s.health < healthFloor) s.health = healthFloor;
      if (s.health <= 0) {
        died.push(s);
        return s;
      }

      const job = s.assignedBuildingId ? state.buildings.find(b => b.id === s.assignedBuildingId) : undefined;
      const clearing = !job && !!s.assignedBuildingId?.startsWith('r_') && state.ruins.some(r => r.id === s.assignedBuildingId && r.started);
      if (((job && effectiveLevel(job) > 0) || clearing) && !s.isOnMission) {
        let rate = 1;
        if (s.traits.includes('quickLearner')) rate *= 2;
        if (s.traits.includes('lazy')) rate *= 0.5;
        if (job?.type === 'trainingRoom') rate *= 3 * gymMult * chainFactor(state, job);
        s.xp += rate * dt;
        const needed = xpForNextLevel(s.level);
        if (s.xp >= needed) {
          s.xp -= needed;
          s.level += 1;
          const stat = job ? getDef(job.type)?.optimalStat ?? STAT_KEYS[s.level % STAT_KEYS.length] : 'strength';
          s.stats[stat] = Math.min(STAT_CAP, s.stats[stat] + 1);
          leveled.push({ survivor: s, stat });
        }
      }
      return s;
    });

    const alive = survivors.filter(s => !died.includes(s));
    sm.applyDelta({ path: 'survivors', value: alive });

    if (medicine !== state.resources.medicine.amount) {
      sm.applyDelta({ path: 'resources.medicine.amount', value: medicine });
    }

    if (died.length > 0) {
      const deadIds = new Set(died.map(d => d.id));
      sm.applyDelta({
        path: 'buildings',
        value: state.buildings.map(b => ({ ...b, assignedSurvivorIds: b.assignedSurvivorIds.filter(id => !deadIds.has(id)) })),
      });
      for (const d of died) bus.emit('survivor:died', d, 'health');
    }
    for (const l of leveled) bus.emit('survivor:levelup', l.survivor, l.stat);

    if (state.moraleBuffs.some(b => b.expiresAt <= now)) {
      sm.applyDelta({ path: 'moraleBuffs', value: state.moraleBuffs.filter(b => b.expiresAt > now) });
    }
  }

  /**
   * [LateGame B3] Mastery: everyone at work (in a room, or on a project crew) gains work seconds toward the next rank.
   * Runs online and offline (called from ProjectSystem.update). Written in place: no new survivor objects every tick.
   */
  accrueMastery(sm: StateManager, dt: number): void {
    const state = sm.state;
    const ranked: SurvivorState[] = [];
    const merit = hasFeature(state, 'meritocracy');
    for (const s of state.survivors) {
      if (s.child || s.isOnMission || !s.assignedBuildingId) continue;
      const job = state.buildings.find(b => b.id === s.assignedBuildingId);
      const onProject = s.assignedBuildingId.startsWith('p_');
      if (!onProject && !(job && effectiveLevel(job) > 0)) continue;
      let rate = 1;
      if (s.traits.includes('quickLearner')) rate *= 2;
      if (s.traits.includes('lazy')) rate *= 0.5;
      if (job?.type === 'trainingRoom') rate *= 3;
      // A mentor in the same room speeds up everyone beside them.
      if (job && job.assignedSurvivorIds.some(id => id !== s.id && state.survivors.find(o => o.id === id)?.spec === 'mentor')) rate *= 1 + MENTOR_BOOST;
      const before = rankOf(s);
      if (merit) rate *= 1.5; // [P3] Meritocracy doctrine
      s.mxp = (s.mxp ?? 0) + rate * dt;
      if (rankOfXp(s.mxp) > before) ranked.push(s);
    }
    for (const s of ranked) bus.emit('survivor:rank', s, rankOf(s));
  }

  /** A quick, paid training (training room required): a quarter of the current rank in one go. */
  canTrain(state: GameState, resources: ResourceSystem, s: SurvivorState): boolean {
    if (s.child || s.isOnMission || rankOf(s) >= MAX_RANK) return false;
    if (!state.buildings.some(b => b.type === 'trainingRoom' && effectiveLevel(b) > 0)) return false;
    return resources.canAfford(state, trainingCost(s, state.longGame?.meta.act ?? 1) as Record<string, number>);
  }

  train(sm: StateManager, resources: ResourceSystem, survivorId: string): boolean {
    const s = sm.state.survivors.find(x => x.id === survivorId);
    if (!s || !this.canTrain(sm.state, resources, s)) return false;
    if (!resources.spend(sm, trainingCost(s, sm.state.longGame?.meta.act ?? 1) as Record<string, number>)) return false;
    const before = rankOf(s);
    s.mxp = (s.mxp ?? 0) + trainingGain(s);
    sm.applyDelta({ path: 'lateGame.trained', value: (sm.state.lateGame.trained ?? 0) + 1 });
    sm.applyDelta({ path: 'survivors', value: [...sm.state.survivors] });
    if (rankOf(s) > before) bus.emit('survivor:rank', s, rankOf(s));
    return true;
  }

  /** Rank 5: picks one of the two specializations (final). */
  chooseSpec(sm: StateManager, survivorId: string, spec: string): boolean {
    const s = sm.state.survivors.find(x => x.id === survivorId);
    if (!s || rankOf(s) < MAX_RANK || s.spec || (spec !== 'master' && spec !== 'mentor')) return false;
    sm.applyDelta({ path: 'survivors', value: sm.state.survivors.map(x => (x.id === survivorId ? { ...x, spec } : x)) });
    return true;
  }

  getMoraleFactors(state: GameState, s: SurvivorState): MoraleFactor[] {
    const factors: MoraleFactor[] = [{ key: 'base', value: 45 }];

    if (!s.isOnMission) {
      factors.push(s.assignedBuildingId ? { key: 'hasJob', value: 15 } : { key: 'noJob', value: -10 });
    }
    if (state.resources.food.amount <= 0) factors.push({ key: 'noFood', value: -30 });
    if (state.resources.water.amount <= 0) factors.push({ key: 'noWater', value: -30 });
    if (state.survivors.length > state.maxPopulation) factors.push({ key: 'overcrowded', value: -15 });
    // A bigger bunker is louder and more cramped: gardens, the lake and the canteen have to make up for it.
    const crowd = Math.min(14, Math.max(0, Math.round((state.survivors.length - 12) * 0.4)));
    if (crowd > 0) factors.push({ key: 'crowding', value: -crowd });
    if ((state.powerRatio ?? 1) < 0.99) factors.push({ key: 'darkness', value: -Math.round(15 * (1 - state.powerRatio)) - 5 });
    if (s.health < 50) factors.push({ key: 'injured', value: -10 });

    const canteen = this.getCanteenBonus(state);
    if (canteen > 0) factors.push({ key: 'canteen', value: Math.round(canteen) });

    const now = state.stats.totalPlayTime;
    const buffs = state.moraleBuffs.filter(b => b.expiresAt > now).reduce((sum, b) => sum + b.value, 0);
    if (buffs !== 0) factors.push({ key: 'events', value: buffs });

    const research = researchMorale(state);
    if (research > 0) factors.push({ key: 'research', value: research });
    const laws = lawMorale(state);
    if (laws !== 0) factors.push({ key: 'laws', value: laws });
    const specs = specTotal(state, 'morale');
    if (specs > 0) factors.push({ key: 'specs', value: specs });
    if (s.partnerId && state.survivors.some(p => p.id === s.partnerId)) factors.push({ key: 'family', value: 6 });
    const kids = state.survivors.filter(c => c.child).length;
    if (kids > 0) factors.push({ key: 'children', value: Math.min(6, kids * 2) });
    // [Danger C5] Mourning (and the lift a ceremony gives afterwards).
    const mourning = griefFor(state, s.id);
    if (mourning !== 0) factors.push({ key: 'mourning', value: mourning });
    const crises = state.incidents?.length ?? 0;
    if (crises > 0) factors.push({ key: 'crisis', value: -4 * crises });
    if (state.survivors.some(o => o.id !== s.id && o.traits.includes('naturalLeader'))) factors.push({ key: 'leader', value: 5 });

    if (s.traits.includes('optimist')) factors.push({ key: 'optimist', value: 10 });
    if (s.traits.includes('pessimist')) factors.push({ key: 'pessimist', value: -10 });
    return factors;
  }

  /**
   * The parts of morale that do not depend on who is asking. Must stay in step with getMoraleFactors (the list the
   * People panel shows): that function is the readable version, this is the same sum done once for everybody.
   */
  private sharedMood(state: GameState): { sum: number; leaders: number; ids: Set<string> } {
    let sum = 45;
    if (state.resources.food.amount <= 0) sum -= 30;
    if (state.resources.water.amount <= 0) sum -= 30;
    if (state.survivors.length > state.maxPopulation) sum -= 15;
    const crowd = Math.min(14, Math.max(0, Math.round((state.survivors.length - 12) * 0.4)));
    if (crowd > 0) sum -= crowd;
    if ((state.powerRatio ?? 1) < 0.99) sum -= Math.round(15 * (1 - state.powerRatio)) + 5;
    const canteen = this.getCanteenBonus(state);
    if (canteen > 0) sum += Math.round(canteen);
    const now = state.stats.totalPlayTime;
    const buffs = state.moraleBuffs.filter(b => b.expiresAt > now).reduce((acc, b) => acc + b.value, 0);
    sum += buffs;
    const research = researchMorale(state);
    if (research > 0) sum += research;
    sum += lawMorale(state);
    sum += projectMorale(state); // the Sky Dome
    const specs = specTotal(state, 'morale');
    if (specs > 0) sum += specs;
    let kids = 0;
    let leaders = 0;
    const ids = new Set<string>();
    for (const o of state.survivors) {
      ids.add(o.id);
      if (o.child) kids++;
      if (o.traits.includes('naturalLeader')) leaders++;
    }
    if (kids > 0) sum += Math.min(6, kids * 2);
    sum -= 4 * (state.incidents?.length ?? 0);
    return { sum, leaders, ids };
  }

  /** One survivor's target mood from the shared part plus what is personal to them. Same result as getTargetHappiness. */
  private fastTargetHappiness(state: GameState, s: SurvivorState, mood: { sum: number; leaders: number; ids: Set<string> }): number {
    let total = mood.sum;
    if (!s.isOnMission) total += s.assignedBuildingId ? 15 : -10;
    if (s.health < 50) total -= 10;
    if (s.partnerId && mood.ids.has(s.partnerId)) total += 6;
    total += griefFor(state, s.id);
    if (mood.leaders - (s.traits.includes('naturalLeader') ? 1 : 0) > 0) total += 5;
    if (s.traits.includes('optimist')) total += 10;
    if (s.traits.includes('pessimist')) total -= 10;
    return Math.max(0, Math.min(100, total));
  }

  getTargetHappiness(state: GameState, s: SurvivorState): number {
    const total = this.getMoraleFactors(state, s).reduce((sum, f) => sum + f.value, 0);
    return Math.max(0, Math.min(100, total));
  }

  private getCanteenBonus(state: GameState): number {
    let bonus = 0;
    for (const b of state.buildings) {
      const morale = getDef(b.type)?.effects?.morale;
      const level = effectiveLevel(b);
      if (!morale || level <= 0 || incidentBlocks(state, b)) continue;
      bonus += (morale.base + morale.perLevel * (level - 1)) * workforceMultiplier(state, b) * (state.powerRatio ?? 1)
        * researchBuildingMult(state, b.type) * Math.min(1, chainFactor(state, b));
    }
    return Math.min(MAX_CANTEEN_BONUS, bonus);
  }

  createSurvivor(rng: SeededRandom): SurvivorState {
    const id = `s_${nextSurvivorId++}`;
    const stats: SurvivorStats = {
      strength: rng.nextInt(1, 10),
      intelligence: rng.nextInt(1, 10),
      agility: rng.nextInt(1, 10),
      charisma: rng.nextInt(1, 10),
      endurance: rng.nextInt(1, 10),
    };

    const traits: string[] = [];
    if (rng.chance(0.6)) traits.push(rng.pick(TRAITS));

    return {
      id,
      name: rng.pick(FIRST_NAMES_EN),
      portraitIndex: rng.nextInt(0, 39),
      level: 1,
      xp: 0,
      stats,
      health: 100,
      happiness: 60 + rng.nextInt(0, 20),
      assignedBuildingId: null,
      traits,
      equipment: [],
      isOnMission: false,
    };
  }

  addSurvivor(sm: StateManager, survivor: SurvivorState): void {
    const hardy = sm.state.prestige.upgrades['hardyStock'] ?? 0;
    if (hardy > 0) {
      const stats = { ...survivor.stats };
      for (const k of STAT_KEYS) stats[k] = Math.min(STAT_CAP, stats[k] + hardy);
      survivor = { ...survivor, stats };
    }
    sm.applyDelta({ path: 'survivors', value: [...sm.state.survivors, survivor] });
    sm.applyDelta({
      path: 'stats.totalSurvivorsRecruited',
      value: sm.state.stats.totalSurvivorsRecruited + 1,
    });
  }

  canAssign(state: GameState, buildingId: string): boolean {
    const b = state.buildings.find(x => x.id === buildingId);
    if (!b) return false;
    return b.assignedSurvivorIds.length < (getDef(b.type)?.maxWorkers ?? 0);
  }

  assignSurvivorToBuilding(sm: StateManager, survivorId: string, buildingId: string | null): boolean {
    const state = sm.state;
    const survivor = state.survivors.find(s => s.id === survivorId);
    if (!survivor) return false;
    if (buildingId && survivor.child) return false;
    if (buildingId && survivor.assignedBuildingId !== buildingId && !this.canAssign(state, buildingId)) return false;

    const buildings: BuildingInstance[] = state.buildings.map(b => {
      let ids = b.assignedSurvivorIds.filter(id => id !== survivorId);
      if (b.id === buildingId) ids = [...ids, survivorId];
      return ids.length === b.assignedSurvivorIds.length && b.id !== buildingId ? b : { ...b, assignedSurvivorIds: ids };
    });
    const survivors = state.survivors.map(s => (s.id === survivorId ? { ...s, assignedBuildingId: buildingId } : s));

    sm.applyDelta({ path: 'buildings', value: buildings });
    sm.applyDelta({ path: 'survivors', value: survivors });
    return true;
  }

  getLocalizedName(survivor: SurvivorState, locale: 'en' | 'he'): string {
    if (locale === 'he') {
      if (STORY_NAMES_HE[survivor.name]) return STORY_NAMES_HE[survivor.name];
      const idx = FIRST_NAMES_EN.indexOf(survivor.name);
      if (idx !== -1 && idx < FIRST_NAMES_HE.length) return FIRST_NAMES_HE[idx];
    }
    return survivor.name;
  }

  getGlobalMorale(state: GameState): number {
    if (state.survivors.length === 0) return 50;
    return state.survivors.reduce((sum, s) => sum + s.happiness, 0) / state.survivors.length;
  }
}

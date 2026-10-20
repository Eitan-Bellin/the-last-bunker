import { hasMutator, mutatorLegacy } from '../data/mutators';
import type { GameState, ResourceType } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { ResourceSystem } from './ResourceSystem';
import { bus } from '../core/EventBus';
import { ACHIEVEMENTS } from '../data/achievements';
import { ACT_LEDGER_STEP, CLASS_GROUP, CLASS_OUTPUT, PRESTIGE_UPGRADES, classDefs, classOf, upgradeCost } from '../data/prestige';
import { MAX_FLOORS } from '../data/zones';
import { hasFeature } from './ResearchSystem';
import { MAX_ACT, actComplete, actOf } from '../data/acts';
import { DIFFICULTIES } from '../data/difficulty';
import { ENDINGS, endingPerkOf, type EndingDef, type EndingPerk } from '../data/endings';
import { ACT_CURRENCY } from '../data/pricing';
import { registerModifier, type OutputModifier } from './modifiers';

/**
 * [phase5] Genesis carries into the run (strategy-systems C10): the class's own lean, the Act Ledger on the current Act's resource and
 * the previous ending's perk, as one output modifier ("Genesis" in the why-panel, i18n mod.genesis). It is marked `uncapped`: the
 * modifier stack's ceiling (TUNING.multiplierCeiling, 4) is already reached in Act II of a second run with a few Echo levels, which
 * is why the shop gave +0% to the Act's resource. The flag only takes effect once modifiers.ts reads it (lead wiring); until then
 * it counts under the ceiling like the others.
 */
let genesisNow: { act: ResourceType | null; ledger: number; out: Partial<Record<ResourceType, number>> } = { act: null, ledger: 1, out: {} };
const genesisModifier: OutputModifier & { uncapped: true } = {
  id: 'genesis',
  uncapped: true,
  prepare: state => {
    const out: Partial<Record<ResourceType, number>> = {};
    const add = (m: Partial<Record<string, number>> | undefined) => { for (const [r, v] of Object.entries(m ?? {})) out[r as ResourceType] = (out[r as ResourceType] ?? 0) + (v ?? 0); };
    const cls = classOf(state);
    if (cls) add(CLASS_OUTPUT[cls.id]);
    add(endingPerkOf(state)?.perk.output);
    const lg = state.longGame;
    const act = lg && !lg.meta.legacy ? ACT_CURRENCY[Math.min(ACT_CURRENCY.length - 1, Math.max(1, lg.meta.act))] : null;
    genesisNow = { act, ledger: 1 + ACT_LEDGER_STEP * (state.prestige.upgrades['actLedger'] ?? 0), out };
  },
  mult: ({ resource }) => (1 + (genesisNow.out[resource] ?? 0)) * (resource === genesisNow.act ? genesisNow.ledger : 1),
};
registerModifier(genesisModifier);

/** [phase5] After a Genesis, upgrades bought this long into the new run still give their start (stock, a dug floor, people) at once. */
const START_WINDOW = 2 * 3600;

/** Project Genesis gate (the design's "big decision"): the research plus a grown, era-3 bunker. */
export const GENESIS_MIN_SURVIVORS = 40;
export const GENESIS_MIN_ERA = 3;
/** The raw score is divided down so a first rebirth pays about 150–300 (legacy bunkers; [phase5] a long-game first Genesis pays ~2,000). */
const REBIRTH_DIVISOR = 4;

export interface RebirthRequirement {
  /** i18n key of the line, e.g. 'genesis.reqSurvivors'. */
  key: string;
  met: boolean;
  current: number;
  target: number;
}

/** Every condition for Genesis, so the UI can show exactly what is still missing. */
export function rebirthRequirementsOf(state: GameState): RebirthRequirement[] {
  const research = hasFeature(state, 'genesis');
  const pop = state.survivors.length;
  const era = state.era ?? 0;
  const reqs: RebirthRequirement[] = [
    { key: 'genesis.reqResearch', met: research, current: research ? 1 : 0, target: 1 },
    { key: 'genesis.reqSurvivors', met: pop >= GENESIS_MIN_SURVIVORS, current: pop, target: GENESIS_MIN_SURVIVORS },
    { key: 'genesis.reqEra', met: era >= GENESIS_MIN_ERA, current: era, target: GENESIS_MIN_ERA },
  ];
  // [Long game] A new bunker reaches Genesis by finishing the last Act (its charter ends with the Genesis Core).
  // A bunker from before the long game keeps the classic gate, so nobody loses the Genesis they were about to make.
  const lg = state.longGame;
  if (lg && !lg.meta.legacy) {
    const act = actOf(state);
    const done = act.id >= MAX_ACT && actComplete(state, act);
    reqs.push({ key: 'genesis.reqAct', met: done, current: done ? MAX_ACT : act.id - 1, target: MAX_ACT });
  }
  return reqs;
}

/** [Q1] Whether the Genesis button is open (the story reads this to tell "the big decision" at the right time). */
export function genesisGateMet(state: GameState): boolean {
  return rebirthRequirementsOf(state).every(r => r.met);
}

/** Achievements and the Project Genesis (prestige) upgrade shop. */
export class MetaSystem {
  private sm: StateManager;
  private resources: ResourceSystem;

  /**
   * [phase5] Adds new survivors (Veterans, the Founders' two people) when one of those is bought at the start of a run, after the
   * run was set up. Set by GameEngine (lead wiring); without it those people only come with the next run.
   */
  addPeople: ((n: number) => void) | null = null;

  constructor(sm: StateManager, resources: ResourceSystem) {
    this.sm = sm;
    this.resources = resources;
    // [phase5] The Exposed Outposts hardship: a raid lost takes an outpost for good.
    bus.on('raid:resolved', (r: unknown) => {
      const key = (r as { key?: string } | null)?.key;
      if ((key === 'loseBig' || key === 'loseSmall') && hasMutator(this.sm.state, 'exposed')) this.loseOutpost();
    });
  }

  /** [phase5] Removes one outpost (a damaged one first, else the newest). */
  private loseOutpost(): void {
    const list = (this.sm.state.longGame?.world.outposts ?? []) as { id: number; damaged?: boolean }[];
    if (!list.length) return;
    const lost = list.find(o => o.damaged) ?? list[list.length - 1];
    this.sm.applyDelta({ path: 'longGame.world.outposts', value: list.filter(o => o !== lost) });
    bus.emit('outpost:lost', lost);
  }

  /** [phase5] The No Foreman hardship: standing orders cannot stay on (ForemanSystem.available should also read it: lead wiring). */
  private enforceHardships(state: GameState): void {
    const orders = state.longGame?.foreman.orders as Record<string, boolean> | undefined;
    if (orders && hasMutator(state, 'noForeman') && Object.values(orders).some(Boolean)) {
      this.sm.applyDelta({ path: 'longGame.foreman.orders', value: Object.fromEntries(Object.keys(orders).map(k => [k, false])) });
    }
  }

  checkAchievements(): void {
    this.enforceHardships(this.sm.state); // [phase5] (runs every step, online and away)
    const state = this.sm.state;
    for (const a of ACHIEVEMENTS) {
      if (state.achievements.includes(a.id) || !a.check(state)) continue;
      this.sm.applyDelta({ path: 'achievements', value: [...this.sm.state.achievements, a.id] });
      this.resources.gain(this.sm, a.reward, { overfill: true }); // [ux-wp2 R1] rewards are not lost to a full store
      bus.emit('achievement', a.id);
    }
  }

  private finalActDone(state: GameState): boolean {
    const act = actOf(state);
    return act.id >= MAX_ACT && actComplete(state, act);
  }

  /** Every condition for Genesis, so the UI can show exactly what is still missing. */
  rebirthRequirements(state: GameState): RebirthRequirement[] {
    return rebirthRequirementsOf(state);
  }

  canRebirth(state: GameState): boolean {
    return this.rebirthRequirements(state).every(r => r.met);
  }

  /** Isotope-7 awarded for a rebirth now; grows with everything achieved this run. */
  rebirthGain(state: GameState): number {
    const researched = Object.values(state.research).filter(r => r.completed).length;
    // [Long game] Legacy from what the run achieved (Acts, depth, top rooms, knowledge, people), not from waiting:
    // the old food term grew by itself while the player was away. Bunkers from before the long game keep the old sum.
    const lg = state.longGame;
    if (lg && !lg.meta.legacy) {
      const actsDone = Math.max(0, lg.meta.act - 1) + (this.finalActDone(state) ? 1 : 0);
      const topRooms = state.buildings.filter(b => b.level >= 8).length;
      const raw = 100 * actsDone + 10 * Math.max(0, state.currentFloors - 3) + 5 * topRooms + 2 * researched
        + state.survivors.length + 5 * state.achievements.length;
      const diff = DIFFICULTIES.find(d => d.id === lg.meta.diffLowest)?.legacy ?? 1;
      // [P3] Heritage research: +10%.
      // [P5] The run's ending adds its share.
      const ending = ENDINGS.find(e => state.storyFlags.includes(`ending:${e.id}`));
      return Math.floor(raw * diff * (1 + 0.1 * state.prestige.rebirthCount) * (hasFeature(state, 'heritage') ? 1.1 : 1) * (hasFeature(state, 'arkLegacy') ? 1.15 : 1) * (1 + (ending?.legacy ?? 0) + mutatorLegacy(state)));
    }
    const explored = state.explorationMap.filter(h => h.explored).length;
    const raw = 5 + Math.sqrt(state.stats.totalFoodProduced / 20) + state.survivors.length * 2 + researched * 2 + explored
      + state.buildings.reduce((s, b) => s + b.level, 0);
    return Math.floor((raw / REBIRTH_DIVISOR) * (1 + 0.1 * state.prestige.rebirthCount));
  }

  /**
   * Head start for a new run (called once from GameEngine's new-game setup):
   * Quick Start stock (120 materials + 30 scrap per level) and Pre-dug levels.
   */
  applyStartBonuses(sm: StateManager): void {
    const up = sm.state.prestige.upgrades;
    const quick = up['quickStart'] ?? 0;
    if (quick > 0) {
      const bonus: Partial<Record<ResourceType, number>> = { materials: 120 * quick, scrap: 30 * quick };
      for (const [r, v] of Object.entries(bonus) as [ResourceType, number][]) {
        sm.applyDelta({ path: `resources.${r}.amount`, value: sm.state.resources[r].amount + v });
      }
    }
    // [P2-1] The Seed Store doctrine of the previous timeline: the next world starts with stock and two dug floors.
    if (sm.state.prestige.seedBank) {
      for (const [r, v] of Object.entries({ materials: 600, scrap: 150, knowledge: 300 }) as [ResourceType, number][]) {
        sm.applyDelta({ path: `resources.${r}.amount`, value: sm.state.resources[r].amount + v });
      }
      sm.applyDelta({ path: 'currentFloors', value: Math.min(MAX_FLOORS, sm.state.currentFloors + 2) });
    }
    const dug = up['preDug'] ?? 0;
    if (dug > 0) sm.applyDelta({ path: 'currentFloors', value: Math.min(MAX_FLOORS, sm.state.currentFloors + dug) });
    // [phase5] The ending the last run reached: its start (stock, a dug floor). Its output lean is the 'genesis' modifier.
    const perk = endingPerkOf(sm.state)?.perk;
    if (perk) {
      for (const [r, v] of Object.entries(perk.stock ?? {}) as [ResourceType, number][]) {
        sm.applyDelta({ path: `resources.${r}.amount`, value: sm.state.resources[r].amount + v });
      }
      if (perk.floors) sm.applyDelta({ path: 'currentFloors', value: Math.min(MAX_FLOORS, sm.state.currentFloors + perk.floors) });
    }
  }

  /** [phase5] The perk this run has from the ending of the previous one (the Genesis tab shows it). */
  endingPerkOf(state: GameState): { ending: EndingDef; perk: EndingPerk } | undefined {
    return endingPerkOf(state);
  }

  /** [phase5] Whether this is the start of a run that came from a Genesis (start-of-run purchases still give their start). */
  inStartWindow(state: GameState): boolean {
    const lg = state.longGame;
    return state.prestige.rebirthCount > 0 && !!lg && !lg.meta.legacy && lg.meta.act === 1 && lg.meta.worldT - lg.meta.actSince < START_WINDOW;
  }

  /** [phase5] The start part of an upgrade level bought after the run was set up (the same as applyStartBonuses gives per level). */
  private startDelta(id: string): void {
    const sm = this.sm;
    const add = (r: ResourceType, v: number) => sm.applyDelta({ path: `resources.${r}.amount`, value: sm.state.resources[r].amount + v });
    if (id === 'quickStart') { add('materials', 120); add('scrap', 30); }
    if (id === 'preDug') sm.applyDelta({ path: 'currentFloors', value: Math.min(MAX_FLOORS, sm.state.currentFloors + 1) });
    if (id === 'veteranSurvivors') this.addPeople?.(1);
    if (id === 'ksFounders') this.addPeople?.(2);
  }

  /** [phase5] The cheapest class (founding keystone) price. */
  classCost(): number {
    return Math.min(...classDefs().map(u => upgradeCost(u, 0)));
  }

  /**
   * [phase5] Whether the bunker should pick its class now: it has none and can pay for one. Until then the rest of the shop waits
   * (buy refuses it), and the app shows the full-screen pick after a Genesis (lead wiring in feedback.ts).
   */
  classPickDue(state: GameState): boolean {
    return !classOf(state) && this.isotope(state) >= this.classCost();
  }

  /** [phase5] Picks the class (the first Genesis purchase). Same as buying the keystone, by its own name for the pick screen. */
  chooseClass(id: string): boolean {
    const def = PRESTIGE_UPGRADES.find(u => u.id === id);
    return !!def && def.keystone === CLASS_GROUP && this.buy(id);
  }

  isotope(state: GameState): number {
    return Math.floor(state.resources.isotope7.amount);
  }

  upgradeLevel(state: GameState, id: string): number {
    return state.prestige.upgrades[id] ?? 0;
  }

  buy(id: string): boolean {
    const state = this.sm.state;
    const def = PRESTIGE_UPGRADES.find(u => u.id === id);
    if (!def) return false;
    const level = this.upgradeLevel(state, id);
    if (level >= def.maxLevel) return false;
    // [P5] One keystone per group.
    if (def.keystone && PRESTIGE_UPGRADES.some(u => u.keystone === def.keystone && u.id !== id && this.upgradeLevel(state, u.id) > 0)) return false;
    // [phase5] Keystones first: while a class can be paid for and none is owned, the class is the only purchase.
    if (def.keystone !== CLASS_GROUP && this.classPickDue(state)) return false;
    const cost = upgradeCost(def, level);
    if (this.isotope(state) < cost) return false;
    this.sm.applyDelta({ path: 'resources.isotope7.amount', value: state.resources.isotope7.amount - cost });
    this.sm.applyDelta({ path: 'prestige.upgrades', value: { ...state.prestige.upgrades, [id]: level + 1 } });
    if (this.inStartWindow(this.sm.state)) this.startDelta(id); // [phase5]
    return true;
  }
}

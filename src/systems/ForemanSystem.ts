import type { StateManager } from '../core/StateManager';
import type { GameState } from '../core/GameState';
import { crewCount, getDef } from '../data/buildingDefs';
import { wearOf } from './MaintenanceSystem';
import type { MaintenanceSystem } from './MaintenanceSystem';
import type { ProjectSystem } from './ProjectSystem';
import type { PopulationSystem } from './PopulationSystem';
import type { DigSystem } from './DigSystem';
import type { ContractSystem } from './ContractSystem';
import type { ResourceSystem } from './ResourceSystem';
import { rankOf, trainingCost } from '../data/mastery';
import { closeEmergencyDoors, doorsOperable, emergencyDoorTargets, setDoorState, troubleOn } from './InfraSystem';
import { getDoor } from './doors';
import type { IncidentSystem } from './IncidentSystem';
import { disasterCost, quickFixCost } from '../data/incidents';
import { ACT_CURRENCY } from '../data/pricing';
import { actCurrency } from './ThreatSystem';

/** The Foreman's standing orders (long-game plan, pillar C): routine the player hands over instead of repeating. */
export type ForemanOrder = 'maintain' | 'deposit' | 'staff' | 'train' | 'contracts' | 'sealOnAlarm';
/**
 * [phase4] (C5) The chores are no longer orders: once the Foreman opens (Act II) he always delivers to the project, staffs and
 * trains, and the player never sees a switch for them. Only orders that trade something stay switches (FOREMAN_ORDERS: the doors shut
 * on an alarm cost power and cut rooms off). 'contracts' keeps whatever an older save set, without a switch (the Trade tab owns contracts).
 */
// [phase4] 'maintain' is gone from the round: MaintenanceSystem services worn rooms with their own crew (Agent R).
export const FOREMAN_CHORES: ForemanOrder[] = ['deposit', 'staff', 'train'];
const KEPT_ORDERS: ForemanOrder[] = ['contracts'];
export const FOREMAN_ORDERS: ForemanOrder[] = ['sealOnAlarm'];

/** [phase4] The Foreman's policies (C5): the three strategy settings shown on his screen. */
export type RaidElse = 'pay' | 'hide';
export type ForemanPriority = 'even' | 'act' | 'basics';
/** Away raid policy: fight when the odds are at least this (0 = always fight), else pay or hide. */
export const RAID_FIGHT_STEPS: readonly number[] = [0, 0.5, 0.65, 0.8];
export const RAID_POLICY_DEFAULT = 0.5;
/** Quick fixes (and disaster handling) the Foreman pays by himself: up to this share of the Act's currency in store. */
export const AUTO_PAY_STEPS: readonly number[] = [0, 0.05, 0.15];

export interface ForemanPolicy { fightAt: number; otherwise: RaidElse; priority: ForemanPriority; autoPay: number }

export function foremanPolicy(state: GameState): ForemanPolicy {
  const f = state.longGame?.foreman;
  return {
    fightAt: typeof f?.raidFightAt === 'number' ? f.raidFightAt : RAID_POLICY_DEFAULT,
    otherwise: f?.raidElse === 'hide' ? 'hide' : 'pay',
    priority: f?.priority === 'act' || f?.priority === 'basics' ? f.priority : 'even',
    autoPay: typeof f?.autoPay === 'number' ? f.autoPay : 0,
  };
}

/** [phase4] The share of the Act's currency a cost asks (0 when it asks none of it, Infinity when the store is empty). */
export function actShareOf(state: GameState, cost: Record<string, number>): number {
  const c = actCurrency(state);
  const need = cost[c] ?? 0;
  if (need <= 0) return 0;
  const have = state.resources[c]?.amount ?? 0;
  return have > 0 ? need / have : Infinity;
}

/** [phase4] True when the room makes any of `goods`. */
function makes(b: { type: string }, goods: string[]): boolean {
  const prod = (getDef(b.type as never)?.production ?? {}) as Record<string, unknown>;
  return goods.some(g => g in prod);
}
/**
 * [plan4:GP-8 #7] 'sealOnAlarm' watches for trouble (a fire, an epidemic, a raid on the way) every few seconds instead of once a round:
 * a fire does not wait a minute. Off by default; the price is visible (shut rooms are cut off and the doors draw power).
 */
const ALARM_EVERY = 5;
/** [Q9] Training only runs while knowledge is at least this share of its cap, so the order never starves research. */
const TRAIN_KNOWLEDGE_SHARE = 0.5;
/** Quick trainings per round. */
const TRAIN_PER_ROUND = 2;
/** The Foreman takes orders from this Act on (the first Act is learned by hand). */
export const FOREMAN_ACT = 2;
/** Rooms are serviced once their wear passes this. */
const MAINTAIN_AT = 40;
/** [phase4] A store under this share of its cap and falling is short: the Foreman staffs it first. */
const SHORT_SHARE = 0.25;
/** Seconds between the Foreman's rounds. */
export const FOREMAN_ROUND = 60;

/** What an order did on its last round, for the panel (an i18n key under foreman.report and its params). */
export interface ForemanReport { key: string; n?: number }

/**
 * [Long game] Carries out the standing orders about once a minute of game time, online and while away:
 * repairs worn rooms, delivers spare goods to the active project, and puts idle people to work (the dig crew first).
 */
export class ForemanSystem {
  private sm: StateManager;
  private maintenance: MaintenanceSystem;
  private projects: ProjectSystem;
  private population: PopulationSystem;
  private dig: DigSystem;
  private contracts: ContractSystem;
  private resources: ResourceSystem;
  private clock = 0;
  private alarmClock = 0;
  /** The last round's result per order (not saved: the first round after a load fills it again). */
  readonly last: Partial<Record<ForemanOrder, ForemanReport>> = {};

  constructor(sm: StateManager, maintenance: MaintenanceSystem, projects: ProjectSystem, population: PopulationSystem, dig: DigSystem, contracts: ContractSystem, resources: ResourceSystem) {
    this.sm = sm;
    this.contracts = contracts;
    this.resources = resources;
    this.maintenance = maintenance;
    this.projects = projects;
    this.population = population;
    this.dig = dig;
  }

  available(state: GameState): boolean {
    return (state.longGame?.meta.act ?? 0) >= FOREMAN_ACT;
  }

  isOn(state: GameState, order: ForemanOrder): boolean {
    if (FOREMAN_CHORES.includes(order)) return !!state.longGame; // [phase4] chores always run
    return !!state.longGame?.foreman.orders[order];
  }

  /** [phase4] Sets one of the policies (the Foreman screen, ui/controllers/danger.ts). */
  setPolicy(p: Partial<ForemanPolicy>): void {
    const lg = this.sm.state.longGame;
    if (!lg) return;
    const f = { ...lg.foreman };
    if (p.fightAt !== undefined) f.raidFightAt = Math.max(0, Math.min(1, p.fightAt));
    if (p.otherwise !== undefined) f.raidElse = p.otherwise;
    if (p.priority !== undefined) f.priority = p.priority;
    if (p.autoPay !== undefined) f.autoPay = Math.max(0, Math.min(1, p.autoPay));
    this.sm.applyDelta({ path: 'longGame.foreman', value: f });
  }

  private incidents: IncidentSystem | null = null;
  /** [phase4] The incident system, for the auto-pay ceiling (set by GameEngine). */
  setIncidents(inc: IncidentSystem): void {
    this.incidents = inc;
  }

  /** Turning an order on carries it out at once, so the player sees it work. */
  set(order: ForemanOrder, on: boolean): void {
    const lg = this.sm.state.longGame;
    if (!lg) return;
    this.sm.applyDelta({ path: 'longGame.foreman.orders', value: { ...lg.foreman.orders, [order]: on } });
    if (on && this.available(this.sm.state)) this.run(order);
    else delete this.last[order];
    // [plan4:GP-8] Turning the door order off ends its duty: what it shut stays as it is (the Safety card opens it), nothing is reopened later.
    if (!on && order === 'sealOnAlarm' && (lg.foreman.sealed?.length ?? 0) > 0) this.sm.applyDelta({ path: 'longGame.foreman.sealed', value: [] });
  }

  /** Seconds until the next round. */
  nextRoundIn(): number {
    return Math.max(0, FOREMAN_ROUND - this.clock);
  }

  update(dt: number): void {
    this.alarmClock += dt;
    if (this.alarmClock >= ALARM_EVERY) {
      this.alarmClock = 0;
      const st = this.sm.state;
      if (this.available(st) && this.isOn(st, 'sealOnAlarm')) this.last.sealOnAlarm = this.sealOnAlarm();
      if (this.available(st)) this.autoPay(); // [phase4]
    }
    this.clock += dt;
    if (this.clock < FOREMAN_ROUND) return;
    this.clock = 0;
    const state = this.sm.state;
    if (!this.available(state)) return;
    for (const o of [...FOREMAN_CHORES, ...KEPT_ORDERS, ...FOREMAN_ORDERS]) if (this.isOn(state, o)) this.run(o); // [phase4] the chores always
  }

  private run(order: ForemanOrder): void {
    this.last[order] = order === 'maintain' ? this.maintain() : order === 'deposit' ? this.deposit()
      : order === 'staff' ? this.staff() : order === 'train' ? this.train() : order === 'sealOnAlarm' ? this.sealOnAlarm() : this.takeContracts();
  }

  /** [phase4] How many fixes the auto-pay ceiling paid since the game opened (not saved; the Foreman screen says it). */
  paid = 0;

  /**
   * [phase4] The incident auto-pay ceiling (C5): a quick fix, or the handling of a disaster on the clock, that asks no more of the Act's
   * currency than the ceiling allows is paid at once. Above the ceiling it waits for the player.
   */
  private autoPay(): void {
    const inc = this.incidents;
    const share = foremanPolicy(this.sm.state).autoPay;
    if (!inc || share <= 0) return;
    for (const i of [...(this.sm.state.incidents ?? [])]) {
      if (actShareOf(this.sm.state, quickFixCost(this.sm.state, i.kind)) > share) continue;
      if (inc.canQuickFix(i.id) && inc.quickFix(i.id)) this.paid++;
    }
    for (const dz of [...this.sm.state.danger.disasters]) {
      if (actShareOf(this.sm.state, disasterCost(this.sm.state, dz.kind)) > share) continue;
      if (!inc.handleBlock(dz.id) && inc.handle(dz.id)) this.paid++;
    }
  }

  /**
   * [plan4:GP-8 #7] While a fire, an epidemic or a raid is on, shuts the open doors around it (the same doors the Safety card's button
   * shuts); when the trouble is over, opens again only the doors it shut itself and that are still shut (a door the player changed
   * since stays as the player left it). The list of its doors is saved (foreman.sealed), so a reload in the middle does not leave them shut.
   */
  private sealOnAlarm(): ForemanReport {
    const state = this.sm.state;
    const mine = state.longGame?.foreman.sealed ?? [];
    if (troubleOn(state)) {
      if (!doorsOperable(state)) return { key: 'sealBlackout' };
      const targets = emergencyDoorTargets(state);
      if (targets.length === 0) return mine.length ? { key: 'sealShut', n: mine.length } : { key: 'sealNone' };
      const keys = targets.map(t => `${t.floor}:${t.x}`);
      const n = closeEmergencyDoors(this.sm);
      if (n > 0) this.sm.applyDelta({ path: 'longGame.foreman.sealed', value: [...new Set([...mine, ...keys])] });
      return { key: 'sealShut', n: n || mine.length };
    }
    if (mine.length === 0) return { key: 'sealNone' };
    if (!doorsOperable(state)) return { key: 'sealBlackout' };
    let opened = 0;
    const left: string[] = [];
    for (const key of mine) {
      const [f, x] = key.split(':').map(Number);
      if (getDoor(this.sm.state, f, x) !== 'closed') continue; // opened, sealed or removed by the player meanwhile
      if (setDoorState(this.sm, f, x, 'open') === null) opened++;
      else left.push(key);
    }
    this.sm.applyDelta({ path: 'longGame.foreman.sealed', value: left });
    return opened ? { key: 'sealOpened', n: opened } : { key: 'sealNone' };
  }

  /** [Q9] Quick paid training for the most experienced workers who can still rank up (the training room's job, handed over). */
  private train(): ForemanReport {
    const state = this.sm.state;
    if (!state.buildings.some(b => b.type === 'trainingRoom')) return { key: 'trainNoRoom' };
    const k = state.resources.knowledge;
    if (k.amount < k.cap * TRAIN_KNOWLEDGE_SHARE) return { key: 'trainSaving' };
    let n = 0;
    for (let i = 0; i < TRAIN_PER_ROUND; i++) {
      const pick = this.sm.state.survivors
        .filter(v => this.population.canTrain(this.sm.state, this.resources, v) && this.spareFor(v))
        .sort((a, b) => (b.mxp ?? 0) - (a.mxp ?? 0) || rankOf(b) - rankOf(a))[0];
      if (!pick || !this.population.train(this.sm, this.resources, pick.id)) break;
      n++;
    }
    return n ? { key: 'trained', n } : { key: 'trainIdle' };
  }

  /**
   * [phase4] Training is a chore now (always on), so it may only spend what is truly spare: every good it asks (food, knowledge, components)
   * must stay at or above TRAIN_KNOWLEDGE_SHARE of its store after the lesson. Without this the Foreman fed the lessons the bunker's food.
   */
  private spareFor(v: Parameters<PopulationSystem['canTrain']>[2]): boolean {
    const state = this.sm.state;
    for (const [r, n] of Object.entries(trainingCost(v, state.longGame?.meta.act ?? 1))) {
      const res = state.resources[r as keyof typeof state.resources];
      if (!res || res.amount - (n ?? 0) < res.cap * TRAIN_KNOWLEDGE_SHARE) return false;
    }
    return true;
  }

  /** [Q9] Answers the contracts that cost nothing the bunker would miss; the rest wait in the inbox for the player. */
  private takeContracts(): ForemanReport {
    if (!this.contracts.active(this.sm.state)) return { key: 'contractsIdle' };
    const n = this.contracts.acceptSafe();
    if (n) return { key: 'contractsTaken', n };
    return this.contracts.open(this.sm.state).length > 0 ? { key: 'contractsWait' } : { key: 'contractsIdle' };
  }

  private maintain(): ForemanReport {
    let done = 0;
    let short = 0;
    for (const b of this.sm.state.buildings) {
      if (wearOf(b) < MAINTAIN_AT) continue;
      if (this.maintenance.canMaintain(this.sm.state, b) && this.maintenance.maintain(b.id)) done++;
      else short++;
    }
    if (done) return { key: 'maintained', n: done };
    return short ? { key: 'maintainShort', n: short } : { key: 'maintainIdle' };
  }

  private deposit(): ForemanReport {
    const id = this.sm.state.activeProjectId;
    if (!id) return { key: 'noProject' };
    const given = Object.values(this.projects.deposit(id)).reduce((a, v) => a + (v ?? 0), 0);
    return given ? { key: 'deposited', n: Math.round(given) } : { key: 'depositIdle' };
  }

  /** [phase4] The goods the resource priority puts first: the Act's currency, or the scarcest of food, water and power. */
  private priorityGoods(state: GameState): string[] {
    const p = foremanPolicy(state).priority;
    if (p === 'act') return [ACT_CURRENCY[Math.min(ACT_CURRENCY.length - 1, Math.max(1, state.longGame?.meta.act ?? 1))]];
    if (p === 'basics') {
      const fill = (r: 'food' | 'water' | 'power'): number => { const x = state.resources[r]; return x && x.cap > 0 ? x.amount / x.cap : 1; };
      return (['food', 'water', 'power'] as const).slice().sort((a, b) => fill(a) - fill(b)).slice(0, 1);
    }
    return [];
  }

  /** Idle adults to the dig crew first, then to the rooms with the most open places. */
  private staff(): ForemanReport {
    let placed = this.dig.autoStaff();
    // [phase4] Food or water running out and no raid on the way: the guards posted for the last raid (all but one per armory) go back to
    // work, and the short store's rooms are filled first whatever the priority says. Guards parked after a raid starved whole bunkers.
    const st0 = this.sm.state;
    const short = (['food', 'water'] as const).find(r => {
      const x = st0.resources[r];
      return !!x && x.cap > 0 && x.amount < x.cap * SHORT_SHARE && x.productionRate < x.consumptionRate;
    });
    if (short && !st0.danger.raid) {
      for (const b of st0.buildings) {
        if (b.type !== 'armory') continue;
        for (const id of b.assignedSurvivorIds.slice(1)) this.population.assignSurvivorToBuilding(this.sm, id, null);
      }
    }
    // [phase4] The resource priority fills the rooms that make its goods first (each by best fit), then everyone left goes by best fit
    // (PopulationSystem.assignIdleBestFit, Agent R).
    const first = short ? [short] : this.priorityGoods(this.sm.state);
    if (first.length) {
      const st = this.sm.state;
      for (const b of st.buildings) {
        if (b.isConstructing || !makes(b, first) || crewCount(st, b) >= (getDef(b.type)?.maxWorkers ?? 0)) continue;
        placed += this.population.assignIdleBestFit(this.sm, b.id);
      }
    }
    placed += this.population.assignIdleBestFit(this.sm);
    if (placed) return { key: 'staffed', n: placed };
    return this.sm.state.survivors.some(s => !s.assignedBuildingId && !s.child && !s.isOnMission) ? { key: 'staffFull' } : { key: 'staffIdle' };
  }
}

import { hasMutator } from '../data/mutators'; // [phase5]
import type { StateManager } from '../core/StateManager';
import type { BuildingInstance, GameState } from '../core/GameState';
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
import type { IncidentSystem } from './IncidentSystem'; // [phase4b]
import { disasterCost, quickFixCost } from '../data/incidents'; // [phase4b]
import { specOf } from '../data/specializations'; // [phase4b]
import { actCurrency } from './ThreatSystem'; // [phase4b]

/** The Foreman's standing orders (long-game plan, pillar C): routine the player hands over instead of repeating. */
export type ForemanOrder = 'maintain' | 'deposit' | 'staff' | 'train' | 'contracts' | 'sealOnAlarm';
/**
 * [phase4b] (C5) The chores are no longer switches: once the Foreman opens (Act II) he always delivers to the project, staffs and trains
 * (training only from what is truly spare), and the player never sees them. Maintenance is the crew's own (MaintenanceSystem). 'contracts'
 * keeps whatever an older save set, without a switch (the Trade tab owns contracts). Only the door order, which trades power and cut-off
 * rooms for safety, stays a switch (FOREMAN_ORDERS), next to the policies.
 */
export const FOREMAN_CHORES: ForemanOrder[] = ['deposit', 'staff', 'train'];
const KEPT_ORDERS: ForemanOrder[] = ['contracts'];
export const FOREMAN_ORDERS: ForemanOrder[] = ['sealOnAlarm'];

// ---- [phase4b] (C5) The Foreman's policies: the strategy the player sets once ----

export type RaidElse = 'pay' | 'hide';
export type ForemanPriority = 'even' | 'act';
/** Away raid policy: the odds lines the player can pick ("fight if the odds are at least ..."). */
export const RAID_FIGHT_STEPS: readonly number[] = [0.35, 0.5, 0.65, 0.8];
export const RAID_FIGHT_DEFAULT = 0.5;
/** The incident auto-pay ceilings the player can pick: a fix is paid by itself when each good it asks is at most this share of its store. */
export const AUTO_PAY_STEPS: readonly number[] = [0, 0.05, 0.15];

export interface ForemanPolicy { fightAt: number; otherwise: RaidElse; priority: ForemanPriority; autoPay: number }

export function foremanPolicy(state: GameState): ForemanPolicy {
  const f = state.longGame?.foreman;
  return {
    fightAt: typeof f?.raidFightAt === 'number' && isFinite(f.raidFightAt) ? f.raidFightAt : RAID_FIGHT_DEFAULT,
    otherwise: f?.raidElse === 'hide' ? 'hide' : 'pay',
    priority: f?.priority === 'act' ? 'act' : 'even',
    autoPay: typeof f?.autoPay === 'number' && isFinite(f.autoPay) ? f.autoPay : 0,
  };
}

/** [phase4b] The largest share of its store any good of `cost` asks (Infinity when a store is empty). */
export function costShare(state: GameState, cost: Record<string, number>): number {
  let worst = 0;
  for (const [r, need] of Object.entries(cost)) {
    if (!(need > 0)) continue;
    const have = state.resources[r as keyof typeof state.resources]?.amount ?? 0;
    worst = Math.max(worst, have > 0 ? need / have : Infinity);
  }
  return worst;
}

/** [phase4b] True when the room makes `good` (its own production or its specialty's side product). */
function makes(b: BuildingInstance, good: string): boolean {
  if (good in ((getDef(b.type)?.production ?? {}) as Record<string, unknown>)) return true;
  return good in ((specOf(b)?.extra ?? {}) as Record<string, unknown>);
}
/**
 * [plan4:GP-8 #7] 'sealOnAlarm' watches for trouble (a fire, an epidemic, a raid on the way) every few seconds instead of once a round:
 * a fire does not wait a minute. Off by default; the price is visible (shut rooms are cut off and the doors draw power).
 */
const ALARM_EVERY = 5;
/** [Q9] Training only runs while knowledge is at least this share of its cap, so the order never starves research. [phase4b] Now that
 * training is a chore that always runs, it is held to truly spare stock: every good a lesson asks stays at or above this share after it. */
const TRAIN_KNOWLEDGE_SHARE = 0.8;
/** Quick trainings per round. */
const TRAIN_PER_ROUND = 2;
/** The Foreman takes orders from this Act on (the first Act is learned by hand). */
export const FOREMAN_ACT = 2;
/** Rooms are serviced once their wear passes this. */
const MAINTAIN_AT = 40;
/** [phase4b] Seconds between the auto-pay checks (a fire does not wait for the minute round). */
const AUTO_PAY_EVERY = 5;
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
    return (state.longGame?.meta.act ?? 0) >= FOREMAN_ACT && !hasMutator(state, 'noForeman'); // [phase5] the No Foreman hardship
  }

  isOn(state: GameState, order: ForemanOrder): boolean {
    if (FOREMAN_CHORES.includes(order)) return !!state.longGame; // [phase4b] the chores always run
    return !!state.longGame?.foreman.orders[order];
  }

  /** [phase4b] Sets one or more of the policies (the Foreman card, ui/components/ExposureForeman.ts). */
  setPolicy(p: Partial<ForemanPolicy>): void {
    const lg = this.sm.state.longGame;
    if (!lg) return;
    const f = { ...lg.foreman };
    if (p.fightAt !== undefined) f.raidFightAt = Math.max(0, Math.min(1, p.fightAt));
    if (p.otherwise !== undefined) f.raidElse = p.otherwise;
    if (p.priority !== undefined) f.priority = p.priority;
    if (p.autoPay !== undefined) f.autoPay = Math.max(0, Math.min(1, p.autoPay));
    this.sm.applyDelta({ path: 'longGame.foreman', value: f });
    if (p.priority === 'act' && this.available(this.sm.state)) this.last.staff = this.staff();
  }

  private incidents: IncidentSystem | null = null;
  /** [phase4b] The incident system, for the auto-pay ceiling (set by GameEngine). */
  setIncidents(inc: IncidentSystem): void {
    this.incidents = inc;
  }

  /** [phase4b] Fixes the auto-pay ceiling paid since the game opened (not saved; the Foreman card says it). */
  paid = 0;
  private payClock = 0;

  /**
   * [phase4b] The incident auto-pay ceiling (C5): a quick fix, or the handling of a disaster on the clock, whose every good is at most the
   * ceiling's share of its store is paid at once. Above the ceiling it waits for the player (or burns, as before).
   */
  private autoPay(): void {
    const inc = this.incidents;
    const share = foremanPolicy(this.sm.state).autoPay;
    if (!inc || share <= 0) return;
    for (const i of [...(this.sm.state.incidents ?? [])]) {
      if (costShare(this.sm.state, quickFixCost(this.sm.state, i.kind)) > share) continue;
      if (inc.canQuickFix(i.id) && inc.quickFix(i.id)) this.paid++;
    }
    for (const dz of [...this.sm.state.danger.disasters]) {
      if (costShare(this.sm.state, disasterCost(this.sm.state, dz.kind)) > share) continue;
      if (!inc.handleBlock(dz.id) && inc.handle(dz.id)) this.paid++;
    }
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
    }
    this.payClock += dt;
    if (this.payClock >= AUTO_PAY_EVERY) {
      this.payClock = 0;
      if (this.available(this.sm.state)) this.autoPay(); // [phase4b]
    }
    this.clock += dt;
    if (this.clock < FOREMAN_ROUND) return;
    this.clock = 0;
    const state = this.sm.state;
    if (!this.available(state)) return;
    for (const o of [...FOREMAN_CHORES, ...KEPT_ORDERS, ...FOREMAN_ORDERS]) if (this.isOn(state, o)) this.run(o); // [phase4b] the chores always
  }

  private run(order: ForemanOrder): void {
    this.last[order] = order === 'maintain' ? this.maintain() : order === 'deposit' ? this.deposit()
      : order === 'staff' ? this.staff() : order === 'train' ? this.train() : order === 'sealOnAlarm' ? this.sealOnAlarm() : this.takeContracts();
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
        .filter(v => this.population.canTrain(this.sm.state, this.resources, v) && this.spareFor(v)) // [phase4b] only truly spare stock
        .sort((a, b) => (b.mxp ?? 0) - (a.mxp ?? 0) || rankOf(b) - rankOf(a))[0];
      if (!pick || !this.population.train(this.sm, this.resources, pick.id)) break;
      n++;
    }
    return n ? { key: 'trained', n } : { key: 'trainIdle' };
  }

  /** [phase4b] Every good a lesson asks stays at or above TRAIN_KNOWLEDGE_SHARE of its store after it (training never eats the food). */
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

  /** Idle adults to the dig crew first, then to the rooms with the most open places. */
  private staff(): ForemanReport {
    let placed = this.dig.autoStaff();
    // [phase4b] The resource priority "Act currency first": the rooms that make it are filled first (each by best fit).
    if (foremanPolicy(this.sm.state).priority === 'act') {
      const cur = actCurrency(this.sm.state);
      for (const b of this.sm.state.buildings) {
        if (b.isConstructing || !makes(b, cur) || crewCount(this.sm.state, b) >= (getDef(b.type)?.maxWorkers ?? 0)) continue;
        placed += this.population.assignIdleBestFit(this.sm, b.id);
      }
    }
    placed += this.population.assignIdleBestFit(this.sm); // [phase4] best-fit staffing (PopulationSystem), the same as the room's "fill" button
    if (placed) return { key: 'staffed', n: placed };
    return this.sm.state.survivors.some(s => !s.assignedBuildingId && !s.child && !s.isOnMission) ? { key: 'staffFull' } : { key: 'staffIdle' };
  }
}

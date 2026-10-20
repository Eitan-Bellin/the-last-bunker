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
import { rankOf } from '../data/mastery';
import { closeEmergencyDoors, doorsOperable, emergencyDoorTargets, setDoorState, troubleOn } from './InfraSystem';
import { getDoor } from './doors';

/** The Foreman's standing orders (long-game plan, pillar C): routine the player hands over instead of repeating. */
export type ForemanOrder = 'maintain' | 'deposit' | 'staff' | 'train' | 'contracts' | 'sealOnAlarm';
export const FOREMAN_ORDERS: ForemanOrder[] = ['maintain', 'deposit', 'staff', 'train', 'contracts', 'sealOnAlarm'];
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
    return !!state.longGame?.foreman.orders[order];
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
    this.clock += dt;
    if (this.clock < FOREMAN_ROUND) return;
    this.clock = 0;
    const state = this.sm.state;
    if (!this.available(state)) return;
    for (const o of FOREMAN_ORDERS) if (this.isOn(state, o)) this.run(o);
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
        .filter(v => this.population.canTrain(this.sm.state, this.resources, v))
        .sort((a, b) => (b.mxp ?? 0) - (a.mxp ?? 0) || rankOf(b) - rankOf(a))[0];
      if (!pick || !this.population.train(this.sm, this.resources, pick.id)) break;
      n++;
    }
    return n ? { key: 'trained', n } : { key: 'trainIdle' };
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
    for (const s of this.sm.state.survivors) {
      if (s.assignedBuildingId || s.child || s.isOnMission) continue;
      const st = this.sm.state;
      // [plan4:qa] Try every room with a free post, emptiest first: one the survivor cannot be put in (behind a sealed door, say) must not end the round.
      const rooms = st.buildings
        .filter(b => !b.isConstructing && crewCount(st, b) < (getDef(b.type)?.maxWorkers ?? 0))
        .sort((a, b) => ((getDef(b.type)?.maxWorkers ?? 0) - crewCount(st, b)) - ((getDef(a.type)?.maxWorkers ?? 0) - crewCount(st, a)));
      if (rooms.length === 0) break;
      if (!rooms.some(room => this.population.assignSurvivorToBuilding(this.sm, s.id, room.id))) continue;
      placed++;
    }
    if (placed) return { key: 'staffed', n: placed };
    return this.sm.state.survivors.some(s => !s.assignedBuildingId && !s.child && !s.isOnMission) ? { key: 'staffFull' } : { key: 'staffIdle' };
  }
}

import type { StateManager } from '../core/StateManager';
import type { GameState } from '../core/GameState';
import { getDef } from '../data/buildingDefs';
import { wearOf } from './MaintenanceSystem';
import type { MaintenanceSystem } from './MaintenanceSystem';
import type { ProjectSystem } from './ProjectSystem';
import type { PopulationSystem } from './PopulationSystem';
import type { DigSystem } from './DigSystem';

/** The Foreman's standing orders (long-game plan, pillar C): routine the player hands over instead of repeating. */
export type ForemanOrder = 'maintain' | 'deposit' | 'staff';
export const FOREMAN_ORDERS: ForemanOrder[] = ['maintain', 'deposit', 'staff'];
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
  private clock = 0;
  /** The last round's result per order (not saved: the first round after a load fills it again). */
  readonly last: Partial<Record<ForemanOrder, ForemanReport>> = {};

  constructor(sm: StateManager, maintenance: MaintenanceSystem, projects: ProjectSystem, population: PopulationSystem, dig: DigSystem) {
    this.sm = sm;
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
  }

  /** Seconds until the next round. */
  nextRoundIn(): number {
    return Math.max(0, FOREMAN_ROUND - this.clock);
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.clock < FOREMAN_ROUND) return;
    this.clock = 0;
    const state = this.sm.state;
    if (!this.available(state)) return;
    for (const o of FOREMAN_ORDERS) if (this.isOn(state, o)) this.run(o);
  }

  private run(order: ForemanOrder): void {
    this.last[order] = order === 'maintain' ? this.maintain() : order === 'deposit' ? this.deposit() : this.staff();
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
      const room = st.buildings
        .filter(b => !b.isConstructing && b.assignedSurvivorIds.length < (getDef(b.type)?.maxWorkers ?? 0))
        .sort((a, b) => ((getDef(b.type)?.maxWorkers ?? 0) - b.assignedSurvivorIds.length) - ((getDef(a.type)?.maxWorkers ?? 0) - a.assignedSurvivorIds.length))[0];
      if (!room || !this.population.assignSurvivorToBuilding(this.sm, s.id, room.id)) break;
      placed++;
    }
    if (placed) return { key: 'staffed', n: placed };
    return this.sm.state.survivors.some(s => !s.assignedBuildingId && !s.child && !s.isOnMission) ? { key: 'staffFull' } : { key: 'staffIdle' };
  }
}

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

  set(order: ForemanOrder, on: boolean): void {
    const lg = this.sm.state.longGame;
    if (!lg) return;
    this.sm.applyDelta({ path: 'longGame.foreman.orders', value: { ...lg.foreman.orders, [order]: on } });
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.clock < 60) return;
    this.clock = 0;
    const state = this.sm.state;
    if (!this.available(state)) return;
    if (this.isOn(state, 'maintain')) {
      for (const b of state.buildings) {
        if (wearOf(b) >= MAINTAIN_AT && this.maintenance.canMaintain(this.sm.state, b)) this.maintenance.maintain(b.id);
      }
    }
    if (this.isOn(state, 'deposit') && state.activeProjectId) this.projects.deposit(state.activeProjectId);
    if (this.isOn(state, 'staff')) this.staff();
  }

  /** Idle adults to the dig crew first, then to the rooms with the most open places. */
  private staff(): void {
    this.dig.autoStaff();
    for (const s of this.sm.state.survivors) {
      if (s.assignedBuildingId || s.child || s.isOnMission) continue;
      const st = this.sm.state;
      const room = st.buildings
        .filter(b => !b.isConstructing && b.assignedSurvivorIds.length < (getDef(b.type)?.maxWorkers ?? 0))
        .sort((a, b) => ((getDef(b.type)?.maxWorkers ?? 0) - b.assignedSurvivorIds.length) - ((getDef(a.type)?.maxWorkers ?? 0) - a.assignedSurvivorIds.length))[0];
      if (!room || !this.population.assignSurvivorToBuilding(this.sm, s.id, room.id)) break;
    }
  }
}

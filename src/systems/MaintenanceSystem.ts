import type { BuildingInstance, BuildingType, GameState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { ResourceSystem } from './ResourceSystem';
import type { BuildingSystem } from './BuildingSystem';
import { bus } from '../core/EventBus';
import { getDef, isPowerPlant } from '../data/buildingDefs';

/**
 * [Danger C3] Maintenance: rooms of level 3+ wear down (1% an hour, 2% for the reactor and the generator).
 * Wear makes a malfunction likelier (IncidentSystem reads `wearRisk`), a worn reactor risks a meltdown,
 * and a click on "Maintain" in the building panel resets it for 5% of the room's build price per level.
 * An engineer on the crew halves the wear.
 */
export const WEAR_FROM_LEVEL = 3;
const WEAR_PER_HOUR = 1;
const HOT_WEAR_PER_HOUR = 2;
/** [plan4:BL-8] Fuel plants run hot (generator, reactors); other rooms that wear double are listed here (batteries, recyclers... join in later). */
const HOT_ROOMS: BuildingType[] = ['batteryBank', 'recycler']; // [plan4:BL-9,12]
const isHot = (type: BuildingType) => (isPowerPlant(type) && !getDef(type)?.shape) || HOT_ROOMS.includes(type);
/** Wear is written back to the state in chunks (it changes slowly; no need to touch the state every tick). */
const FLUSH_SECONDS = 20;

export function wearOf(b: BuildingInstance): number {
  return b.wear ?? 0;
}

/** Wear in percent per second of work for a room, before the engineer's discount. */
export function wearRate(b: BuildingInstance): number {
  return (isHot(b.type) ? HOT_WEAR_PER_HOUR : WEAR_PER_HOUR) / 3600;
}

/** Every 10% of wear adds 20% to the odds a malfunction picks this room (1 at no wear, 3 at full wear). */
export function wearRisk(b: BuildingInstance): number {
  return 1 + 0.2 * Math.floor(wearOf(b) / 10);
}

export class MaintenanceSystem {
  private sm: StateManager;
  private resources: ResourceSystem;
  private buildings: BuildingSystem;
  private acc = 0;

  constructor(sm: StateManager, resources: ResourceSystem, buildings: BuildingSystem) {
    this.sm = sm;
    this.resources = resources;
    this.buildings = buildings;
  }

  private engineered(state: GameState, b: BuildingInstance): boolean {
    return b.assignedSurvivorIds.some(id => state.survivors.find(s => s.id === id)?.traits.includes('engineer'));
  }

  /** Called from the tick (and the offline loop): rooms of level 3+ gather wear. */
  update(dt: number): void {
    this.acc += dt;
    if (this.acc < FLUSH_SECONDS && dt < FLUSH_SECONDS) return;
    const span = this.acc;
    this.acc = 0;
    const state = this.sm.state;
    let changed = false;
    const next = state.buildings.map(b => {
      if (b.isConstructing || b.level < WEAR_FROM_LEVEL) return b;
      const cur = wearOf(b);
      if (cur >= 100) return b;
      changed = true;
      return { ...b, wear: Math.min(100, cur + wearRate(b) * span * (this.engineered(state, b) ? 0.5 : 1)) };
    });
    if (changed) this.sm.applyDelta({ path: 'buildings', value: next });
  }

  /** Materials: 5% of the room's build price for every level it has. */
  cost(state: GameState, b: BuildingInstance): Record<string, number> {
    const base = this.buildings.getBuildCost(b.type, { ...state, buildings: state.buildings.filter(x => x.id !== b.id) });
    const mats = base.materials ?? Object.values(base).reduce((a, v) => a + v, 0);
    return { materials: Math.max(3, Math.round(mats * 0.05 * Math.max(1, b.level))) };
  }

  /** A room shut down by a collapse or a meltdown. */
  isDown(state: GameState, b: BuildingInstance): boolean {
    return (state.danger?.disabled?.[b.id] ?? 0) > Date.now();
  }

  needsIt(b: BuildingInstance): boolean {
    return !b.isConstructing && (this.sm.state.danger.disabled[b.id] ?? 0) > Date.now() || !b.isConstructing && b.level >= WEAR_FROM_LEVEL && wearOf(b) >= 5;
  }

  canMaintain(state: GameState, b: BuildingInstance): boolean {
    return this.needsIt(b) && this.resources.canAfford(state, this.cost(state, b));
  }

  maintain(buildingId: string): boolean {
    const state = this.sm.state;
    const b = state.buildings.find(x => x.id === buildingId);
    if (!b || !this.needsIt(b) || !this.resources.spend(this.sm, this.cost(state, b))) return false;
    this.sm.applyDelta({ path: 'buildings', value: this.sm.state.buildings.map(x => (x.id === buildingId ? { ...x, wear: 0 } : x)) });
    // Maintaining a wrecked or melted-down room brings it back at once.
    if (this.sm.state.danger.disabled[buildingId]) {
      const { [buildingId]: _gone, ...rest } = this.sm.state.danger.disabled;
      this.sm.applyDelta({ path: 'danger', value: { ...this.sm.state.danger, disabled: rest } });
    }
    bus.emit('maintenance:done', buildingId);
    return true;
  }
}

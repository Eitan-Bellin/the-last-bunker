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
 * [phase4] (C5) Maintenance is no longer a chore with a button: the crew services every room whose wear passes CREW_SERVICE_AT on its own,
 * paying the same price, but only out of materials above CREW_RESERVE of the store. A bunker that spends its materials down to the floor
 * lets its rooms wear (and a worn reactor can melt): the danger comes from a spending decision, not from forgetting a tap.
 * The button stays only for a room shut down by a disaster ("repair now" instead of waiting it out).
 */
export const WEAR_FROM_LEVEL = 3;
const WEAR_PER_HOUR = 1;
const HOT_WEAR_PER_HOUR = 2;
/** [plan4:BL-8] Fuel plants run hot (generator, reactors); other rooms that wear double are listed here (batteries, recyclers... join in later). */
const HOT_ROOMS: BuildingType[] = ['batteryBank', 'recycler', 'dataCenter', 'alloyFoundry']; // [plan4:BL-9,12,34..36] (a geothermal vent counts as a fuel plant: isPowerPlant without a weather shape)
const isHot = (type: BuildingType) => (isPowerPlant(type) && !getDef(type)?.shape) || HOT_ROOMS.includes(type);
/** Wear is written back to the state in chunks (it changes slowly; no need to touch the state every tick). */
const FLUSH_SECONDS = 20;
/** [phase4] Wear (%) at which the crew services a room by itself (the Foreman's old threshold). */
export const CREW_SERVICE_AT = 40;
/** [phase4] The crew only pays for upkeep out of materials above this share of the store. */
export const CREW_RESERVE = 0.3;

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
    this.crewService(); // [phase4]
  }

  /** [phase4] The crew services worn rooms by itself, most worn first, while the materials above the reserve last. Returns how many. */
  crewService(): number {
    const state = this.sm.state;
    const worn = state.buildings.filter(b => !b.isConstructing && wearOf(b) >= CREW_SERVICE_AT).sort((a, b) => wearOf(b) - wearOf(a));
    if (worn.length === 0) return 0;
    const done = new Set<string>();
    for (const b of worn) {
      const cost = this.cost(this.sm.state, b);
      const mats = this.sm.state.resources.materials;
      if (!mats || mats.amount - (cost.materials ?? 0) < CREW_RESERVE * mats.cap) break;
      if (!this.resources.spend(this.sm, cost)) break;
      done.add(b.id);
    }
    if (done.size === 0) return 0;
    this.sm.applyDelta({ path: 'buildings', value: this.sm.state.buildings.map(x => (done.has(x.id) ? { ...x, wear: 0 } : x)) });
    bus.emit('maintenance:crew', done.size);
    return done.size;
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

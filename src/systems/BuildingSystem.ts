import type { GameState, BuildingType, BuildingInstance, Position } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import { bus } from '../core/EventBus';
import { getDef, effectiveLevel, isDistrict, roomFloors, roomSlots, type BuildingDef } from '../data/buildingDefs';
import { districtDef, nextDistrict } from '../data/districts';
import { BASE_FLOORS, MAX_FLOORS, allowedFloors } from '../data/zones';
import { SPEC_COST, specTotal, specsFor } from '../data/specializations';

export const SLOTS_PER_FLOOR = 12;

/**
 * S1: each upgrade level past the first costs another (costMultiplier + this), so rooms max out over days, not in the first hour.
 * Scarce inputs (scrap, blueprints) keep the old, gentler curve: they come from trips and ruins, not from rooms.
 */
export const UPGRADE_STEEPNESS = 0.6;
const SCARCE_COSTS = ['scrap', 'blueprints'];
/** NICE2: share of a room's build price handed back when it is torn down. */
export const DEMOLISH_REFUND = 0.5;

/** Why a room can't be torn down right now. */
export type DemolishBlock = 'busy' | 'incident' | 'beds' | null;

let nextBuildingId = 1;

export class BuildingSystem {
  syncNextId(state: GameState): void {
    let max = 0;
    for (const b of state.buildings) {
      const num = parseInt(b.id.replace('b_', ''), 10);
      if (num > max) max = num;
    }
    nextBuildingId = max + 1;
  }

  update(sm: StateManager, dt: number): void {
    const state = sm.state;
    let changed = false;

    for (let i = 0; i < state.buildings.length; i++) {
      const building = state.buildings[i];
      if (!building.isConstructing) continue;

      const newProgress = building.constructionProgress + dt;
      if (newProgress >= building.constructionTotal) {
        sm.applyDeltas([
          { path: `buildings.${i}.constructionProgress`, value: building.constructionTotal },
          { path: `buildings.${i}.isConstructing`, value: false },
        ]);
        changed = true;

        if (building.type === 'elevator') {
          sm.applyDelta({ path: 'currentFloors', value: state.currentFloors + 1 });
        }
        bus.emit('building:complete', building.id);
      } else {
        sm.applyDelta({ path: `buildings.${i}.constructionProgress`, value: newProgress });
      }
    }

    if (changed) {
      this.recalculateMaxPopulation(sm);
    }
  }

  getBuildCost(type: BuildingType, state: GameState): Record<string, number> {
    const def = getDef(type);
    if (!def) return {};

    const existingCount = state.buildings.filter(b => b.type === type).length;
    const multiplier = Math.pow(def.costMultiplier, existingCount);

    const costs: Record<string, number> = {};
    for (const [resource, amount] of Object.entries(def.baseCost)) {
      costs[resource] = Math.ceil(amount * multiplier);
    }
    return costs;
  }

  getUpgradeCost(building: BuildingInstance): Record<string, number> {
    const def = getDef(building.type);
    if (!def) return {};

    // S2: quarters are the bed supply, so they upgrade on a gentler factor than other rooms.
    const factor = building.type === 'quarters' ? 1 : 1.5;
    // The first upgrade keeps its old price (a quick win in the first hour); every later level climbs the steep curve.
    const steep = def.costMultiplier * Math.pow(def.costMultiplier + UPGRADE_STEEPNESS, building.level - 1) * factor;
    const gentle = Math.pow(def.costMultiplier, building.level) * factor;
    const costs: Record<string, number> = {};
    for (const [resource, amount] of Object.entries(def.baseCost)) {
      costs[resource] = Math.ceil(amount * (SCARCE_COSTS.includes(resource) ? gentle : steep));
    }
    return costs;
  }

  getUpgradeTime(building: BuildingInstance): number {
    const def = getDef(building.type);
    // S1: high levels take real time (x3 per level: a farm's last upgrade is about an hour), so they finish while away.
    return def ? Math.round(def.constructionTime * (building.level + 1) * 0.75 * Math.pow(3, Math.max(0, building.level - 1))) : 0;
  }

  canUpgrade(building: BuildingInstance): boolean {
    const def = getDef(building.type);
    return !!def && !building.isConstructing && building.level < def.maxLevel;
  }

  canPlaceBuilding(type: BuildingType, pos: Position, state: GameState): boolean {
    const def = getDef(type);
    if (!def || isDistrict(type)) return false;
    const levels = roomFloors(type);
    if (pos.floor < 0 || pos.floor + levels > state.currentFloors) return false;
    const allowed = allowedFloors(type, state.currentFloors);
    for (let f = pos.floor; f < pos.floor + levels; f++) if (!allowed.includes(f)) return false;
    const w = roomSlots(type);
    if (pos.x < 0 || pos.x + w > SLOTS_PER_FLOOR) return false;
    const top = pos.floor, bottom = pos.floor + levels - 1;

    for (const r of state.ruins ?? []) {
      if (r.floor >= top && r.floor <= bottom && pos.x < r.x + r.w && pos.x + w > r.x) return false;
    }
    for (const existing of state.buildings) {
      const eTop = existing.position.floor, eBottom = eTop + roomFloors(existing.type) - 1;
      if (eBottom < top || eTop > bottom) continue;
      const ew = roomSlots(existing.type);
      if (pos.x < existing.position.x + ew && pos.x + w > existing.position.x) return false;
    }
    return true;
  }

  /** Tunnels sideways out of the east wall into the next natural cavern. */
  canDigDistrict(state: GameState): boolean {
    return !!nextDistrict(state);
  }

  digDistrict(sm: StateManager, kind: string): BuildingInstance | null {
    const d = districtDef(kind);
    const def = getDef(kind as BuildingType);
    if (!d || !def || nextDistrict(sm.state)?.kind !== kind) return null;
    const building: BuildingInstance = {
      id: `b_${nextBuildingId++}`,
      type: kind as BuildingType,
      level: 1,
      // Districts sit just beyond the last slot, outside the concrete casing.
      position: { x: SLOTS_PER_FLOOR, y: 0, floor: d.floor },
      assignedSurvivorIds: [],
      constructionProgress: 0,
      constructionTotal: def.constructionTime,
      isConstructing: true,
      specialization: null,
    };
    sm.applyDelta({ path: 'buildings', value: [...sm.state.buildings, building] });
    bus.emit('district:dig', building.id);
    return building;
  }
  placeBuilding(type: BuildingType, pos: Position, sm: StateManager): BuildingInstance | null {
    const def = getDef(type);
    if (!def) return null;
    if (!this.canPlaceBuilding(type, pos, sm.state)) return null;

    const building: BuildingInstance = {
      id: `b_${nextBuildingId++}`,
      type,
      level: 1,
      position: { ...pos },
      assignedSurvivorIds: [],
      constructionProgress: 0,
      constructionTotal: def.constructionTime,
      isConstructing: true,
      specialization: null,
    };

    sm.applyDelta({ path: 'buildings', value: [...sm.state.buildings, building] });
    sm.applyDelta({
      path: 'stats.totalBuildingsBuilt',
      value: sm.state.stats.totalBuildingsBuilt + 1,
    });

    return building;
  }

  upgradeBuilding(buildingId: string, sm: StateManager): boolean {
    const idx = sm.state.buildings.findIndex(b => b.id === buildingId);
    if (idx === -1) return false;

    const building = sm.state.buildings[idx];
    if (!this.canUpgrade(building)) return false;

    const time = this.getUpgradeTime(building);
    sm.applyDeltas([
      { path: `buildings.${idx}.level`, value: building.level + 1 },
      { path: `buildings.${idx}.isConstructing`, value: true },
      { path: `buildings.${idx}.constructionProgress`, value: 0 },
      { path: `buildings.${idx}.constructionTotal`, value: time },
    ]);

    this.recalculateMaxPopulation(sm);
    return true;
  }

  recalculateMaxPopulation(sm: StateManager): void {
    let maxPop = 0;
    for (const building of sm.state.buildings) {
      const pop = getDef(building.type)?.effects?.maxPopulation;
      const level = effectiveLevel(building);
      if (pop && level > 0) {
        maxPop += pop.base + pop.perLevel * (level - 1);
      }
    }
    maxPop += specTotal(sm.state, 'population');
    sm.applyDelta({ path: 'maxPopulation', value: maxPop });
  }

  /** Lays out saves from before the cross-section view: rooms packed along their zone's floor. */
  repackAll(sm: StateManager): void {
    const placed: BuildingInstance[] = [];
    const sorted = [...sm.state.buildings].sort((a, b) => a.position.floor - b.position.floor || a.position.x - b.position.x || a.position.y - b.position.y);
    for (const b of sorted) {
      const probe = { ...sm.state, buildings: placed };
      const floors = allowedFloors(b.type, sm.state.currentFloors);
      const preferred = floors.includes(b.position.floor) ? b.position.floor : floors[0];
      let pos = this.findFreeSpot(b.type, preferred, probe);
      for (const f of floors) {
        if (pos) break;
        pos = this.findFreeSpot(b.type, f, probe);
      }
      placed.push({ ...b, position: pos ?? { x: 0, y: 0, floor: preferred } });
    }
    sm.applyDelta({ path: 'buildings', value: placed });
  }

  findFreeSpot(type: BuildingType, floor: number, state: GameState): Position | null {
    for (let x = 0; x < SLOTS_PER_FLOOR; x++) {
      const pos = { x, y: 0, floor };
      if (this.canPlaceBuilding(type, pos, state)) return pos;
    }
    return null;
  }

  digCost(state: GameState): Record<string, number> {
    const extra = state.currentFloors - BASE_FLOORS;
    // M2: B4-B8 cost 180 / 306 / 520 / 884 / 1503 materials, so the first dig fits the base 300 cap.
    return {
      materials: Math.round(180 * Math.pow(1.7, extra)),
      scrap: 25 + 20 * extra,
    };
  }

  canDig(state: GameState): boolean {
    return state.currentFloors < MAX_FLOORS;
  }

  /** Dig costs that storage can't even hold yet: the player needs a (bigger) Storage Room first. */
  digOverCap(state: GameState): { resource: string; cap: number; cost: number } | null {
    for (const [r, cost] of Object.entries(this.digCost(state))) {
      const cap = state.resources[r as keyof GameState['resources']]?.cap ?? Infinity;
      if (cost > cap) return { resource: r, cap: Math.floor(cap), cost };
    }
    return null;
  }

  /** NICE2: what stops a room from being torn down (null = it can go). */
  demolishBlock(state: GameState, buildingId: string): DemolishBlock {
    const b = state.buildings.find(x => x.id === buildingId);
    if (!b || isDistrict(b.type) || b.type === 'elevator') return 'busy';
    // No tearing down a room that is on fire, flooding or otherwise in trouble.
    if ((state.incidents ?? []).some(i => i.buildingId === buildingId)) return 'incident';
    const pop = getDef(b.type)?.effects?.maxPopulation;
    const level = effectiveLevel(b);
    if (pop && level > 0) {
      const beds = pop.base + pop.perLevel * (level - 1) + (specsFor(b.type).find(sp => sp.id === b.specialization)?.population ?? 0);
      // Nobody may be left without a bed.
      if (state.maxPopulation - beds < state.survivors.length) return 'beds';
    }
    return null;
  }

  /** Half of what the newest room of this type cost to build. */
  demolishRefund(state: GameState, buildingId: string): Record<string, number> {
    const b = state.buildings.find(x => x.id === buildingId);
    const def = b ? getDef(b.type) : undefined;
    if (!b || !def) return {};
    const count = Math.max(0, state.buildings.filter(x => x.type === b.type).length - 1);
    const out: Record<string, number> = {};
    for (const [r, amount] of Object.entries(def.baseCost)) {
      const v = Math.floor(amount * Math.pow(def.costMultiplier, count) * DEMOLISH_REFUND);
      if (v > 0) out[r] = v;
    }
    return out;
  }

  /** Tears a room down: its slots free up, its crew goes idle. The caller pays out the refund. */
  demolish(sm: StateManager, buildingId: string): boolean {
    const state = sm.state;
    if (this.demolishBlock(state, buildingId)) return false;
    sm.applyDelta({ path: 'buildings', value: state.buildings.filter(b => b.id !== buildingId) });
    sm.applyDelta({
      path: 'survivors',
      value: sm.state.survivors.map(x => (x.assignedBuildingId === buildingId ? { ...x, assignedBuildingId: null } : x)),
    });
    this.recalculateMaxPopulation(sm);
    bus.emit('building:demolished', buildingId);
    return true;
  }

  dig(sm: StateManager): void {
    sm.applyDelta({ path: 'currentFloors', value: sm.state.currentFloors + 1 });
    bus.emit('floor:dug', sm.state.currentFloors - 1);
  }
  /** A room at its top level can be fitted out for one of its two roles (permanent). */
  canSpecialize(state: GameState, buildingId: string): boolean {
    const b = state.buildings.find(x => x.id === buildingId);
    const def = b ? getDef(b.type) : undefined;
    return !!b && !!def && !b.isConstructing && !b.specialization && b.level >= def.maxLevel && specsFor(b.type).length > 0;
  }

  specialize(sm: StateManager, buildingId: string, specId: string): boolean {
    const state = sm.state;
    const b = state.buildings.find(x => x.id === buildingId);
    if (!b || !this.canSpecialize(state, buildingId) || !specsFor(b.type).some(s => s.id === specId)) return false;
    sm.applyDelta({ path: 'buildings', value: state.buildings.map(x => (x.id === buildingId ? { ...x, specialization: specId } : x)) });
    this.recalculateMaxPopulation(sm);
    bus.emit('building:specialized', buildingId);
    return true;
  }

  specCost(): Record<string, number> {
    return { ...SPEC_COST } as Record<string, number>;
  }

  getDefinition(type: BuildingType): BuildingDef | undefined {
    return getDef(type);
  }

  getMaxWorkers(type: BuildingType): number {
    return getDef(type)?.maxWorkers ?? 0;
  }
}

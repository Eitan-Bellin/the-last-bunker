import { hasFeature } from './ResearchSystem';
import { BASE_EAST, createLayout, floorExtent, type GameState, type BuildingType, type BuildingInstance, type Position } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import { bus } from '../core/EventBus';
import { getDef, effectiveLevel, isDistrict, roomFloors, roomSlots, specLevel, touching, actMult, type BuildingDef } from '../data/buildingDefs';
import { actOf, levelCapFor } from '../data/acts';
import { TUNING } from '../data/tuning';
import { scenarioOf } from '../data/scenarios';
import { actPrice, digHours, floorAct, levelAct, payableHours, upgradeHours } from '../data/pricing';
import { districtDef, nextDistrict } from '../data/districts';
import { WING_STEP, floorDigging, freeDigSlot, wingBlock, wingCost, wingCrew, wingOptions, wingSeconds, type WingOption } from '../data/wings';
import type { DigState } from '../core/state/longGame';
import { BASE_FLOORS, MAX_FLOORS, allowedFloors } from '../data/zones';
import { RETOOL_PRICE_MULT, RETOOL_SECONDS, SPEC_COST, specTotal, specsFor } from '../data/specializations';
import { RELOCATE_SECONDS, relocateBlock, relocateCost, stateWithout } from './relocate'; // [plan4:ST-19]

/** Slots east of the shaft on a floor without a wing. [plan4:X-2] Placement reads floorExtent(state, floor); this stays exported for tools. */
export const SLOTS_PER_FLOOR = BASE_EAST;

/** Why a room cannot be placed at a spot; null = it can. 'floor' = no such floor / not placeable on the grid, 'bounds' = outside the floor's extent, 'zone' = wrong zone for the type. */
export type PlaceBlock = 'floor' | 'bounds' | 'zone' | 'ruin' | 'overlap'
  // [plan4:BL-1] surface = a surface-row room off the (open) surface row, adjacency = needs a neighbour of a given type, locked = its story flag is not set, copies = the type's limit is reached
  | 'surface' | 'adjacency' | 'locked' | 'copies';

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
    this.artisan = !!state.prestige.upgrades['ksArtisan'];
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
    // [plan4:BL-5] Rooms with priceByAct cost more in later Acts (x1 .. x5); every older room keeps its price (factor 1).
    const act = def.priceByAct ? actMult(actOf(state).id) : 1;

    const costs: Record<string, number> = {};
    for (const [resource, amount] of Object.entries(def.baseCost)) {
      costs[resource] = Math.ceil(amount * multiplier * act);
    }
    return costs;
  }

  /** [P5] Set by the engine each tick from the Artisan keystone (getUpgradeCost has no state). */
  artisan = false;

  getUpgradeCost(building: BuildingInstance): Record<string, number> {
    const def = getDef(building.type);
    if (!def) return {};
    // [Long game] From Mk4 on, a level costs hours of its Act's income (pricing.ts); scrap and blueprints keep their gentle curve.
    // Rooms with five levels (districts, halls) count each level as two.
    const mk = Math.round(((building.level + 1) * 10) / def.maxLevel);
    if (mk >= 4) {
      // [P5] The Artisan keystone: a sixth cheaper (and the doubled steps of five-level rooms).
      const act = levelAct(mk);
      const hours = Math.min(payableHours(act), upgradeHours(mk) * (def.maxLevel < 10 ? 2 : 1)) * (this.artisan ? 0.85 : 1);
      const costs = actPrice(act, hours);
      const gentle = Math.pow(def.costMultiplier, Math.min(building.level, 5));
      for (const r of SCARCE_COSTS) if (def.baseCost[r]) costs[r] = Math.ceil(def.baseCost[r] * gentle);
      return costs;
    }

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
    if (!def) return 0;
    // S1: high levels take real time (x3 per level: a farm's last classic upgrade is about an hour), so they finish while away.
    // [Long game] Past the classic top, each level doubles the last classic time, up to maxUpgradeSeconds.
    const classic = specLevel(def);
    const at = (l: number) => def.constructionTime * (l + 1) * 0.75 * Math.pow(3, Math.max(0, l - 1));
    const t = building.level < classic ? at(building.level) : at(classic - 1) * Math.pow(2, building.level - classic + 1);
    return Math.round(Math.min(TUNING.maxUpgradeSeconds, t));
  }

  /** With a state, the Act's level ceiling applies too (see upgradeBlock for why a room cannot go up). */
  canUpgrade(building: BuildingInstance, state?: GameState): boolean {
    const def = getDef(building.type);
    if (!def || building.isConstructing) return false;
    return building.level < (state ? levelCapFor(state, def.maxLevel) : def.maxLevel);
  }

  /** Why a room cannot be upgraded right now: at its top, held by the Act, busy; null = it can. */
  upgradeBlock(building: BuildingInstance, state: GameState): 'max' | 'act' | 'busy' | null {
    const def = getDef(building.type);
    if (!def || building.level >= def.maxLevel) return 'max';
    if (building.isConstructing) return 'busy';
    if (building.level >= levelCapFor(state, def.maxLevel)) return 'act';
    return null;
  }

  canPlaceBuilding(type: BuildingType, pos: Position, state: GameState): boolean {
    return this.placeBlock(type, pos, state) === null;
  }

  /** [plan4:X-2] Why a room cannot stand here (null = it can). Same truth table as the old canPlaceBuilding, with the reason. */
  placeBlock(type: BuildingType, pos: Position, state: GameState): PlaceBlock | null {
    const def = getDef(type);
    if (!def || isDistrict(type)) return 'floor';
    const levels = roomFloors(type);
    const place = def.place;
    // [plan4:BL-1] Surface rooms stand on the gate-house row (floor -1) once it is open; nobody else may use floor -1.
    if (place?.floors === 'surface') {
      if (pos.floor !== -1 || !state.layout?.surfaceOpen) return 'surface';
    } else if (pos.floor < 0 || pos.floor + levels > state.currentFloors) return 'floor';
    if (place?.needsFlag && !state.storyFlags.includes(place.needsFlag)) return 'locked';
    if (def.maxCopies !== undefined && state.buildings.filter(b => b.type === type).length >= def.maxCopies) return 'copies';
    const allowed = allowedFloors(type, state.currentFloors);
    for (let f = pos.floor; f < pos.floor + levels; f++) if (!allowed.includes(f)) return 'zone';
    const w = roomSlots(type);
    // Every floor the room spans must reach the whole width (valid slots x in [-west, east)).
    for (let f = pos.floor; f < pos.floor + levels; f++) {
      const ext = floorExtent(state, f);
      if (pos.x < -ext.w || pos.x + w > ext.e) return 'bounds';
    }
    const top = pos.floor, bottom = pos.floor + levels - 1;

    for (const r of state.ruins ?? []) {
      if (r.floor >= top && r.floor <= bottom && pos.x < r.x + r.w && pos.x + w > r.x) return 'ruin';
    }
    for (const existing of state.buildings) {
      const eTop = existing.position.floor, eBottom = eTop + roomFloors(existing.type) - 1;
      if (eBottom < top || eTop > bottom) continue;
      const ew = roomSlots(existing.type);
      if (pos.x < existing.position.x + ew && pos.x + w > existing.position.x) return 'overlap';
    }
    // [plan4:BL-1] Must touch a room of the given type on the same floor (fish ponds by the lake, a ward by the medbay).
    if (place?.adjacentTo) {
      const spot = { type, position: { x: pos.x, floor: pos.floor } };
      if (!state.buildings.some(o => o.type === place.adjacentTo && touching(o, spot))) return 'adjacency';
    }
    return null;
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
      position: { x: floorExtent(sm.state, d.floor).e, y: 0, floor: d.floor },
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
    if (!this.canUpgrade(building, sm.state)) return false;

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
    // [Long game] The Act holds the bunker's size; nobody already inside is ever turned out.
    const maxPop = Math.min(bedsBuilt(sm.state), Math.max(bedCap(sm.state), sm.state.survivors.length));
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
    const ext = floorExtent(state, floor);
    for (let x = -ext.w; x < ext.e; x++) {
      const pos = { x, y: 0, floor };
      if (this.canPlaceBuilding(type, pos, state)) return pos;
    }
    return null;
  }

  digCost(state: GameState): Record<string, number> {
    const extra = state.currentFloors - BASE_FLOORS;
    // M2: B4-B8 cost 180 / 306 / 520 / 884 / 1503 materials, so the first dig fits the base 300 cap.
    // [Long game] From B7 a floor costs hours of its Act's income (pricing.ts); scrap keeps growing by 20 a floor.
    const next = state.currentFloors + 1;
    if (next >= 7) return { ...actPrice(floorAct(next), digHours(next)), scrap: 25 + 20 * extra };
    return { materials: Math.round(180 * Math.pow(1.7, extra)), scrap: 25 + 20 * extra };
  }

  /** Seconds of crew work to dig the next floor. */
  digTime(state: GameState): number {
    const n = state.currentFloors + 1;
    const table = TUNING.digSeconds;
    // [P3] Deep Drilling research: a quarter faster.
    const drill = (hasFeature(state, 'deepDrilling') ? 0.75 : 1) * (hasFeature(state, 'deepMining') ? 0.8 : 1) * (scenarioOf(state).digTime ?? 1); // [P2-1] the Deep Mining doctrine, [P3-5] the scenario
    if (n < table.length) return Math.round(table[n] * drill);
    return Math.round(table[table.length - 1] * Math.pow(TUNING.digTimeGrowth, n - (table.length - 1)) * drill);
  }

  /** People the dig needs for full speed (fewer dig proportionally slower). */
  digCrew(state: GameState): number {
    return Math.min(6, 2 + Math.floor(Math.max(0, state.currentFloors - BASE_FLOORS) / 3));
  }

  canDig(state: GameState): boolean {
    // [Long game] One floor dig at a time, and the Act sets how deep the bunker may go. [plan4:ST-3] It needs a free dig slot (a wing may hold the other).
    if (floorDigging(state) || freeDigSlot(state) < 0) return false;
    return state.currentFloors < Math.min(MAX_FLOORS, actOf(state).floorCap);
  }

  /** Why no dig can start: the Act's depth, the bunker's bottom, or every dig slot busy (null = it can). */
  digBlock(state: GameState): 'digging' | 'act' | 'max' | null {
    if (floorDigging(state) || freeDigSlot(state) < 0) return 'digging';
    if (state.currentFloors >= MAX_FLOORS) return 'max';
    if (state.currentFloors >= actOf(state).floorCap) return 'act';
    return null;
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

  /** Starts digging the next floor (paid by the caller). The crew in DigSystem does the work; the floor opens when it is done. */
  dig(sm: StateManager): void {
    const state = sm.state;
    if (!state.longGame) {
      // A state without the long game (should not happen after migration): the old instant dig.
      this.finishDig(sm);
      return;
    }
    const slot = Math.max(0, freeDigSlot(state));
    const total = this.digTime(state);
    sm.applyDelta({ path: slot === 0 ? 'longGame.dig' : 'longGame.dig2', value: { floor: state.currentFloors, paid: [], progress: 0, total, crew: [], kind: 'floor' } });
    bus.emit('dig:start', state.currentFloors, total, slot);
  }

  /**
   * [plan4:ST-3] Starts widening one side of a floor by one step (2 slots): pays the price and puts the dig in a free slot.
   * False (nothing paid) when wingBlock says no: the Act or depth caps it, a slot or the price is missing.
   */
  digWing(sm: StateManager, floor: number, side: 'w' | 'e'): boolean {
    const state = sm.state;
    if (floor < 0 || floor >= state.currentFloors || wingBlock(state, floor, side) !== null) return false;
    const cost = wingCost(state, floor);
    for (const [r, v] of Object.entries(cost)) {
      const cur = state.resources[r as keyof GameState['resources']].amount;
      sm.applyDelta({ path: `resources.${r}.amount`, value: cur - v });
    }
    const slot = freeDigSlot(state);
    const total = wingSeconds(state, floor);
    const dig: DigState = { floor, paid: [], progress: 0, total, crew: [], kind: 'wing', side };
    sm.applyDelta({ path: slot === 0 ? 'longGame.dig' : 'longGame.dig2', value: dig });
    bus.emit('wing:start', floor, side, total, slot);
    return true;
  }

  /** [plan4:ST-5] Every floor/side with what its next wing step costs and why it may not be dug (see data/wings.ts); the bot reads it from here. */
  wingOptions(state: GameState): WingOption[] {
    return wingOptions(state);
  }

  /** People a dig wants for full speed (a floor: by depth; a wing: by how many steps the floor already has). */
  crewFor(state: GameState, d: DigState | undefined): number {
    if (!d || d.floor == null) return 0;
    return d.kind === 'wing' ? wingCrew(state, d.floor) : this.digCrew(state);
  }

  /** The dig in this slot opens: a new floor, or a wing step on `d.floor`. Without `d` it is the classic floor dig. */
  finishDig(sm: StateManager, d?: DigState): void {
    if (d?.kind === 'wing' && d.floor != null && (d.side === 'w' || d.side === 'e')) { this.finishWing(sm, d.floor, d.side); return; }
    sm.applyDelta({ path: 'currentFloors', value: sm.state.currentFloors + 1 });
    bus.emit('floor:dug', sm.state.currentFloors - 1);
  }

  /** One wing step is dug: the floor reaches 2 slots further. A district tunnel on the east side is pushed out by the same. */
  private finishWing(sm: StateManager, floor: number, side: 'w' | 'e'): void {
    const state = sm.state;
    const ext = floorExtent(state, floor);
    const next = side === 'w' ? { w: ext.w + WING_STEP, e: ext.e } : { w: ext.w, e: ext.e + WING_STEP };
    const layout = state.layout ?? createLayout();
    sm.applyDelta({ path: 'layout', value: { ...layout, ext: { ...layout.ext, [String(floor)]: next } } });
    if (side === 'e' && state.buildings.some(b => isDistrict(b.type) && b.position.floor === floor)) {
      // [plan4:ST-8] The district keeps its place beyond the casing. (The renderer still draws it at DISTRICT_X until it reads position.x.)
      sm.applyDelta({ path: 'buildings', value: sm.state.buildings.map(b => (isDistrict(b.type) && b.position.floor === floor ? { ...b, position: { ...b.position, x: b.position.x + WING_STEP } } : b)) });
    }
    bus.emit('wing:dug', floor, side);
  }

  /** A room at its top level can be fitted out for one of its two roles (permanent). */
  canSpecialize(state: GameState, buildingId: string): boolean {
    const b = state.buildings.find(x => x.id === buildingId);
    const def = b ? getDef(b.type) : undefined;
    return !!b && !!def && !b.isConstructing && !b.specialization && b.level >= specLevel(def) && specsFor(b.type, state).length > 0;
  }

  /** [Long game] A specialized room may change its role (for a price, and it stands still for a while). */
  canRetool(state: GameState, buildingId: string, specId: string): boolean {
    const b = state.buildings.find(x => x.id === buildingId);
    return !!b && !b.isConstructing && !!b.specialization && b.specialization !== specId && specsFor(b.type, state).some(s => s.id === specId);
  }

  retoolCost(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [r, v] of Object.entries(SPEC_COST)) out[r] = (v ?? 0) * RETOOL_PRICE_MULT;
    return out;
  }

  /** Changes the room's role (paid by the caller). */
  retool(sm: StateManager, buildingId: string, specId: string): boolean {
    const state = sm.state;
    if (!this.canRetool(state, buildingId, specId)) return false;
    const until = (state.longGame?.meta.worldT ?? 0) + RETOOL_SECONDS;
    sm.applyDelta({ path: 'buildings', value: state.buildings.map(x => (x.id === buildingId ? { ...x, specialization: specId, retoolUntil: until } : x)) });
    this.recalculateMaxPopulation(sm);
    bus.emit('building:specialized', buildingId);
    return true;
  }

  specialize(sm: StateManager, buildingId: string, specId: string): boolean {
    const state = sm.state;
    const b = state.buildings.find(x => x.id === buildingId);
    if (!b || !this.canSpecialize(state, buildingId) || !specsFor(b.type, state).some(s => s.id === specId)) return false;
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

  /**
   * [plan4:ST-19] Moves a finished room to another spot. Allowed when the room is not being built or upgraded, has no incident and is not already
   * moving (relocate.ts), and the new spot is valid for it ignoring itself (placeBlock). Pays 10% of its build price and the room stands still
   * for 30 s (the retool clock: it produces nothing meanwhile). Its crew stays assigned. Returns false (nothing changed) when any of that fails
   * or the resources do not cover the price.
   */
  relocate(sm: StateManager, buildingId: string, pos: Position): boolean {
    const state = sm.state;
    const b = state.buildings.find(x => x.id === buildingId);
    if (!b || relocateBlock(state, b) !== null) return false;
    if (b.position.floor === pos.floor && b.position.x === pos.x) return false;
    if (this.placeBlock(b.type, pos, stateWithout(state, buildingId)) !== null) return false;
    const cost = relocateCost(this, state, b);
    for (const [r, v] of Object.entries(cost)) if ((state.resources[r as keyof GameState['resources']]?.amount ?? 0) < v) return false;
    for (const [r, v] of Object.entries(cost)) sm.applyDelta({ path: `resources.${r}.amount`, value: sm.state.resources[r as keyof GameState['resources']].amount - v });
    const lg = sm.state.longGame; // (always there in a real save; without the world clock there is no downtime to count)
    const until = lg ? Math.max(b.retoolUntil ?? 0, lg.meta.worldT) + RELOCATE_SECONDS : b.retoolUntil;
    sm.applyDelta({
      path: 'buildings',
      value: sm.state.buildings.map(x => (x.id === buildingId ? { ...x, position: { x: pos.x, y: 0, floor: pos.floor }, ...(until === undefined ? {} : { retoolUntil: until }) } : x)),
    });
    bus.emit('building:relocated', buildingId);
    return true;
  }
}

/** Beds the rooms give, before the Act's limit. */
export function bedsBuilt(state: GameState): number {
  let beds = 0;
  for (const building of state.buildings) {
    const pop = getDef(building.type)?.effects?.maxPopulation;
    const level = effectiveLevel(building);
    if (pop && level > 0) beds += pop.base + pop.perLevel * (level - 1);
  }
  return beds + specTotal(state, 'population');
}

/** The Act's limit on people in the bunker. */
export function bedCap(state: GameState): number {
  // [P5] keystone; [P2-1] the Confederation doctrine adds places.
  return Math.round(actOf(state).popCap * (state.prestige.upgrades['ksSettler'] ? 1.1 : 1)) + (hasFeature(state, 'confederation') ? 15 : 0);
}

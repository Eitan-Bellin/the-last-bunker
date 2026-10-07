import type { BuildingInstance, BuildingType, GameState, SurvivorState } from '../core/GameState';
import { floorExtent } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import { bus } from '../core/EventBus';
import { getDef, roomFloors, roomSlots } from '../data/buildingDefs';
import { isBuildingUnlocked } from './ResearchSystem';
import type { ResourceSystem } from './ResourceSystem';
import { fireCodeMult } from '../data/roomEffects';
import { doorsToShaft, getDoor, infraOfKind, infraOccupies, setDoor, shutDoorCount, type DoorState, type InfraItem, type InfraKind } from './doors';

/**
 * [plan4:ST-14/ST-15] The logic of bulkhead doors, emergency stairwells and vent stacks: what they cost, where they may stand, how a door
 * changes state, and the numbers the other systems read (fire spread, epidemic share, raid defense, power draw, fire code).
 * Pure functions over the state (plus `sm` to write); doors.ts is the data contract the renderer and the walkers read.
 */

// ---- the numbers (doc 01 ST-14, ST-15) ----
/** Power per second a shut (closed or sealed) door draws while it is shut. */
export const DOOR_DRAIN = 0.2;
export const DOOR_MAX_LEVEL = 3;
/** A fire jumps a shut door only this often (not 0: it travels in the pipes). */
export const DOOR_FIRE_CHANCE = 0.1;
/** Infection between the two sides of a shut door. */
export const DOOR_EPIDEMIC_MULT = 0.25;
/** Raid defense each shut door on the entrance floor adds, per door level; at most this many doors count. */
export const DOOR_DEFENSE_PER_LEVEL = 3;
export const DOOR_DEFENSE_DOORS = 4;
/** Seconds a shut door holds up a breach. */
export const DOOR_BREACH_FRICTION = 8;
/** Floors (index, B9 = 8) from which a room needs a stairwell within one floor, or its people are in more danger in a fire or a collapse. */
export const FIRE_CODE_FLOOR = 8;
export const FIRE_CODE_MULT = 1.5;
/** A stairwell within this many floors makes fire and collapse injuries x0.6 (the multiplier is in roomEffects). */
export const STAIRWELL_RANGE = 3;
/** Vent stacks: crowding points each takes off (max three count), and the epidemic odds each cuts. */
export const VENT_RELIEF_PER_STACK = 2;
export const VENT_MAX_STACKS = 3;
export const VENT_EPIDEMIC_MULT = 0.9;
/** The stairwell price multiplier per copy stops growing here (the plan says x1.6 per copy; six stairwells would cost 17x). */
const STAIR_COST_CAP = 4;
const MAX_COLUMN_FLOORS = 4;

/** Why something cannot be built or changed; null (where a function returns it) = it can. */
export type InfraBlock =
  | 'locked' | 'floor' | 'bounds' | 'shaft' | 'inside' | 'empty' | 'exists' | 'noSpace' | 'copies' | 'afford' | 'blackout' | 'max' | 'missing';

const asType = (k: string) => k as BuildingType;

/** Whether the research for a kind is done. */
export function infraUnlocked(state: GameState, kind: InfraKind): boolean {
  return isBuildingUnlocked(state, asType(kind));
}

function costOf(kind: InfraKind, mult: number, floors = 1): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [r, v] of Object.entries(getDef(asType(kind))?.baseCost ?? {})) out[r] = Math.ceil(v * mult * floors);
  return out;
}

/** The price of one more door. */
export function doorCost(): Record<string, number> {
  return costOf('bulkhead', 1);
}

/** The price of the next level of a door (level 1 -> 2, 2 -> 3). */
export function doorUpgradeCost(level: number): Record<string, number> {
  return costOf('bulkhead', Math.pow(getDef(asType('bulkhead'))?.costMultiplier ?? 1.5, level), 1);
}

/** The price of a stairwell or vent stack column of `floors` floors. */
export function columnCost(state: GameState, kind: 'stairwell' | 'ventStack', floors = 1): Record<string, number> {
  const def = getDef(asType(kind));
  const n = infraOfKind(state, kind).length;
  const mult = Math.min(STAIR_COST_CAP, Math.pow(def?.costMultiplier ?? 1, n));
  return costOf(kind, mult, floors);
}

// ---- doors ----

/** The bulkhead item standing on a boundary, if any. */
export function doorItem(state: GameState, floor: number, x: number): InfraItem | undefined {
  return (state.layout.infra ?? []).find(i => i.kind === 'bulkhead' && i.floor === floor && i.x === x);
}

export function doorLevel(state: GameState, floor: number, x: number): number {
  return Math.max(1, doorItem(state, floor, x)?.level ?? 1);
}

/** Rooms (or hall halves) on a floor, as [first slot, last slot]. */
function spansOnFloor(state: GameState, floor: number): { b: BuildingInstance; lo: number; hi: number }[] {
  const out: { b: BuildingInstance; lo: number; hi: number }[] = [];
  for (const b of state.buildings) {
    if (floor < b.position.floor || floor > b.position.floor + roomFloors(b.type) - 1) continue;
    out.push({ b, lo: b.position.x, hi: b.position.x + roomSlots(b.type) - 1 });
  }
  return out;
}

/** Why a door cannot be built on this boundary (between slot x-1 and slot x of a floor); null = it can. */
export function doorBlock(state: GameState, floor: number, x: number): InfraBlock | null {
  if (!infraUnlocked(state, 'bulkhead')) return 'locked';
  if (floor < 0 || floor >= state.currentFloors) return 'floor';
  if (x === 0) return 'shaft'; // boundary 0 is the shaft itself
  const ext = floorExtent(state, floor);
  if (x - 1 < -ext.w || x > ext.e - 1) return 'bounds';
  if (getDoor(state, floor, x) !== undefined) return 'exists';
  const spans = spansOnFloor(state, floor);
  // A door goes between two rooms, not through one.
  if (spans.some(s => s.lo < x && s.hi >= x)) return 'inside';
  // And it needs a room (or a column of stairs) at one side to hang on.
  if (!spans.some(s => s.hi === x - 1 || s.lo === x)) return 'empty';
  return null;
}

/** Builds a bulkhead door on a boundary (open at first). Returns the reason it could not, or null when built. */
export function buildDoor(sm: StateManager, resources: ResourceSystem, floor: number, x: number): InfraBlock | null {
  const state = sm.state as GameState;
  const block = doorBlock(state, floor, x);
  if (block) return block;
  if (!resources.spend(sm, doorCost())) return 'afford';
  const item: InfraItem = { id: `inf_${nextInfraId(state)}`, kind: 'bulkhead', floor, x, level: 1 };
  sm.applyDelta({ path: 'layout.infra', value: [...state.layout.infra, item] });
  sm.applyDelta({ path: 'layout.doors', value: { ...state.layout.doors } });
  setDoor(state, floor, x, 'open');
  bus.emit('door:changed', { floor, x, state: 'open' as DoorState });
  bus.emit('infra:built', item);
  return null;
}

/** Why a door cannot go up a level; null = it can. */
export function doorUpgradeBlock(state: GameState, floor: number, x: number): InfraBlock | null {
  const item = doorItem(state, floor, x);
  if (!item) return 'missing';
  if ((item.level ?? 1) >= DOOR_MAX_LEVEL) return 'max';
  return null;
}

export function upgradeDoor(sm: StateManager, resources: ResourceSystem, floor: number, x: number): InfraBlock | null {
  const state = sm.state as GameState;
  const block = doorUpgradeBlock(state, floor, x);
  if (block) return block;
  const item = doorItem(state, floor, x)!;
  if (!resources.spend(sm, doorUpgradeCost(item.level ?? 1))) return 'afford';
  sm.applyDelta({ path: 'layout.infra', value: state.layout.infra.map(i => (i === item ? { ...i, level: (i.level ?? 1) + 1 } : i)) });
  return null;
}

/** The doors are powered: in a blackout (no stored power and not enough made) they stay as they are. */
export function doorsOperable(state: GameState): boolean {
  return !(state.resources.power.amount <= 0.01 && (state.powerRatio ?? 1) < 0.6);
}

/** Opens, shuts or seals a door. Returns the reason it could not, or null when done. A blackout freezes every door where it stands. */
export function setDoorState(sm: StateManager, floor: number, x: number, to: DoorState): InfraBlock | null {
  const state = sm.state as GameState;
  const now = getDoor(state, floor, x);
  if (now === undefined) return 'missing';
  if (now === to) return null;
  if (!doorsOperable(state)) return 'blackout';
  sm.applyDelta({ path: 'layout.doors', value: { ...state.layout.doors, [`${floor}:${x}`]: to } });
  bus.emit('door:changed', { floor, x, state: to });
  return null;
}

/** Open -> closed -> sealed -> open: one tap cycles a door. */
export function nextDoorState(now: DoorState): DoorState {
  return now === 'open' ? 'closed' : now === 'closed' ? 'sealed' : 'open';
}

/** The two boundaries on the edges of a room (the one at the shaft, x = 0, is left out). */
export function roomEdgeBoundaries(b: BuildingInstance): number[] {
  return [b.position.x, b.position.x + roomSlots(b.type)].filter(x => x !== 0);
}

/** Doors a fire in room `b` could use: the edges of the room and of the rooms next to it. */
function firstRingBoundaries(b: BuildingInstance): { floor: number; x: number }[] {
  const out: { floor: number; x: number }[] = [];
  for (const x of roomEdgeBoundaries(b)) out.push({ floor: b.position.floor, x });
  return out;
}

/** What "close all the doors in the area" would shut: every open door around a burning room; with an epidemic or a raid at the door, every open door. */
export function emergencyDoorTargets(state: GameState): { floor: number; x: number }[] {
  const out = new Map<string, { floor: number; x: number }>();
  const add = (floor: number, x: number) => {
    const d = getDoor(state, floor, x);
    if (d === 'open') out.set(`${floor}:${x}`, { floor, x });
  };
  const wide = state.danger?.disasters?.some(d => d.kind === 'epidemic') || !!state.danger?.raid;
  if (wide) for (const [k, v] of Object.entries(state.layout.doors)) {
    if (v !== 'open') continue;
    const [f, x] = k.split(':').map(Number);
    add(f, x);
  }
  for (const inc of state.incidents ?? []) {
    if (inc.kind !== 'fire') continue;
    const b = state.buildings.find(x => x.id === inc.buildingId);
    if (!b) continue;
    for (const d of firstRingBoundaries(b)) add(d.floor, d.x);
  }
  return [...out.values()];
}

/** Whether there is anything to shut and a reason to (a fire, an epidemic, a raid on the way). */
export function emergencyActive(state: GameState): boolean {
  return emergencyDoorTargets(state).length > 0;
}

/** Shuts the doors of emergencyDoorTargets. Returns how many were shut. */
export function closeEmergencyDoors(sm: StateManager): number {
  const state = sm.state as GameState;
  if (!doorsOperable(state)) return 0;
  const targets = emergencyDoorTargets(state);
  if (targets.length === 0) return 0;
  const doors = { ...state.layout.doors };
  for (const t of targets) doors[`${t.floor}:${t.x}`] = 'closed';
  sm.applyDelta({ path: 'layout.doors', value: doors });
  for (const t of targets) bus.emit('door:changed', { floor: t.floor, x: t.x, state: 'closed' as DoorState });
  return targets.length;
}

/** Opens every shut door (closed or sealed) in the bunker. Returns how many were opened. */
export function openAllDoors(sm: StateManager): number {
  const state = sm.state as GameState;
  if (!doorsOperable(state)) return 0;
  const doors = { ...state.layout.doors };
  const opened: string[] = [];
  for (const [k, v] of Object.entries(doors)) if (v !== 'open') { doors[k] = 'open'; opened.push(k); }
  if (opened.length === 0) return 0;
  sm.applyDelta({ path: 'layout.doors', value: doors });
  for (const k of opened) { const [floor, x] = k.split(':').map(Number); bus.emit('door:changed', { floor, x, state: 'open' as DoorState }); }
  return opened.length;
}

// ---- what the doors do to the other systems ----

/** Shut doors a fire would have to pass between two touching rooms: 0 or 1 (the shared boundary). */
export function shutDoorBetween(state: GameState, a: BuildingInstance, b: BuildingInstance): boolean {
  const x = b.position.x === a.position.x + roomSlots(a.type) ? b.position.x : a.position.x;
  const d = getDoor(state, a.position.floor, x);
  return d !== undefined && d !== 'open';
}

/** Raid defense from shut doors on the entrance floor: 3 per level of each, for at most four doors. */
export function doorDefense(state: GameState): number {
  const doors = state.layout?.doors;
  if (!doors) return 0;
  const levels: number[] = [];
  for (const [k, v] of Object.entries(doors)) {
    if (v === 'open' || !k.startsWith('0:')) continue;
    levels.push(doorLevel(state, 0, Number(k.slice(2))));
  }
  levels.sort((a, b) => b - a);
  return levels.slice(0, DOOR_DEFENSE_DOORS).reduce((n, l) => n + DOOR_DEFENSE_PER_LEVEL * l, 0);
}

/** How fast a breach in room `b` grows: 1 without doors; each shut door between the shaft and the room costs 8 seconds of the time to peak. */
export function breachSpeed(state: GameState, b: BuildingInstance, peakSeconds: number): number {
  const n = doorsToShaft(state, b.position.floor, b.position.x, roomSlots(b.type)).filter(d => d.state !== 'open').length;
  return n === 0 ? 1 : peakSeconds / (peakSeconds + DOOR_BREACH_FRICTION * n);
}

/** The power the infrastructure draws: shut doors, stairwell lights, vent fans. */
export function infraPowerDraw(state: GameState): number {
  const layout = state.layout;
  if (!layout) return 0;
  let draw = DOOR_DRAIN * shutDoorCount(state);
  const stairs = getDef(asType('stairwell'))?.powerConsumption ?? 0;
  const vents = getDef(asType('ventStack'))?.powerConsumption ?? 0;
  for (const i of layout.infra) {
    if (i.kind === 'stairwell') draw += stairs;
    else if (i.kind === 'ventStack') draw += vents;
  }
  return draw;
}

/**
 * Who catches an epidemic: the people on the shaft side of the bunker are one group, and each room behind a shut door is a group of its own.
 * Returns null when no door is shut (the old, door-free epidemic). Else a weight per person: 1 in the origin's group, 0.25 elsewhere.
 */
export function epidemicWeights(state: GameState, adults: SurvivorState[], originId: string): Map<string, number> | null {
  if (shutDoorCount(state) === 0) return null;
  const region = (s: SurvivorState): string => {
    const b = s.assignedBuildingId ? state.buildings.find(x => x.id === s.assignedBuildingId) : undefined;
    if (!b) return 'S';
    const shut = doorsToShaft(state, b.position.floor, b.position.x, roomSlots(b.type)).filter(d => d.state !== 'open').length;
    return shut === 0 ? 'S' : `${b.position.floor}:${b.position.x < 0 ? 'w' : 'e'}:${shut}`;
  };
  const origin = adults.find(a => a.id === originId);
  const home = origin ? region(origin) : 'S';
  const out = new Map<string, number>();
  for (const a of adults) out.set(a.id, region(a) === home ? 1 : DOOR_EPIDEMIC_MULT);
  return out;
}

// ---- columns: stairwells and vent stacks ----

let infraSeq = 0;
function nextInfraId(state: GameState): number {
  let max = infraSeq;
  for (const i of state.layout.infra) {
    const n = parseInt(i.id.replace('inf_', ''), 10);
    if (n > max) max = n;
  }
  infraSeq = max + 1;
  return infraSeq;
}

/** Whether the slot x is free on a floor for a column (no room, no ruin, no other column, inside the floor's reach). */
function slotFree(state: GameState, floor: number, x: number): boolean {
  const ext = floorExtent(state, floor);
  if (x < -ext.w || x >= ext.e) return false;
  if (infraOccupies(state, floor, x, 1)) return false;
  if (spansOnFloor(state, floor).some(s => x >= s.lo && x <= s.hi)) return false;
  return !(state.ruins ?? []).some(r => floor === r.floor && x >= r.x && x < r.x + r.w);
}

/** The slot a column of `floors` floors starting at `floor` would take: the far east end of the floor, else the nearest free slot (null = none). */
export function freeColumnX(state: GameState, floor: number, floors = 1): number | null {
  const ext = floorExtent(state, floor);
  for (let x = ext.e - 1; x >= -ext.w; x--) {
    let ok = true;
    for (let f = floor; f < floor + floors && ok; f++) ok = slotFree(state, f, x);
    if (ok) return x;
  }
  return null;
}

/** Why a column cannot be built; null = it can. */
export function columnBlock(state: GameState, kind: 'stairwell' | 'ventStack', floor: number, floors = 1): InfraBlock | null {
  if (!infraUnlocked(state, kind)) return 'locked';
  if (floors < 1 || floors > MAX_COLUMN_FLOORS || floor < 0 || floor + floors > state.currentFloors) return 'floor';
  const max = getDef(asType(kind))?.maxCopies;
  if (max !== undefined && infraOfKind(state, kind).length >= max) return 'copies';
  if (freeColumnX(state, floor, floors) === null) return 'noSpace';
  return null;
}

/** Builds a stairwell or vent stack column. Returns the reason it could not, or null when built. */
export function buildColumn(sm: StateManager, resources: ResourceSystem, kind: 'stairwell' | 'ventStack', floor: number, floors = 1): InfraBlock | null {
  const state = sm.state as GameState;
  const block = columnBlock(state, kind, floor, floors);
  if (block) return block;
  if (!resources.spend(sm, columnCost(state, kind, floors))) return 'afford';
  const x = freeColumnX(state, floor, floors)!;
  const item: InfraItem = { id: `inf_${nextInfraId(state)}`, kind, floor, x, ...(floors > 1 ? { floors } : {}) };
  sm.applyDelta({ path: 'layout.infra', value: [...state.layout.infra, item] });
  bus.emit('infra:built', item);
  return null;
}

/** Vent stacks that count (at most three). */
export function ventStackCount(state: GameState): number {
  return Math.min(VENT_MAX_STACKS, infraOfKind(state, 'ventStack').length);
}

// ---- the fire code ----

/** Floors from FIRE_CODE_FLOOR down that have people or rooms and no stairwell on them or next to them. */
export function fireCodeFloors(state: GameState): number[] {
  const out = new Set<number>();
  for (const b of state.buildings) {
    if (b.isConstructing && b.level === 1) continue;
    const f = b.position.floor;
    if (f >= FIRE_CODE_FLOOR && f < state.currentFloors && !isCovered(state, f)) out.add(f);
  }
  return [...out].sort((a, b) => a - b);
}

function isCovered(state: GameState, floor: number): boolean {
  return fireCodeMult(state, floor) === 1; // one rule, in roomEffects
}

/** A stairwell column within `range` floors of a floor (0 = on it). */
export function stairwellNear(state: GameState, floor: number, range = 1): boolean {
  return infraOfKind(state, 'stairwell').some(i => floor >= i.floor - range && floor <= i.floor + Math.max(1, i.floors ?? 1) - 1 + range);
}

/** Whether a fire on this floor is covered by the code (above the line, or a stairwell within one floor). */
export function fireCodeCovered(state: GameState, floor: number): boolean {
  return floor < FIRE_CODE_FLOOR || isCovered(state, floor);
}

/** Whether a fire is burning anywhere (for the safety card). */
export function fireBurning(state: GameState): boolean {
  return (state.incidents ?? []).some(i => i.kind === 'fire');
}

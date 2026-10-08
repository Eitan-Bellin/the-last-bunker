import type { GameState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import { roomFloors, roomSlots } from '../data/buildingDefs'; // [plan4:polish]

/**
 * [plan4:ST-14/ST-15] The contract of the bunker's partition doors (bulkheads) and vertical infrastructure (stairwells, vent stacks).
 * Pure functions on `state.layout`, no side effects beyond setDoor/addInfra writing the layout. The renderer (door visuals),
 * the people walkers (routes) and the game systems all code against this file; keep the names stable.
 *
 * Doors sit on a BOUNDARY between two slots of a floor: boundary x lies between slot x-1 and slot x (x = 0 is the shaft, never a door).
 * layout.doors[`${floor}:${x}`]: absent = no door (open passage), 'open' = a built bulkhead standing open, 'closed' = shut (blocks walking,
 * slows fire, stops most infection), 'sealed' = welded shut (blocks totally; the rooms behind it are cut off from the shaft).
 */

export type DoorState = 'open' | 'closed' | 'sealed';
export type InfraKind = 'bulkhead' | 'stairwell' | 'ventStack';
export interface InfraItem { id: string; kind: string; floor: number; x: number; floors?: number; level?: number }

/** Key of the door on a floor's boundary x (between slot x-1 and slot x). */
export function doorKey(floor: number, boundaryX: number): string {
  return `${floor}:${boundaryX}`;
}

/** The door's state, or undefined when the boundary has no door (an open passage). */
export function getDoor(state: Pick<GameState, 'layout'>, floor: number, boundaryX: number): DoorState | undefined {
  return state.layout?.doors?.[doorKey(floor, boundaryX)];
}

/** Writes a door's state (creating the door when new). Pure data: cost, rules and power live in InfraSystem. */
export function setDoor(state: Pick<GameState, 'layout'>, floor: number, boundaryX: number, door: DoorState): void {
  if (!state.layout.doors) state.layout.doors = {};
  state.layout.doors[doorKey(floor, boundaryX)] = door;
}

/** Removes a door (back to an open passage). */
export function removeDoor(state: Pick<GameState, 'layout'>, floor: number, boundaryX: number): void {
  if (state.layout?.doors) delete state.layout.doors[doorKey(floor, boundaryX)];
}

/** Doors a walker or a fire meets going from slot `fromSlot` to slot `toSlot` on one floor, in order of travel (boundaries strictly between the two slots). */
export function doorsBetween(state: Pick<GameState, 'layout'>, floor: number, fromSlot: number, toSlot: number): { x: number; state: DoorState }[] {
  const out: { x: number; state: DoorState }[] = [];
  const lo = Math.min(fromSlot, toSlot), hi = Math.max(fromSlot, toSlot);
  for (let x = lo + 1; x <= hi; x++) {
    const d = getDoor(state, floor, x);
    if (d) out.push({ x, state: d });
  }
  return fromSlot <= toSlot ? out : out.reverse();
}

/** Whether people can walk from one slot of a floor to another: false when any door between them is closed or sealed (sealed blocks totally). */
export function isPassable(state: Pick<GameState, 'layout'>, floor: number, fromSlot: number, toSlot: number): boolean {
  return doorsBetween(state, floor, fromSlot, toSlot).every(d => d.state === 'open');
}

/** Shut doors (closed or sealed) between two slots of a floor. */
export function closedBetween(state: Pick<GameState, 'layout'>, floor: number, fromSlot: number, toSlot: number): number {
  return doorsBetween(state, floor, fromSlot, toSlot).filter(d => d.state !== 'open').length;
}

/** Slots between the shaft and a room at slots [x, x+w-1] on its floor: from slot 0 (east) or slot -1 (west) to the room's near slot. */
function shaftSlotFor(x: number, w: number): { from: number; to: number } {
  return x >= 0 ? { from: 0, to: x } : { from: -1, to: x + w - 1 };
}

/** Doors a room at [x, x+w-1] has between it and the shaft. */
export function doorsToShaft(state: Pick<GameState, 'layout'>, floor: number, x: number, w: number): { x: number; state: DoorState }[] {
  const s = shaftSlotFor(x, w);
  return doorsBetween(state, floor, s.from, s.to);
}

/** A room cut off from the shaft by a SEALED door (people from outside cannot be assigned to it until it opens). */
export function isSealedOff(state: Pick<GameState, 'layout'>, floor: number, x: number, w: number): boolean {
  return doorsToShaft(state, floor, x, w).some(d => d.state === 'sealed');
}

/** A room behind at least one shut door (closed or sealed): its people are not reachable on foot. */
export function isShutOff(state: Pick<GameState, 'layout'>, floor: number, x: number, w: number): boolean {
  return doorsToShaft(state, floor, x, w).some(d => d.state !== 'open');
}

/** Every door of the layout as {floor, x, state}. */
export function allDoors(state: Pick<GameState, 'layout'>): { floor: number; x: number; state: DoorState }[] {
  const out: { floor: number; x: number; state: DoorState }[] = [];
  for (const [k, v] of Object.entries(state.layout?.doors ?? {})) {
    const [f, x] = k.split(':').map(Number);
    if (Number.isFinite(f) && Number.isFinite(x)) out.push({ floor: f, x, state: v });
  }
  return out;
}

/** Shut doors in the whole bunker (the power drain of closed doors counts these). */
export function shutDoorCount(state: Pick<GameState, 'layout'>): number {
  let n = 0;
  for (const v of Object.values(state.layout?.doors ?? {})) if (v !== 'open') n++;
  return n;
}

// ---- infrastructure: stairwells and vent stacks (columns of one slot on the floors they span) ----

/** Floors an infra item covers: floor .. floor + floors - 1 (a stairwell or vent stack is a column of one slot per floor). */
export function infraSpan(item: InfraItem): { top: number; bottom: number } {
  return { top: item.floor, bottom: item.floor + Math.max(1, item.floors ?? 1) - 1 };
}

/** Infra items of a kind that cover a floor (kind omitted = every kind). Bulkheads are not columns: use the door functions for them. */
export function infraAt(state: Pick<GameState, 'layout'>, kind: InfraKind | string | undefined, floor: number): InfraItem[] {
  return (state.layout?.infra ?? []).filter(i => (!kind || i.kind === kind) && floor >= infraSpan(i).top && floor <= infraSpan(i).bottom);
}

/** All infra items of a kind. */
export function infraOfKind(state: Pick<GameState, 'layout'>, kind: InfraKind | string): InfraItem[] {
  return (state.layout?.infra ?? []).filter(i => i.kind === kind);
}

/** Whether a column item (stairwell, vent stack) takes the slots [x, x+w-1] on a floor. Rooms must not be placed there. */
export function infraOccupies(state: Pick<GameState, 'layout'>, floor: number, x: number, w: number): boolean {
  for (const i of state.layout?.infra ?? []) {
    if (i.kind === 'bulkhead') continue;
    const s = infraSpan(i);
    if (floor >= s.top && floor <= s.bottom && i.x >= x && i.x < x + w) return true;
  }
  return false;
}

// ---- [plan4:polish] orphaned doors: a bulkhead belongs between rooms ----

/**
 * Doors (and their bulkhead items) that no longer stand on a room boundary: no room, hall half or ruin ends at the slot before the boundary or starts at it
 * (the room was torn down or moved away), or a room now straddles it. Same rule as InfraSystem.doorBlock; a ruin counts as a room (a wrecked room comes back).
 */
export function orphanDoorKeys(state: Pick<GameState, 'layout' | 'buildings' | 'ruins'>): string[] {
  const out: string[] = [];
  const keys = new Set<string>(Object.keys(state.layout?.doors ?? {}));
  for (const i of state.layout?.infra ?? []) if (i.kind === 'bulkhead') keys.add(doorKey(i.floor, i.x));
  for (const k of keys) {
    const [floor, x] = k.split(':').map(Number);
    if (!Number.isFinite(floor) || !Number.isFinite(x)) continue;
    const spans: { lo: number; hi: number }[] = [];
    for (const b of state.buildings) {
      if (floor < b.position.floor || floor > b.position.floor + roomFloors(b.type) - 1) continue;
      spans.push({ lo: b.position.x, hi: b.position.x + roomSlots(b.type) - 1 });
    }
    for (const r of state.ruins ?? []) if (r.floor === floor) spans.push({ lo: r.x, hi: r.x + r.w - 1 });
    const inside = spans.some(s => s.lo < x && s.hi >= x);
    const hangs = spans.some(s => s.hi === x - 1 || s.lo === x);
    if (inside || !hangs) out.push(k);
  }
  return out;
}

/** Removes every orphaned door (the state and the bulkhead item). Returns how many boundaries were cleaned. */
export function pruneOrphanDoors(sm: StateManager): number {
  const state = sm.state as GameState;
  const orphans = orphanDoorKeys(state);
  if (orphans.length === 0) return 0;
  const gone = new Set(orphans);
  if (state.layout.doors) {
    const doors = { ...state.layout.doors };
    for (const k of orphans) delete doors[k];
    sm.applyDelta({ path: 'layout.doors', value: doors });
  }
  sm.applyDelta({ path: 'layout.infra', value: state.layout.infra.filter(i => !(i.kind === 'bulkhead' && gone.has(doorKey(i.floor, i.x)))) });
  return orphans.length;
}

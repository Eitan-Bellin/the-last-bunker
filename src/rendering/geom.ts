import { isDistrict, roomFloors } from '../data/buildingDefs';
import { BASE_EAST, floorExtent as stateFloorExtent, type BuildingType, type GameState } from '../core/GameState';

// [plan4:X-2] The single module for floor and slot geometry. Every conversion between world coordinates and (floor, slot) goes through here, so the
// redesign (service floors / galleries, side wings, variable floor heights) changes one file. Today the maths is the classic fixed grid: every floor
// FLOOR_H tall, 12 slots east of the shaft, no galleries, no west wing. layout.ts re-exports all of this for the existing imports.

/** Side-on cross-section of the bunker: floors stacked downward from the surface. */
export const SLOT_W = 46;
export const ROOM_H = 100;
export const SLAB = 16;
export const FLOOR_H = ROOM_H + SLAB;
export const SHAFT_W = 58;
export const SHAFT_GAP = 6;
export const ROOMS_X = SHAFT_W + SHAFT_GAP;
/** Slots east of the shaft on a floor with no wing (the default extent {w: 0, e: BASE_EAST}). Kept as SLOTS_PER_FLOOR in BuildingSystem for tools. */
export { BASE_EAST };
export const ROOMS_W = BASE_EAST * SLOT_W;
export const BUILDING_W = ROOMS_X + ROOMS_W;
/** Ground level is y = 0; the first floor's ceiling sits this far below it. */
export const TOPSOIL = 70;
export const SIDE_MARGIN = 46;

/** Perspective inset of a room's back wall relative to its front opening. */
export const DEPTH_X = 12;
export const DEPTH_TOP = 9;
export const DEPTH_BOTTOM = 16;

/** Y of the top of a floor (its ceiling line). */
export function floorTop(floor: number): number {
  return TOPSOIL + floor * FLOOR_H;
}

/** Height of a floor including its slab; the same for every floor until service floors exist. */
export function floorH(floor: number): number {
  void floor;
  return FLOOR_H;
}

export interface FloorAt {
  /** The floor the y falls in; -1 above the ground (y < TOPSOIL). */
  floor: number;
  /** Pixels below floorTop(floor) (negative above the ground: pixels above TOPSOIL). */
  offset: number;
  /** True inside a service floor (gallery); never yet. */
  gallery: boolean;
}

/** Reverse lookup: which floor a world y belongs to. The only place that may divide by the floor height. */
export function floorAtY(y: number): FloorAt {
  if (y < TOPSOIL) return { floor: -1, offset: y - TOPSOIL, gallery: false };
  const floor = Math.floor((y - TOPSOIL) / FLOOR_H);
  return { floor, offset: y - floorTop(floor), gallery: false };
}

/** Continuous floor coordinate of a y (2.5 = halfway down floor 2), negative above ground: for gradients such as the depth fog. */
export function floorFrac(y: number): number {
  return (y - TOPSOIL) / FLOOR_H;
}

/** The floor the lift stands at after travelling `dy` pixels down from floor 0 (nearest one). */
export function floorAfterTravel(dy: number): number {
  return Math.round(dy / FLOOR_H);
}

/** Left edge of a slot. East slots (>= 0) start at the shaft's right side; west-wing slots (< 0, not used yet) mirror it left of the shaft. */
export function slotX(slot: number): number {
  return slot >= 0 ? ROOMS_X + slot * SLOT_W : -SHAFT_GAP + slot * SLOT_W;
}

/** Reverse of slotX: the slot a world x falls in, or null over the shaft (between the last west slot and slot 0). */
export function slotAtX(x: number): number | null {
  if (x >= ROOMS_X) return Math.floor((x - ROOMS_X) / SLOT_W);
  if (x < -SHAFT_GAP) return Math.floor((x + SHAFT_GAP) / SLOT_W);
  return null;
}

/** How far a floor reaches: {w: slots west of the shaft, e: slots east of it}. Valid slots are x in [-w, e). */
export function floorExtent(state: Pick<GameState, 'layout'>, floor: number): { w: number; e: number } {
  return stateFloorExtent(state, floor);
}

/** Districts open beyond the east wall, past a short tunnel through the casing. */
export const DISTRICT_GAP = 18;
export const DISTRICT_X = BUILDING_W + DISTRICT_GAP;

/** Left edge of a room in world space (districts live outside the slot grid). */
export function buildingX(b: { type: BuildingType; position: { x: number } }): number {
  return isDistrict(b.type) ? DISTRICT_X : slotX(b.position.x);
}

/** Height of a room: two-storey halls swallow the slab between their levels. */
export function buildingH(type: BuildingType): number {
  const n = roomFloors(type);
  return n * ROOM_H + (n - 1) * SLAB;
}

/** Y of the walkable floor line inside a room (local to the room's top). */
export const WALK_Y = ROOM_H - 7;

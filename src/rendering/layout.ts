import { SLOTS_PER_FLOOR } from '../systems/BuildingSystem';
import { isDistrict, roomFloors } from '../data/buildingDefs';
import type { BuildingType } from '../core/GameState';

/** Side-on cross-section of the bunker: floors stacked downward from the surface. */
export const SLOT_W = 46;
export const ROOM_H = 100;
export const SLAB = 16;
export const FLOOR_H = ROOM_H + SLAB;
export const SHAFT_W = 58;
export const SHAFT_GAP = 6;
export const ROOMS_X = SHAFT_W + SHAFT_GAP;
export const ROOMS_W = SLOTS_PER_FLOOR * SLOT_W;
export const BUILDING_W = ROOMS_X + ROOMS_W;
/** Ground level is y = 0; the first floor's ceiling sits this far below it. */
export const TOPSOIL = 70;
export const SIDE_MARGIN = 46;

/** Perspective inset of a room's back wall relative to its front opening. */
export const DEPTH_X = 12;
export const DEPTH_TOP = 9;
export const DEPTH_BOTTOM = 16;

export function floorTop(floor: number): number {
  return TOPSOIL + floor * FLOOR_H;
}

export function slotX(slot: number): number {
  return ROOMS_X + slot * SLOT_W;
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

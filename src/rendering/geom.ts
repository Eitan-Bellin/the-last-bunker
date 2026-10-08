import { isDistrict, roomFloors } from '../data/buildingDefs';
import { GFX } from './gfxFeatures';
import { BASE_EAST, floorExtent as stateFloorExtent, type BuildingType, type GameState } from '../core/GameState';

// [plan4:X-2] The single module for floor and slot geometry. Every conversion between world coordinates and (floor, slot) goes through here, so the
// redesign (service floors / galleries, side wings, variable floor heights) changes one file. Today the maths is the classic fixed grid: every floor
// FLOOR_H tall, 12 slots east of the shaft, no galleries, no west wing. layout.ts re-exports all of this for the existing imports.

/** Side-on cross-section of the bunker: floors stacked downward from the surface. */
export const SLOT_W = 46;
export const ROOM_H = 100;
/**
 * [airy:A3] Thickness of the slab between two floors. The airy pass (flag `airy`, default on) takes it from 16 to 28: the floors breathe, and the slab has room for a
 * visible walkway ledge. It is a module constant (read once, like `?gx=`), so every consumer sees one value; floors are addressed by (floor, slot) in saves, never by y,
 * so the taller pitch moves nothing that is stored.
 */
export const SLAB_CLASSIC = 16;
export const SLAB = GFX.airy ? 44 : SLAB_CLASSIC; // [airy2:D1] the corridor band: deck 30 + beam 7 + soffit 7
export const FLOOR_H = ROOM_H + SLAB;
/**
 * [airy2:D1] The front corridor (the walkway in front of each floor's rooms), measured from `floorTop(f) + ROOM_H` (the room's floor line) downward: a deck that
 * recedes (CORR_DECK deep), the beam face of the slab edge (CORR_BEAM) and the soffit under it. People travelling between rooms walk on the lane CORR_LANE below the
 * floor line; the railing stands on the deck's front edge and is CORR_RAIL tall.
 */
export const CORR_DECK = 30;
export const CORR_BEAM = 7;
export const CORR_RAIL = 14;
export const CORR_LANE = 13;
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

// [plan4:ST-1] Service floors ("galleries"): a GALLERY_H-tall crawl-space band after floors 3, 7, 11, 15 and 19 (before 4, 8, 12, 16, 20). Closed form, no saved
// state. Behind the `galleries` feature flag (gfxFeatures.ts): with it off every function below is the old uniform grid. A gallery g sits between the slab under
// floor 4g+3 and the ceiling of floor 4g+4; it is drawn only once floor 4g+3 exists.
export const GALLERY_H = 34;
/** Floors per gallery period. */
export const GALLERY_EVERY = 4;
/** One period: four floors and the gallery under them (498). */
const PERIOD = GALLERY_EVERY * FLOOR_H + GALLERY_H;
/** Five galleries (after floors 3, 7, 11, 15, 19): none under the deepest floors, so 24 floors stand 2954 tall. */
export const GALLERY_MAX = 5;

/** How many galleries lie above floor f (so floor f is pushed down by this many GALLERY_H). */
export function galleriesBefore(floor: number): number {
  return GFX.galleries && floor >= GALLERY_EVERY ? Math.min(GALLERY_MAX, ((floor - GALLERY_EVERY) >> 2) + 1) : 0;
}

/** [plan4:ST-16] Top of the surface (gate-house) row, floor -1: its floor line sits on the ground (y = 0). The formula below would give -46, half sunk into the soil. */
export const SURFACE_TOP = -ROOM_H;

/** Y of the top of a floor (its ceiling line). */
export function floorTop(floor: number): number {
  if (floor < 0) return SURFACE_TOP; // [plan4:ST-16]
  return TOPSOIL + floor * FLOOR_H + galleriesBefore(floor) * GALLERY_H;
}

/** Pitch of a floor: from its top to the top of the next one (a gallery under it counts). */
export function floorH(floor: number): number {
  return floorTop(floor + 1) - floorTop(floor);
}

/** How many galleries exist in a bunker of `floors` floors (gallery g needs floor 4g+3). */
export function galleryCount(floors: number): number {
  return GFX.galleries && floors > 0 ? Math.min(GALLERY_MAX, floors >> 2) : 0;
}

/** Y of the top of gallery g (0-based), directly under the slab of floor 4g+3. */
export function galleryTop(g: number): number {
  return TOPSOIL + (g + 1) * GALLERY_EVERY * FLOOR_H + g * GALLERY_H;
}

export interface FloorAt {
  /** The floor the y falls in; -1 above the ground (y < TOPSOIL). Inside a gallery: the floor above it (4g+3). */
  floor: number;
  /** Pixels below floorTop(floor) (negative above the ground: pixels above TOPSOIL). Inside a gallery it is past FLOOR_H. */
  offset: number;
  /** True inside a service floor (gallery). */
  gallery: boolean;
}

/** Allocation-free floor index of a y (see floorAtY); -1 above the ground, a gallery counts as the floor above it. */
export function floorIndexAt(y: number): number {
  if (y < TOPSOIL) return -1;
  const u = y - TOPSOIL;
  if (!GFX.galleries) return Math.floor(u / FLOOR_H);
  const k = Math.floor(u / PERIOD);
  if (k >= GALLERY_MAX) return GALLERY_EVERY * GALLERY_MAX + Math.floor((u - GALLERY_MAX * PERIOD) / FLOOR_H);
  const r = u - k * PERIOD;
  return r >= GALLERY_EVERY * FLOOR_H ? GALLERY_EVERY * k + GALLERY_EVERY - 1 : GALLERY_EVERY * k + Math.floor(r / FLOOR_H);
}

/** Reverse lookup: which floor a world y belongs to. The only place that may divide by the floor height. */
export function floorAtY(y: number): FloorAt {
  if (y < TOPSOIL) return { floor: -1, offset: y - TOPSOIL, gallery: false };
  const floor = floorIndexAt(y);
  const top = floorTop(floor);
  return { floor, offset: y - top, gallery: GFX.galleries && y - top >= FLOOR_H && (floor & 3) === 3 };
}

/** Continuous floor coordinate of a y (2.5 = halfway down floor 2), negative above ground: for gradients such as the depth fog. A gallery adds nothing. */
export function floorFrac(y: number): number {
  const u = y - TOPSOIL;
  if (!GFX.galleries || u < 0) return u / FLOOR_H;
  const k = Math.floor(u / PERIOD);
  if (k >= GALLERY_MAX) return (GALLERY_MAX * GALLERY_EVERY * FLOOR_H + (u - GALLERY_MAX * PERIOD)) / FLOOR_H;
  const r = Math.min(u - k * PERIOD, GALLERY_EVERY * FLOOR_H);
  return (k * GALLERY_EVERY * FLOOR_H + r) / FLOOR_H;
}

/** The floor the lift stands at after travelling `dy` pixels down from floor 0 (nearest one). */
export function floorAfterTravel(dy: number): number {
  const y = floorTop(0) + dy;
  const f = Math.max(0, floorIndexAt(y));
  return y - floorTop(f) > floorTop(f + 1) - y ? f + 1 : f;
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

export interface Ext {
  w: number;
  e: number;
}

/** [plan4:ST-4] The extent of every floor of a bunker of `floors` floors (the default {w: 0, e: 12} where the state has none). */
export function extentsFor(state: Pick<GameState, 'layout'>, floors: number): Ext[] {
  const out: Ext[] = [];
  for (let f = 0; f < floors; f++) out.push(stateFloorExtent(state, f));
  return out;
}

/** [plan4:ST-1] How far gallery g reaches: the widest of the floors above it (4g .. 4g+3, those that exist). */
export function galleryExt(exts: readonly Ext[], g: number): Ext {
  const out = { w: 0, e: BASE_EAST };
  for (let f = g * GALLERY_EVERY; f < g * GALLERY_EVERY + GALLERY_EVERY && f < exts.length; f++) {
    out.w = Math.max(out.w, exts[f].w);
    out.e = Math.max(out.e, exts[f].e);
  }
  return out;
}

/** Districts open beyond the east wall, past a short tunnel through the casing. */
export const DISTRICT_GAP = 18;
/** [plan4:ST-8] Where a district opens on a bunker without wings (position.x = BASE_EAST, which is what every older save holds): the legacy default. */
export const DISTRICT_X = BUILDING_W + DISTRICT_GAP;

/** [plan4:ST-8] Left edge of a district cavern: the end of its floor (slot `slotAt`, = the floor's east extent) plus the tunnel. */
export function districtXAt(slotAt: number): number {
  return slotX(slotAt) + DISTRICT_GAP;
}

/** Left edge of a room in world space (a district sits past the last slot of its floor and follows its own position.x, so a wing pushes it out). */
export function buildingX(b: { type: BuildingType; position: { x: number } }): number {
  return isDistrict(b.type) ? districtXAt(b.position.x) : slotX(b.position.x);
}

/** Height of a room: two-storey halls swallow the slab between their levels. */
export function buildingH(type: BuildingType): number {
  const n = roomFloors(type);
  return n * ROOM_H + (n - 1) * SLAB;
}

/** Y of the walkable floor line inside a room (local to the room's top). */
export const WALK_Y = ROOM_H - 7;

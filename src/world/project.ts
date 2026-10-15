/**
 * [world:C0] The projection: the ONLY place that turns a logical (floor, slot) into a world x and back (architecture 1.2, D1-D4).
 *
 * The logical grid is the source of truth (rooms keep (floor, slot); adjacency, doors and the economy never see an x). This module maps
 * it to the screen in one of two ways:
 * - `classic`: the tower of today. Bit-identical to the deprecated geom.ts `slotX(slot)` / `slotAtX(x)` / `districtXAt` / `buildingX`.
 * - `city` (`?city`, flag.ts): every underground stratum gets a frame with a hub atrium around the spine and a vestibule each side
 *   (CITY.frames in tokens.ts). The offset is per STRATUM, not per floor (D4), so halls, stair and vent columns and door openings stay
 *   vertical inside a stratum. The surface row (stratum 0) always keeps the classic frame.
 *
 * Y is untouched (geom.ts floorTop & co.): inverse lookups do y first (floorAtY), then `slotAtX(floor, x)`.
 * Floor argument rule: use the floor in scope; -1 for the surface row; global extents use `stripX` or the layout bounds; never invent a 0
 * (tools/sim/lint warns on `slotX(0,` without a `// floor-0:` reason).
 * Node-safe: no Pixi, no DOM. Reads geom at call time (airy / galleries flags can change SLAB at module load).
 */
import { DISTRICT_SLOTS, isDistrict, roomSlots } from '../data/buildingDefs';
import { MAX_FLOORS } from '../data/zones';
import { stratumOf, type StratumId } from '../data/strata';
import type { BuildingType } from '../core/GameState';
import { SHAFT_W, SLOT_W, SURFACE_TOP, buildingH, floorTop, ROOM_H, SLAB } from '../rendering/geom';
import { CITY as CITY_TOKENS, type CityFrameTokens } from './tokens';
import { CITY, disableCityForSession } from './flag';
import type { ExtLike, Rect, StratumFrame } from './types';

export type ProjectionKind = 'classic' | 'city';

/** The projection in use (live binding: tests switch it with __setProjectionForTests). */
export let PROJECTION: ProjectionKind = CITY ? 'city' : 'classic';

const classicFrames: StratumFrame[] = [0, 1, 2, 3, 4, 5, 6].map(s => ({ s: s as StratumId, ...CITY_TOKENS.classic }));
let cityFrames: StratumFrame[] = buildFrames(CITY_TOKENS.frames);
let frames: StratumFrame[] = PROJECTION === 'city' ? cityFrames : classicFrames;

function buildFrames(src: readonly CityFrameTokens[]): StratumFrame[] {
  return [0, 1, 2, 3, 4, 5, 6].map(s => {
    // Stratum 0 (the surface row) is always classic: the gate-house row and the portal sit on the classic slot line.
    const t = s === 0 ? CITY_TOKENS.classic : (src[s] ?? src[src.length - 1]);
    return { s: s as StratumId, hubL: t.hubL, hubR: t.hubR, vestW: t.vestW, vestE: t.vestE, tunnel: t.tunnel };
  });
}

/** Tests and tools only: switch the projection (and optionally give the city its own frames, e.g. a deliberately skewed set). */
export function __setProjectionForTests(k: ProjectionKind, cityFrameTokens?: readonly CityFrameTokens[] | null): void {
  PROJECTION = k;
  cityFrames = buildFrames(cityFrameTokens ?? CITY_TOKENS.frames);
  frames = k === 'city' ? cityFrames : classicFrames;
}

/**
 * [world:M1] Projection half of the session kill switch. Callers outside tests use `fallbackToClassic`, which flips the flag with it
 * (tools/sim/project-test checks this half alone).
 */
export function useClassicProjection(): void {
  PROJECTION = 'classic';
  frames = classicFrames;
}

/**
 * [world:M1 review] THE session kill switch, the one entry point: the city cannot run (its chunk failed to load offline, ...), so this
 * session runs the classic tower. Turns flag.ts `CITY` off and resets the projection together, so the two can never disagree. Must run
 * before anything is projected for drawing. The remembered choice is kept: the next visit tries the city again.
 */
export function fallbackToClassic(reason: string): void {
  disableCityForSession(reason);
  useClassicProjection();
}

/** [world:M1 review] The flag and the projection agree (`CITY === (PROJECTION === 'city')`); BunkerRenderer asserts it in DEV after init. */
export function worldModeConsistent(): boolean {
  return CITY === (PROJECTION === 'city');
}

/** The classic frame (the tower of today). */
export const CLASSIC_FRAME: Readonly<StratumFrame> = classicFrames[0];

/** The horizontal frame of a floor's stratum. */
export function frameOf(floor: number): StratumFrame {
  return frames[stratumOf(floor)];
}

/** The frame of a stratum. */
export function frameOfStratum(s: StratumId): StratumFrame {
  return frames[s];
}

/** Left edge of a slot on a floor. East slots (>= 0) start a vestibule past the hub; west slots (< 0) end a vestibule before it. */
export function slotX(floor: number, slot: number): number {
  const F = frames[stratumOf(floor)];
  return slot >= 0 ? F.hubR + F.vestE + slot * SLOT_W : F.hubL - F.vestW + slot * SLOT_W;
}

/** Reverse of slotX on a floor: the slot a world x falls in, or null inside the hub or a vestibule. Do the y lookup first. */
export function slotAtX(floor: number, x: number): number | null {
  const F = frames[stratumOf(floor)];
  const e0 = F.hubR + F.vestE, w1 = F.hubL - F.vestW;
  if (x >= e0) return Math.floor((x - e0) / SLOT_W);
  if (x < w1) return Math.floor((x - w1) / SLOT_W);
  return null;
}

/** Where the east rooms begin on a floor (slotX(floor, 0); the classic ROOMS_X). */
export function roomsEastX(floor: number): number {
  const F = frames[stratumOf(floor)];
  return F.hubR + F.vestE;
}

/** Where the west rooms end on a floor (the right edge of slot -1; the classic -SHAFT_GAP). */
export function roomsWestX(floor: number): number {
  const F = frames[stratumOf(floor)];
  return F.hubL - F.vestW;
}

/** Global extents (world bounds, casings, camera limits): the west-most x of a slot over every stratum's frame. Classic: slotX(slot). */
export function westmostSlotX(slot: number): number {
  let m = Infinity;
  for (const F of frames) m = Math.min(m, slot >= 0 ? F.hubR + F.vestE + slot * SLOT_W : F.hubL - F.vestW + slot * SLOT_W);
  return m;
}

/** Global extents: the east-most x of a slot over every stratum's frame. Classic: slotX(slot). */
export function eastmostSlotX(slot: number): number {
  let m = -Infinity;
  for (const F of frames) m = Math.max(m, slot >= 0 ? F.hubR + F.vestE + slot * SLOT_W : F.hubL - F.vestW + slot * SLOT_W);
  return m;
}

/** X bounds of several floors' strips (exts[i] belongs to floor from + i): the west-most x0 and the east-most x1 (stripX of each). */
export function stripBounds(exts: readonly ExtLike[], from = 0): { x0: number; x1: number } {
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < exts.length; i++) {
    const s = stripX(from + i, exts[i]);
    if (s.x0 < x0) x0 = s.x0;
    if (s.x1 > x1) x1 = s.x1;
  }
  return { x0, x1 };
}

/** X span of `slots` slots starting at `slot` (the right edge of the last slot, so a span never counts the hub). */
export function slotSpanX(floor: number, slot: number, slots: number): { x0: number; x1: number } {
  return { x0: slotX(floor, slot), x1: slotX(floor, slot + Math.max(1, slots) - 1) + SLOT_W };
}

/** The world rect of `slots` slots x `floors` storeys at (floor, slot); a two-storey hall swallows the slab between its levels. */
export function roomRect(floor: number, slot: number, slots = 1, floors = 1): Rect {
  const { x0, x1 } = slotSpanX(floor, slot, slots);
  return { x: x0, y: floorTop(floor), w: x1 - x0, h: floors * ROOM_H + (floors - 1) * SLAB };
}

/** Left edge of a district cavern on a floor: the end of the floor (slot `slotAt` = its east extent) plus the tunnel. */
export function districtXAt(floor: number, slotAt: number): number {
  return slotX(floor, slotAt) + frames[stratumOf(floor)].tunnel;
}

type Placed = { type: BuildingType; position: { x: number; floor: number } };

/** Left edge of a room in world space (a district sits past the last slot of its floor, at its own position.x). */
export function buildingX(b: Placed): number {
  return isDistrict(b.type) ? districtXAt(b.position.floor, b.position.x) : slotX(b.position.floor, b.position.x);
}

/** World width of a room (a district is DISTRICT_SLOTS wide past its tunnel). */
export function buildingW(b: Pick<Placed, 'type'>): number {
  return (isDistrict(b.type) ? DISTRICT_SLOTS : roomSlots(b.type)) * SLOT_W;
}

/** The world rect of a room (districts included). */
export function buildingRect(b: Placed): Rect {
  return { x: buildingX(b), y: floorTop(b.position.floor), w: buildingW(b), h: buildingH(b.type) };
}

/** X span of a floor's slot strip {w, e} (x0 = the west wing's outer edge, or the hub's west side when there is no west wing). */
export function stripX(floor: number, ext: ExtLike): { x0: number; x1: number } {
  return { x0: ext.w > 0 ? slotX(floor, -ext.w) : frames[stratumOf(floor)].hubL, x1: slotX(floor, ext.e) };
}

/** The spine (the lift shaft): x 0..SHAFT_W from the surface row down to the bottom of `floors` floors (default all). */
export function spineRect(floors: number = MAX_FLOORS): Rect {
  return { x: 0, y: SURFACE_TOP, w: SHAFT_W, h: floorTop(Math.max(0, floors)) - SURFACE_TOP };
}

/** The hub atrium of a stratum: hubL..hubR from its top floor's ceiling to the bottom of its last floor (galleries excluded). */
export function hubRect(s: StratumId): Rect {
  const F = frames[s];
  if (s === 0) return { x: F.hubL, y: SURFACE_TOP, w: F.hubR - F.hubL, h: ROOM_H };
  const f0 = (s - 1) * 4, f1 = f0 + 3;
  return { x: F.hubL, y: floorTop(f0), w: F.hubR - F.hubL, h: floorTop(f1) + ROOM_H + SLAB - floorTop(f0) };
}

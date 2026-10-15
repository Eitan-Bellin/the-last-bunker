/**
 * [world:C1 camera-nav] The hub stair columns as a source for the walkers' route planner (architecture D10 and 1.3): one flight column
 * per side of the spine in every hub, running lane to lane over the hub's dug storeys. Pure, Node-safe and allocation-free, so routes.ts
 * can ask it on every plan without building the whole city layout.
 *
 * The geometry is the level-builder's (src/world/model/cityLayout.ts, `HubGeom.stairs`): x is the column centre,
 * `hubL + wallW + stairInset + stairW / 2` on the west and `hubR - wallW - stairInset - stairW / 2` on the east; routes-test checks
 * the two stay equal. A column exists only when the hub has two or more dug storeys, and it never leaves its stratum (the service
 * gallery between strata has no stairs until the M2 nav graph).
 *
 * The flights are drawn by shell/hub.ts 36 units high (4 per storey); the first flight from the top runs down to the LEFT, so a walker
 * enters a column at its right landing (centre + TOWER_AMP) and zig-zags with a negative amplitude (walkers.ts: x = start + amp + amp * zig).
 * Every hop covers whole storeys, an even number of flights, so the walker also leaves on the right landing.
 */
import { FLIGHTS_PER_FLOOR, TOWER_AMP } from '../../rendering/geom';
import { stratumOf, type StratumId } from '../../data/strata';
import { PROJECTION, frameOfStratum } from '../project';
import { CITY } from '../tokens';

/** Half the zig-zag of a hub flight, signed for walkers.ts (negative: the first flight from the landing runs to the left). */
export const HUB_STAIR_AMP = -TOWER_AMP;
/** Flights per storey on a hub stair (shell/hub.ts draws one every 36 units: ROOM_H + SLAB = 144). */
export const HUB_FLIGHTS_PER_FLOOR = FLIGHTS_PER_FLOOR;

/** The world x of a hub's stair column centre on one side (city projection; classic has no hub). */
export function hubStairX(s: number, side: 'w' | 'e'): number {
  const F = frameOfStratum(Math.max(1, Math.min(6, s)) as StratumId);
  const H = CITY.hub, half = H.stairW / 2;
  return side === 'w' ? F.hubL + H.wallW + H.stairInset + half : F.hubR - H.wallW - H.stairInset - half;
}

/**
 * The x of the hub stair column nearest `nearX` that joins floors lo..hi, or NaN when there is none: classic projection, the surface
 * row, floors in different strata, or a floor not dug yet (`currentFloors`).
 */
export function hubStairFor(currentFloors: number, lo: number, hi: number, nearX: number): number {
  if (PROJECTION !== 'city' || lo < 0 || hi <= lo || hi >= currentFloors) return NaN;
  const s = stratumOf(lo);
  if (s < 1 || stratumOf(hi) !== s) return NaN;
  const w = hubStairX(s, 'w'), e = hubStairX(s, 'e');
  return Math.abs(w - nearX) <= Math.abs(e - nearX) ? w : e;
}

/** Whether x is one of the hub stair columns of the stratum of `floor` (the planner uses it to sign the flight amplitude). */
export function isHubStairX(floor: number, x: number): boolean {
  if (PROJECTION !== 'city' || floor < 0) return false;
  const s = stratumOf(floor);
  return s >= 1 && (Math.abs(x - hubStairX(s, 'w')) < 0.01 || Math.abs(x - hubStairX(s, 'e')) < 0.01);
}

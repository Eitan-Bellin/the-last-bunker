/**
 * [world:M2] The gallery transfers: the only way on foot from one stratum down to the next (architecture 1.3 "gallery transfer", M2).
 *
 * Every stratum has its own frame (CITY.frames: hub width, vestibules), so the hub stair columns of two strata do not line up. Between
 * them lies the service gallery (geom galleryTop, GALLERY_H). A transfer run, one per side of the spine, goes:
 *
 *   entry  the upper hub's stair column, RIGHT landing (column centre + TOWER_AMP), on the corridor lane of the stratum's last floor
 *          (cityLayout laneY(4s - 1)): exactly where a hub stair hop ends;
 *   down   `upperFlights` flights (an even number, first one down to the LEFT, as hub columns do) through the plaza slab to the gallery
 *          catwalk (`deckY`), ending on the right landing again;
 *   along  the level run on the catwalk to the lower hub's stair column right landing (the "jog": the two frames differ);
 *   down   `lowerFlights` flights (even, first one to the left) to the corridor lane of the lower stratum's first floor (laneY(4s));
 *   exit   the lower hub's stair column right landing on that lane: where a hub stair hop starts (and on the east / west balcony when the
 *          lower stratum has only one storey dug, so no column yet).
 *
 * `path` is that walk as a flat polyline (x, y pairs, y down), entry first, exit last, every corner listed: flight ends, the two ends of
 * the level run. Walking it at the walkers' stair speed is the whole contract; nothing else (no sprite, no door) stands on it.
 * Pure and Node-safe: routes / the nav graph can call `galleryTransfers(currentFloors)` per plan without building the city layout, and
 * `buildCityLayout(state).transfers` carries the same list (the shell draws it). See store/world-redesign/M2-L-notes.md.
 */
import { stratumOf, type StratumId } from '../../data/strata';
import { GALLERY_ABOVE_FLOORS, MAX_FLOORS } from '../../data/zones';
import { GFX } from '../../rendering/gfxFeatures';
import { CORR_LANE, FLIGHT_RISE, GALLERY_H, ROOM_H, TOWER_AMP, floorTop, galleryTop } from '../../rendering/geom';
import { PROJECTION, frameOfStratum } from '../project';
import { CITY } from '../tokens';

export type TransferSide = 'w' | 'e';

/** One end of a transfer run: the hub stair column landing on a floor's corridor lane. */
export interface TransferEnd {
  s: StratumId;
  floor: number;
  /** The stair column centre (HubGeom.stairs x of this side). */
  column: number;
  /** The landing the walker stands on: column + TOWER_AMP (the right landing). */
  x: number;
  /** The corridor lane of `floor` (cityLayout laneY). */
  y: number;
}

export interface TransferRun {
  /** `t:<g>:<side>` */
  id: string;
  g: number;
  side: TransferSide;
  upper: TransferEnd;
  lower: TransferEnd;
  /** The gallery catwalk's walking line (y). */
  deckY: number;
  /** Flights from the upper lane to the deck and from the deck to the lower lane (both even, both start to the LEFT). */
  upperFlights: number;
  lowerFlights: number;
  /** The level run on the deck: from the upper column's right landing to the lower one's (x0 = upper.x, x1 = lower.x; may run either way). */
  run: { x0: number; x1: number; y: number };
  /** The whole walk, flat x, y pairs, entry (upper.x, upper.y) first, exit (lower.x, lower.y) last. */
  path: number[];
  /** Length of `path` in world units. */
  length: number;
}

export interface GalleryTransfer {
  /** The gallery index (geom galleryTop(g)); it lies under floor GALLERY_ABOVE_FLOORS[g] = 4g + 3. */
  g: number;
  upper: StratumId;
  lower: StratumId;
  /** The gallery band. */
  y0: number;
  y1: number;
  deckY: number;
  /** West run first, then east. */
  runs: TransferRun[];
}

const laneOf = (floor: number): number => floorTop(floor) + ROOM_H + CORR_LANE;

/** The hub stair column centre of a stratum on one side (same formula as cityLayout HubGeom.stairs and nav/hubStairs hubStairX). */
export function transferColumnX(s: StratumId, side: TransferSide): number {
  const F = frameOfStratum(s), H = CITY.hub, half = H.stairW / 2;
  return side === 'w' ? F.hubL + H.wallW + H.stairInset + half : F.hubR - H.wallW - H.stairInset - half;
}

/** An even number of flights (at least 2) of about FLIGHT_RISE each for a drop. */
function evenFlights(drop: number): number {
  return Math.max(2, 2 * Math.round(drop / (2 * FLIGHT_RISE)));
}

/** The y of the gallery catwalk under floor `upperFloor` (the classic gallery.ts catwalk line); no gallery band: the lower floor's ceiling. */
export function transferDeckY(g: number): number {
  return GFX.galleries ? galleryTop(g) + CITY.transfer.deckDy : floorTop(GALLERY_ABOVE_FLOORS[g] + 1);
}

/** One run (exported for tests and the shell): the polyline from the upper landing to the lower one. */
export function transferRun(g: number, side: TransferSide): TransferRun {
  const upperFloor = GALLERY_ABOVE_FLOORS[g], lowerFloor = upperFloor + 1;
  const su = stratumOf(upperFloor), sl = stratumOf(lowerFloor);
  const cu = transferColumnX(su, side), cl = transferColumnX(sl, side);
  const upper: TransferEnd = { s: su, floor: upperFloor, column: cu, x: cu + TOWER_AMP, y: laneOf(upperFloor) };
  const lower: TransferEnd = { s: sl, floor: lowerFloor, column: cl, x: cl + TOWER_AMP, y: laneOf(lowerFloor) };
  const deckY = transferDeckY(g);
  const nu = evenFlights(deckY - upper.y), nl = evenFlights(lower.y - deckY);
  const path: number[] = [upper.x, upper.y];
  // Down to the deck: left, right, ... ending on the right landing (an even count).
  for (let k = 1; k <= nu; k++) path.push(k % 2 ? cu - TOWER_AMP : cu + TOWER_AMP, upper.y + ((deckY - upper.y) * k) / nu);
  // Along the catwalk (the jog between the two frames); a zero-length run adds no point.
  if (Math.abs(lower.x - upper.x) > 1e-6) path.push(lower.x, deckY);
  for (let k = 1; k <= nl; k++) path.push(k % 2 ? cl - TOWER_AMP : cl + TOWER_AMP, deckY + ((lower.y - deckY) * k) / nl);
  let length = 0;
  for (let i = 2; i < path.length; i += 2) length += Math.hypot(path[i] - path[i - 2], path[i + 1] - path[i - 1]);
  return { id: `t:${g}:${side}`, g, side, upper, lower, deckY, upperFlights: nu, lowerFlights: nl, run: { x0: upper.x, x1: lower.x, y: deckY }, path, length };
}

/**
 * Every transfer a bunker of `currentFloors` dug floors can walk: gallery g once the lower stratum's first floor (4g + 4) is dug (then the
 * whole upper stratum is dug too, so its stair column exists). City projection only: classic has no hubs, so the list is empty.
 */
export function galleryTransfers(currentFloors: number): GalleryTransfer[] {
  if (PROJECTION !== 'city') return [];
  const out: GalleryTransfer[] = [];
  const n = Math.max(0, Math.min(MAX_FLOORS, currentFloors | 0));
  GALLERY_ABOVE_FLOORS.forEach((above, g) => {
    if (above + 1 >= n) return;
    const y0 = GFX.galleries ? galleryTop(g) : floorTop(above + 1);
    out.push({
      g, upper: stratumOf(above), lower: stratumOf(above + 1), y0, y1: y0 + (GFX.galleries ? GALLERY_H : 0), deckY: transferDeckY(g),
      runs: [transferRun(g, 'w'), transferRun(g, 'e')],
    });
  });
  return out;
}

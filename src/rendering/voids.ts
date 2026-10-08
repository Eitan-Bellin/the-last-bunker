import type { Grid } from './occupancy';
import { cellAt } from './occupancy';
import { slotX } from './geom';

/**
 * [airy2:D3] Cluster voids: the bunker's floors are split into clusters of 3 to 5 slots by narrow shafts of cut rock (a stair tower stands in each, a catwalk crosses
 * on every floor), so the silhouette reads as connected volumes, not one block. Pure data (no Pixi) so the walking code can use it too.
 *
 * The voids sit on the slot grid (the boundary between slot k-1 and slot k, x = slotX(k)) and are the same on every floor, so a void is one tall shaft. A floor on
 * which a room reaches across the boundary has no void (the room bridges it). The slot grid never moves: a void is drawn over the room edges on either side of
 * the boundary, like a pier.
 */

/** Width of a void in world units (centred on its boundary). */
export const VOID_W = 30;
/** Width of the stair tower standing in front of a void (landings included). */
export const TOWER_W = 54;

const memo = new WeakMap<Grid, number[]>();

/** Whether a room (or ruin) reaches across the boundary before slot `sl` on floor f. */
export function straddles(grid: Grid, f: number, sl: number): boolean {
  const a = cellAt(grid, f, sl - 1), b = cellAt(grid, f, sl);
  return !!(a && b && a.id && a.id === b.id);
}

/** The boundaries (slot indices, east of the shaft) where voids stand, west to east: clusters of 3 to 5 slots, each void where the fewest floors have a room across it. */
export function voidBoundaries(grid: Grid): number[] {
  const hit = memo.get(grid);
  if (hit) return hit;
  const out: number[] = [];
  let maxE = 0;
  for (const e of grid.ext) maxE = Math.max(maxE, e.e);
  let last = 0;
  for (;;) {
    let best = -1, bestScore = -1;
    for (let sl = last + 3; sl <= last + 5 && sl <= maxE - 2; sl++) {
      let free = 0, floors = 0;
      for (let f = 0; f < grid.length; f++) {
        if (grid.ext[f].e <= sl) continue;
        floors++;
        if (!straddles(grid, f, sl)) free++;
      }
      // Prefer the boundary with the most free floors; at equal score the one nearest 4 slots from the last void.
      const score = (floors ? free / floors : 1) * 100 - Math.abs(sl - last - 4) * 3;
      if (score > bestScore) { bestScore = score; best = sl; }
    }
    if (best < 0) break;
    out.push(best);
    last = best;
  }
  memo.set(grid, out);
  return out;
}

/** World x of the middle of every void (for the stair towers and the walkers). */
export function voidXs(grid: Grid): number[] {
  return voidBoundaries(grid).map(slotX);
}

import { Rectangle, Texture } from 'pixi.js';
import type { Grid } from './occupancy';
import { cellAt } from './occupancy';
import { slotX } from './geom';
import { straddles, voidBoundaries } from './voids'; // [airy2:D3]

/**
 * [airy:A2,A3,A4] Small helpers of the spacious-bunker pass (flag `airy`): the pier layout of a floor and the walkway-ledge texture.
 * Pure drawing data; frontChunks.ts decides where to use it.
 */

/** Width of a pier by tier (see `piersOfFloor`): a thin seam pillar, the pier between two different rooms, the cluster bulkhead with its rock slit. */
export const PIER_W = [8, 13, 20] as const;
/** Ambient-occlusion width beside a pier, by tier. */
export const PIER_AO = [5, 9, 12] as const;

export interface Pier {
  /** Slot-grid x of the boundary (world x). */
  x: number;
  /** 0 = seam between two rooms of the same kind (a merged compound), 1 = pier between different kinds, 2 = cluster bulkhead. */
  tier: 0 | 1 | 2;
}

/**
 * The piers of one floor, west to east, between its rooms (not the end walls or the shaft). With `airy` off only the classic ones: a column where
 * the compound key changes (tier 1). With it on, also a thin seam where two separate rooms of the same kind meet, and every boundary that closes a
 * cluster becomes a bulkhead (tier 2): a cluster is closed at the first kind boundary at least 3 slots after the previous bulkhead (or the shaft),
 * and at any boundary 5 slots after it, so a floor reads as blocks of 3 to 5 slots with a bulkhead between them rather than one wall.
 */
export function piersOfFloor(grid: Grid, f: number, airy: boolean): Pier[] {
  const out: Pier[] = [];
  const row = grid[f];
  if (!row) return out;
  const ew = grid.ext[f]?.w ?? 0;
  const voids = airy ? new Set(voidBoundaries(grid)) : null; // [airy2:D3] east of the shaft the bulkheads are the global voids
  let last = -ew;
  for (let i = 1; i < row.length; i++) {
    const sl = i - ew;
    if (sl === 0) { last = 0; continue; } // the shaft stands between the last west slot and slot 0
    const a = row[i - 1], b = row[i];
    if (voids && sl > 0 && voids.has(sl)) {
      if (!straddles(grid, f, sl)) out.push({ x: slotX(sl), tier: 2 });
      continue;
    }
    if (!(a || b)) continue;
    let tier: 0 | 1 | 2;
    if (a?.key !== b?.key) tier = 1;
    else if (airy && a && b && a.id !== b.id) tier = 0;
    else continue;
    if (airy && sl < 0) {
      const run = sl - last;
      if ((tier === 1 && run >= 3) || run >= 5) {
        tier = 2;
        last = sl;
      }
    }
    out.push({ x: slotX(sl), tier });
  }
  return out;
}

/** [airy2:D1] The cluster a world x sits in: between the bulkheads (tier 2 piers) of its floor, or the ends `lo` / `hi` of the floor's rooms. */
export function clusterSpan(piers: readonly Pier[], x: number, lo: number, hi: number): [number, number] {
  let a = lo, b = hi;
  for (const p of piers) {
    if (p.tier !== 2) continue;
    if (p.x <= x) a = Math.max(a, p.x);
    else b = Math.min(b, p.x);
  }
  return [a, b];
}

/** Signature piece: what `piersOfFloor` reads of a slot (key plus the building id, so a second room of the same kind next door redraws the seam). */
export function pierKey(grid: Grid, f: number, s: number): string {
  const c = cellAt(grid, f, s);
  return c ? `${c.key}@${c.id ?? ''}` : '-';
}

export const LEDGE_H = 8;
const R = 4;
const LEDGE_W = 46;
let ledge: Texture | null = null;
const slices = new Map<number, Texture>();

/**
 * Walkway ledge along the front of a floor slab (one slot wide, 46 x 8; the pattern repeats every 2.875 so slots join): the lit grating top, a yellow-and-black
 * safety edge, and the dark beam face under it that the brackets hang from.
 */
export function ledgeTexture(): Texture {
  if (ledge) return ledge;
  const c = document.createElement('canvas');
  c.width = LEDGE_W * R;
  c.height = LEDGE_H * R;
  const g = c.getContext('2d')!;
  const P = 2.875;
  // Grating top: pale arris, then a dark mesh with lighter bars.
  g.fillStyle = 'rgba(206,204,192,0.96)';
  g.fillRect(0, 0, c.width, 1.1 * R);
  g.fillStyle = 'rgba(46,48,48,0.96)';
  g.fillRect(0, 1.1 * R, c.width, 2.7 * R);
  g.fillStyle = 'rgba(150,152,146,0.55)';
  for (let x = 0.5; x < LEDGE_W; x += P) g.fillRect(x * R, 1.4 * R, 1.1 * R, 2.2 * R);
  // Safety stripe: alternating yellow and charcoal.
  for (let x = 0, k = 0; x < LEDGE_W - 0.01; x += P, k++) {
    g.fillStyle = k % 2 ? 'rgba(26,24,20,0.97)' : 'rgba(217,164,65,0.95)';
    g.fillRect(x * R, 3.8 * R, P * R, 1.1 * R);
  }
  // The beam face: dark steel with a faint top light and a shadow edge.
  const bf = g.createLinearGradient(0, 4.9 * R, 0, LEDGE_H * R);
  bf.addColorStop(0, 'rgba(74,76,76,0.97)');
  bf.addColorStop(1, 'rgba(22,22,24,0.97)');
  g.fillStyle = bf;
  g.fillRect(0, 4.9 * R, c.width, (LEDGE_H - 4.9) * R);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(0, (LEDGE_H - 0.8) * R, c.width, 0.8 * R);
  ledge = Texture.from(c);
  return ledge;
}

/** The first `w` units (rounded to a quarter) of the ledge, for a segment shorter than a slot (the slab ends); a full slot is the texture itself. */
export function ledgeSlice(w: number): Texture {
  const base = ledgeTexture();
  if (w >= LEDGE_W - 0.01) return base;
  const q = Math.max(1, Math.round(w * 4));
  let t = slices.get(q);
  if (!t) {
    t = new Texture({ source: base.source, frame: new Rectangle(0, 0, (q / 4) * R, LEDGE_H * R) });
    slices.set(q, t);
  }
  return t;
}

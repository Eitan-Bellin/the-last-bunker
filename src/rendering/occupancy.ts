import type { BuildingInstance, BuildingType, Ruin } from '../core/GameState';
import { isDistrict, isHall, roomSlots } from '../data/buildingDefs';
import { BASE_EAST, type Ext } from './geom';

/**
 * [plan4:ST-4] What stands in every slot of every floor, as pure data (no Pixi, so the sim/lint tools and the walking code can use it too).
 * Moved out of structure.ts unchanged except for the optional `type` / `id` / `ruin` on a cell ([plan4:ST-13]: the door openings need to know what stands
 * on either side of a column); structure.ts re-exports everything, so existing imports keep working.
 */

export type Cell = {
  key: string;
  /** [plan4:ST-13] The room (or ruin) that fills the cell: its type and id (a ruin has neither type nor a door). */
  type?: BuildingType;
  id?: string;
  ruin?: boolean;
} | null;

/**
 * The occupancy of every floor: row f holds the floor's slots from -w to e - 1 (index i = slot i - w; slot 0 is the first east of the shaft, the
 * shaft itself is not a cell), `ext[f]` is the {w, e} the row was built for. A bunker with no wings has rows of 12 and w = 0, as before.
 */
export type Grid = Cell[][] & { ext: Ext[] };

/** The cell of slot s on floor f (null outside the floor's reach). */
export function cellAt(grid: Grid, f: number, s: number): Cell {
  return grid[f]?.[s + (grid.ext[f]?.w ?? 0)] ?? null;
}

/** What stands in every slot of every floor: a compound key per room/ruin, or null for an empty bay. */
export function occupancy(buildings: readonly BuildingInstance[], ruins: readonly Ruin[], floors: number, exts: readonly Ext[] = []): Grid {
  const ext: Ext[] = Array.from({ length: floors }, (_, f) => exts[f] ?? { w: 0, e: BASE_EAST });
  const grid = ext.map(x => Array.from({ length: x.w + x.e }, () => null as Cell)) as Grid; // [plan4:X-2] one row = the floor's slots (the default extent: 12 east)
  grid.ext = ext;
  const put = (f: number, x: number, w: number, key: string, meta: { type?: BuildingType; id?: string; ruin?: boolean }) => {
    if (f < 0 || f >= floors) return;
    const o = ext[f].w;
    for (let i = x; i < x + w; i++) if (i + o >= 0 && i + o < grid[f].length) grid[f][i + o] = { key, ...meta };
  };
  for (const b of buildings) {
    if (isDistrict(b.type)) continue;
    const fresh = b.isConstructing && b.level === 1;
    // Same-type, same-level neighbours open into one compound (no column between them).
    const key = fresh ? b.id : `${b.type}:${b.level}`;
    const w = roomSlots(b.type);
    put(b.position.floor, b.position.x, w, isHall(b.type) ? b.id : key, { type: b.type, id: b.id });
    if (isHall(b.type)) put(b.position.floor + 1, b.position.x, w, b.id, { type: b.type, id: b.id });
  }
  for (const r of ruins) put(r.floor, r.x, r.w, r.id, { id: r.id, ruin: true });
  return grid;
}

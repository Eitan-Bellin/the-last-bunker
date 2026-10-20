/** [world:C0] Shared world types of "The City Below" (Node-safe, types only). */
import type { StratumId } from '../data/strata';

export type { StratumId, KitId, PocketDef, StratumDef } from '../data/strata';

/** An axis-aligned world rectangle (world units, y down). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One stratum's horizontal frame (see CITY.frames in src/world/tokens.ts): the hub atrium hubL..hubR around the spine (x 0..58), the
 * west and east vestibules before the first room, and the district tunnel.
 */
export interface StratumFrame {
  s: StratumId;
  hubL: number;
  hubR: number;
  vestW: number;
  vestE: number;
  tunnel: number;
}

/** A floor's logical extent: slots west of the spine (w) and east of it (e); valid slots are [-w, e). */
export interface ExtLike {
  w: number;
  e: number;
}

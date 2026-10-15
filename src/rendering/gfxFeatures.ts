import type { QualityLevel } from '../utils/PerformanceMonitor';

/**
 * Graphics upgrade (plan 2026-10, phase A/B): which of the new finish features run at each quality level.
 *
 * The renderer calls `setGfxQuality(level)` once a frame with the live level (postfx.ts QUALITY_PROFILE decides the
 * level, crash-guard lite mode forces 'low'); everything new reads `GFX` and stays cheap to ask.
 *
 *   fade        cross-fade between 3D animation frames and turns (a few extra sprites for 0.15 s)
 *   place       a person's tint follows the lamp pools of the painting they stand in front of
 *   wallShadow  a skewed dark copy of the body on the back wall (one extra sprite set per person)
 *   beams       soft light shafts under the big lamps (a few additive sprites per lit room)
 *   sitSleep    people use the set: sit on benches and bed edges, sleep in bunks, eat at the table
 *   skyLayers   the panorama's sky and landscape drift on separate parallax layers
 *
 * Plan 4 structure switches [plan4:X-6]. Nothing reads them yet; the structure agents gate their new drawing on them so
 * each can be A/B-measured and switched off for a regression check. All on by default at every level.
 *   wings       side wings west/east of the shaft (per-floor extents, layout.ext)
 *   galleries   service floors / galleries between the main floors
 *   strata      rock layers and the stepped casing (geology)
 *   walkers     people walking between rooms and the lift with passengers
 *   surfaceRow  the gate-house row above ground
 * [plan4:ST-11/13/14/17] Wave 2 structure switches, same rules:
 *   floorId     floor identity: per-kind tint, light colour, paint band and number tag, column / slab / ceiling variants
 *   openings    door openings in the columns between rooms and the corridor stub where a wing ends
 *   bulkheads   bulkhead doors, stairwells and vent stacks (state.layout.doors / .infra)
 *   branches    separate feed lines (red power, blue water) along the wings that a closed bulkhead cuts
 *
 * Debug override: `?gx=-wings,-strata` turns those off, `?gx=wings` (or `+wings`) forces one on, `?gx=-all` turns all of the
 * plan 4 switches off. Names not in the list are ignored. Read once at load; it never touches the save.
 */
export interface GfxFeatures {
  fade: boolean;
  place: boolean;
  wallShadow: boolean;
  beams: boolean;
  sitSleep: boolean;
  skyLayers: boolean;
  wings: boolean;
  galleries: boolean;
  strata: boolean;
  walkers: boolean;
  surfaceRow: boolean;
  floorId: boolean;
  openings: boolean;
  bulkheads: boolean;
  branches: boolean;
  /** [airy:A1] spacious-bunker pass: room gaps, taller floors, clusters, airier camera. `?gx=-airy` gives the old dense look. */
  airy: boolean;
}

/** The plan 4 structure switches (also the names `?gx=` understands). */
export const PLAN4_FLAGS = ['wings', 'galleries', 'strata', 'walkers', 'surfaceRow', 'floorId', 'openings', 'bulkheads', 'branches'] as const;
type Plan4Flag = typeof PLAN4_FLAGS[number] | 'airy';
/** Names `?gx=` understands: the plan 4 switches plus `airy` (not part of `-all`, it is a visual pass of its own). */
const GX_NAMES: readonly string[] = [...PLAN4_FLAGS, 'airy'];
const P4_ON = { wings: true, galleries: true, strata: true, walkers: true, surfaceRow: true, floorId: true, openings: true, bulkheads: true, branches: true, airy: true };

export const GFX_FEATURES: Record<QualityLevel, GfxFeatures> = {
  high: { fade: true, place: true, wallShadow: true, beams: true, sitSleep: true, skyLayers: true, ...P4_ON },
  medium: { fade: true, place: true, wallShadow: true, beams: true, sitSleep: true, skyLayers: true, ...P4_ON },
  // Low: only the free ones (plan 6.4: Q1 and Q2 stay on, the rest off).
  low: { fade: true, place: true, wallShadow: false, beams: false, sitSleep: true, skyLayers: false, ...P4_ON },
};

/** Applies `?gx=-wings,-strata` to every level's table (so the quality switch in `setGfxQuality` keeps the override). */
function applyGxQuery(search: string): void {
  const raw = new URLSearchParams(search).get('gx');
  if (!raw) return;
  for (const part of raw.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const off = t.startsWith('-');
    const name = t.replace(/^[-+]/, '');
    const names: readonly string[] = name === 'all' ? PLAN4_FLAGS : [name];
    for (const n of names) {
      if (!GX_NAMES.includes(n)) continue;
      for (const lvl of Object.values(GFX_FEATURES)) lvl[n as Plan4Flag] = !off;
    }
  }
}
try {
  if (typeof location !== 'undefined') applyGxQuery(location.search);
} catch {
  // no location (headless tools): defaults stand
}

/** The live feature set (mutated in place by `setGfxQuality`, so callers can hold the reference). */
export const GFX: GfxFeatures = { ...GFX_FEATURES.high };

let level: QualityLevel = 'high';
let wasLite = false;

export function setGfxQuality(q: QualityLevel, lite = false): void {
  const key: QualityLevel = lite ? 'low' : q;
  if (key === level && lite === wasLite) return;
  level = key;
  wasLite = lite;
  Object.assign(GFX, GFX_FEATURES[key]);
  if (lite) {
    // Lite mode (two abnormal exits in an hour) turns every new finish feature off.
    GFX.wallShadow = GFX.beams = GFX.skyLayers = false;
  }
}

export function gfxLevel(): QualityLevel {
  return level;
}

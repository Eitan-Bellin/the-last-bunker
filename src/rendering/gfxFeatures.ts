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
 */
export interface GfxFeatures {
  fade: boolean;
  place: boolean;
  wallShadow: boolean;
  beams: boolean;
  sitSleep: boolean;
  skyLayers: boolean;
}

export const GFX_FEATURES: Record<QualityLevel, GfxFeatures> = {
  high: { fade: true, place: true, wallShadow: true, beams: true, sitSleep: true, skyLayers: true },
  medium: { fade: true, place: true, wallShadow: true, beams: true, sitSleep: true, skyLayers: true },
  // Low: only the free ones (plan 6.4: Q1 and Q2 stay on, the rest off).
  low: { fade: true, place: true, wallShadow: false, beams: false, sitSleep: true, skyLayers: false },
};

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

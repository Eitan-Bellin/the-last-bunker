/**
 * [world:C1-Li] The city's ambience follows the camera down the strata (style guide 2 "every stratum has ... its sound", tokens AUDIO).
 *
 * This module is the bridge between the picture and the sound, and it is pure: the renderer's walkers write what the camera sees into
 * `lifeHints` once a picture (the view centre, the zoom, how many people are in view, how deep the city is dug), and the audio engine
 * reads them when it updates its mix (AudioEngine.setAmbience, a few times a second) and asks `cityMix` for the gain of every stratum
 * bed and of the crowd. The beds themselves are synthesized like the era beds (src/audio/cityBeds.ts, rendered offline, looped).
 * Classic mode never writes the hints (`ok` stays false), so nothing changes there.
 */
import { AUDIO, LIFE } from '../tokens';
import { stratumSeamY, storeyBottom } from '../model/cityLayout';
import { TOPSOIL } from '../../rendering/geom';

export const STRATA_N = 7;

/** What the picture tells the sound (written by Walkers.update / Walkers.life, read by AudioEngine). No allocation. */
export const lifeHints = {
  /** True once a city picture has been drawn. */
  ok: false,
  /** World y of the view centre and the camera zoom. */
  cy: 0,
  zoom: 1,
  /** People standing or walking in view (rooms included), and how many floors are dug. */
  crowd: 0,
  floors: 0,
};

/** Half-width (world units) of the crossfade band around a stratum seam (the service gallery between two strata). */
const SEAM_BAND = 90;

function smooth(e0: number, e1: number, x: number): number {
  const k = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
}

/** How much of each stratum's bed is heard with the view centre at world y `cy` (sums to 1). */
export function strataWeights(cy: number, out: Float32Array): void {
  // Boundary k sits between stratum k and k + 1: the ground for k = 0, the seam gallery below.
  let prev = 1; // share of "at or below the boundary above"
  for (let s = 0; s < STRATA_N; s++) {
    const below = s < STRATA_N - 1 ? smooth((s === 0 ? TOPSOIL : stratumSeamY(s)) - SEAM_BAND, (s === 0 ? TOPSOIL : stratumSeamY(s)) + SEAM_BAND, cy) : 0;
    out[s] = Math.max(0, prev - below);
    prev = below;
  }
}

/** Gains the mix wants right now (written by `cityMix`): per stratum bed, and the shared crowd murmur. */
export interface CityMix {
  beds: Float32Array;
  crowd: number;
}

export function newCityMix(): CityMix {
  return { beds: new Float32Array(STRATA_N), crowd: 0 };
}

const w = new Float32Array(STRATA_N);

/**
 * The city ambience mix for the current hints: each stratum bed at AUDIO.strata[s].master times its weight, ducked to AUDIO.mapDuck on
 * the map (`far`), and the crowd murmur scaled by the people in view (a full hub of ~12 is full level) and quieted below the dug city
 * (AUDIO.fogQuiet: the unknown is quiet). Returns false while there is no city picture.
 */
export function cityMix(far: boolean, out: CityMix): boolean {
  const h = lifeHints;
  if (!h.ok) return false;
  strataWeights(h.cy, w);
  const duck = far ? AUDIO.mapDuck : 1;
  let crowd = 0;
  for (let s = 0; s < STRATA_N; s++) {
    const st = AUDIO.strata[s];
    out.beds[s] = w[s] * st.master * duck;
    crowd += w[s] * (st.layers.crowd ?? 0);
  }
  const people = Math.min(1, h.crowd / LIFE.idle.max.high + 0.15);
  const unknown = h.floors > 0 && h.cy > storeyBottom(h.floors - 1) + 40;
  out.crowd = crowd * people * duck * (unknown ? AUDIO.fogQuiet.crowd : 1);
  return true;
}

import { ArtLibrary } from '../art/ArtLibrary';

/**
 * Plan 2026-10 Q2: where the lamp pools of a painting are. One horizontal strip of brightness and colour, measured
 * once from the painting's body height (where people stand), so a survivor darkens between the lamps and warms up
 * under one instead of wearing the same tint across the whole room. Costs one 64x24 canvas read per painting, no GPU work.
 */
export interface LightProfile {
  /** Columns across the painting, left to right. */
  n: number;
  /** Brightness factor per column, 0.88 (between the pools) .. 1.1 (under a lamp). */
  k: Float32Array;
  /** Colour factor per column (r, g, b), close to 1: the local cast of the light. */
  c: Float32Array;
}

const N = 48;
const cache = new Map<string, LightProfile>();
let scratch: HTMLCanvasElement | null = null;

/** The profile of a painting key (e.g. `rooms/quarters-1`), or null while its texture is not loaded. */
export function lightProfile(key: string): LightProfile | null {
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = ArtLibrary.get(key);
  const res = tex?.source?.resource as CanvasImageSource | undefined;
  if (!tex || !res) return null;
  const H = 24;
  const cv = (scratch ??= document.createElement('canvas'));
  cv.width = N;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let d: Uint8ClampedArray;
  try {
    ctx.clearRect(0, 0, N, H);
    ctx.drawImage(res, 0, 0, N, H);
    d = ctx.getImageData(0, 0, N, H).data;
  } catch {
    return null;
  }
  // Rows from 40% to 95% of the painting: the part of the room a standing body overlaps.
  const y0 = Math.floor(H * 0.4), y1 = Math.ceil(H * 0.95);
  const lum = new Float32Array(N), rr = new Float32Array(N), gg = new Float32Array(N), bb = new Float32Array(N);
  for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * N + x) * 4;
      r += d[i]; g += d[i + 1]; b += d[i + 2];
    }
    const n = (y1 - y0) * 255;
    rr[x] = r / n; gg[x] = g / n; bb[x] = b / n;
    lum[x] = 0.3 * rr[x] + 0.59 * gg[x] + 0.11 * bb[x];
  }
  // A little smoothing (a body is wider than one column), then relative to the room's own mean.
  const sm = (a: Float32Array) => {
    const o = new Float32Array(N);
    for (let x = 0; x < N; x++) o[x] = (a[Math.max(0, x - 1)] + 2 * a[x] + a[Math.min(N - 1, x + 1)]) / 4;
    return o;
  };
  const L = sm(sm(lum)), R = sm(sm(rr)), G = sm(sm(gg)), B = sm(sm(bb));
  let mean = 0;
  for (let x = 0; x < N; x++) mean += L[x];
  mean = Math.max(0.02, mean / N);
  const k = new Float32Array(N), c = new Float32Array(N * 3);
  for (let x = 0; x < N; x++) {
    const rel = L[x] / mean;
    const t = Math.max(0, Math.min(1, (rel - 0.55) / 0.9));
    k[x] = 0.88 + 0.22 * t;
    const l = Math.max(0.01, L[x]);
    // Cast: the column's own colour relative to its brightness, held close to neutral.
    const cast = [R[x] / l, G[x] / l, B[x] / l];
    const m = (cast[0] + cast[1] + cast[2]) / 3;
    for (let ch = 0; ch < 3; ch++) c[x * 3 + ch] = 1 + 0.3 * Math.max(-0.2, Math.min(0.25, cast[ch] / m - 1));
  }
  const prof: LightProfile = { n: N, k, c };
  cache.set(key, prof);
  return prof;
}

/** Samples a profile at a fraction (0..1) of the painting's width, linearly between columns. */
export function sampleProfile(p: LightProfile, f: number, out: [number, number, number]): void {
  const x = Math.max(0, Math.min(p.n - 1, f * p.n - 0.5));
  const i = Math.floor(x), j = Math.min(p.n - 1, i + 1), w = x - i;
  const k = p.k[i] + (p.k[j] - p.k[i]) * w;
  for (let ch = 0; ch < 3; ch++) out[ch] = k * (p.c[i * 3 + ch] + (p.c[j * 3 + ch] - p.c[i * 3 + ch]) * w);
}

import { T } from './tokens';

export type Rng = () => number;

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const R = rng(T.seed);
export const rr = (a: number, b: number, r: Rng = R) => a + (b - a) * r();
export const pick = <X>(arr: readonly X[], r: Rng = R): X => arr[Math.floor(r() * arr.length)];

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

export function scale(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/** colour as seen through `amount` of depth fog */
export const fogged = (c: number, amount: number) => mix(c, T.palette.fogColor, amount);

export const css = (c: number, a = 1) =>
  `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** periodic 1D value noise for wavy strata lines */
export function noise1(seed: number) {
  const r = rng(seed);
  const v = Array.from({ length: 256 }, () => r());
  return (x: number) => {
    const i = Math.floor(x), f = x - i;
    const a = v[i & 255], b = v[(i + 1) & 255];
    return a + (b - a) * smooth(f);
  };
}

export function isPhone(): boolean {
  return Math.min(innerWidth, innerHeight) < 600 || matchMedia('(pointer:coarse)').matches;
}

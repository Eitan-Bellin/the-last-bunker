import { T } from './tokens';

export const TW = T.tile.w;
export const TH = TW / 2;
export const ZU = T.tile.zUnit;
export const SH = T.storey;
export const ZF = T.depth.zFactor;

/** Floor height of level l (0 = surface ground, 3 = old metro). */
export const zf = (l: number): number => -l * SH;
/** Bottom of the diorama block (three decorative strata bands under level 3). */
export const Z_BASE = zf(3) - 3 * T.deepBand;

export const sx = (x: number, y: number): number => ((x - y) * TW) / 2;
export const sy = (x: number, y: number, z: number): number => ((x + y) * TH) / 2 - z * ZU;
/** Painter's key: larger = nearer the camera (drawn later). */
export const key = (x: number, y: number, z: number): number => x + y + ZF * z;

/** Flatten [x,y,z] points to a screen-space polygon array. */
export function poly(pts: number[][]): number[] {
  const out: number[] = [];
  for (const p of pts) out.push(sx(p[0], p[1]), sy(p[0], p[1], p[2]));
  return out;
}

/** Screen -> world on the horizontal plane z. */
export function unproject(px: number, py: number, z: number): { x: number; y: number } {
  const a = px / (TW / 2); // x - y
  const b = (py + z * ZU) / (TH / 2); // x + y
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash2 = (x: number, y: number, s = 0): number => {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function mul(c: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}
export function mix(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  const bl = (a & 255) * (1 - t) + (b & 255) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

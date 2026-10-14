import { Texture } from 'pixi.js';
import { T } from './tokens';
import { css, rng } from './util';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, ctx: c.getContext('2d')! };
}

/** white radial light with a physically-flavoured falloff: (1-r)^falloff */
export function radialTex(size = 256, falloff: number = T.light.falloff): Texture {
  const { c, ctx } = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const h = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - h, y + 0.5 - h) / h;
      const a = d >= 1 ? 0 : Math.pow(1 - d, falloff) * (1 - d * d * 0.15);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  ctx.putImageData(img, 0, 0);
  return Texture.from(c);
}

/** downward light cone: bright narrow top, wide faint bottom */
export function coneTex(): Texture {
  const w = 128, h = 256;
  const { c, ctx } = canvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const half = 0.12 + 0.88 * t;
    for (let x = 0; x < w; x++) {
      const u = Math.abs((x + 0.5) / w - 0.5) * 2 / half;
      const a = u >= 1 ? 0 : Math.pow(1 - u, 1.6) * Math.pow(1 - t, 1.4) * Math.min(1, t * 8);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(c);
}

/** 1-pixel-wide vertical gradient */
export function vGradTex(stops: { t: number; c: number; a: number }[], h = 256): Texture {
  const { c, ctx } = canvas(4, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const s of stops) g.addColorStop(s.t, css(s.c, s.a));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, h);
  return Texture.from(c);
}

/** periodic fbm value noise, grey in alpha (for fog mottling, grain, haze) */
export function noiseTex(size = 256, cells = 8, octaves = 4, seed = 3): Texture {
  const { c, ctx } = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const f = fbmPeriodic(seed);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = f(x / size, y / size, cells, octaves);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(v * 255);
    }
  ctx.putImageData(img, 0, 0);
  const t = Texture.from(c);
  t.source.style.addressMode = 'repeat';
  return t;
}

/** fine per-pixel grain (tiling) */
export function grainTex(size = 128): Texture {
  const { c, ctx } = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const r = rng(99);
  for (let i = 0; i < size * size; i++) {
    const v = r() * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = Texture.from(c);
  t.source.style.addressMode = 'repeat';
  return t;
}

export function vignetteTex(): Texture {
  const s = 256;
  const { c, ctx } = canvas(s, s);
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.22, s / 2, s / 2, s * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return Texture.from(c);
}

/** periodic value-noise fbm in [0,1] over the unit square */
export function fbmPeriodic(seed: number) {
  const r = rng(seed);
  const N = 64;
  const lat = Float32Array.from({ length: N * N }, () => r());
  const val = (x: number, y: number, p: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const m = (v: number) => ((v % p) + p) % p;
    const a = lat[m(xi) + m(yi) * N], b = lat[m(xi + 1) + m(yi) * N];
    const c = lat[m(xi) + m(yi + 1) * N], d = lat[m(xi + 1) + m(yi + 1) * N];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  return (u: number, v: number, cells: number, oct: number) => {
    let s = 0, amp = 0.5, tot = 0, p = cells;
    for (let o = 0; o < oct; o++) {
      s += val(u * p, v * p, p) * amp;
      tot += amp; amp *= 0.5; p *= 2;
    }
    return s / tot;
  };
}

/** non-periodic 2D value noise (for the big rock painting) */
export function noise2(seed: number) {
  const r = rng(seed);
  const N = 256;
  const lat = Float32Array.from({ length: N * N }, () => r());
  const val = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const i0 = (xi & 255) + (yi & 255) * N, i1 = ((xi + 1) & 255) + (yi & 255) * N;
    const i2 = (xi & 255) + ((yi + 1) & 255) * N, i3 = ((xi + 1) & 255) + ((yi + 1) & 255) * N;
    const a = lat[i0], b = lat[i1], c = lat[i2], d = lat[i3];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  return (x: number, y: number, oct = 4) => {
    let s = 0, amp = 0.5, tot = 0, f = 1;
    for (let o = 0; o < oct; o++) {
      s += val(x * f, y * f) * amp;
      tot += amp; amp *= 0.5; f *= 2.03;
    }
    return s / tot;
  };
}

export interface Textures {
  light: Texture;
  lightSoft: Texture;
  brush: Texture;
  cone: Texture;
  noise: Texture;
  grain: Texture;
  vignette: Texture;
  white: Texture;
}

export function makeTextures(): Textures {
  return {
    light: radialTex(256, T.light.falloff),
    lightSoft: radialTex(128, 1.2),
    brush: radialTex(128, 1.6),
    cone: coneTex(),
    noise: noiseTex(256, 6, 5, 11),
    grain: grainTex(),
    vignette: vignetteTex(),
    white: Texture.WHITE,
  };
}

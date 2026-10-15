/**
 * World kit painting library (tools only). Canvas 2D + per-pixel passes, all seeded: the same seed gives the same pixels.
 *
 * The "one hand" rules of the style guide (C-style-guide.md section 6) live here as reusable passes:
 *  - `pal()`      every procedural colour: saturation capped at 45%, pulled 15% toward the painting grey #6A6258 (UNIFY.material);
 *  - `litField()` height-field lighting: normals from the height, a key light from the upper left, cavity AO, so surfaces read painted;
 *  - `grainPass()` the shared grain at 12% multiply (tileable when the canvas is a tile);
 *  - `outline()`  the 1.5 u outline #0A0806 at 85% around every made object that meets darkness;
 *  - `vgrad()`    the vertical gradient (top x1.08, bottom x0.9) on flat fills.
 */
import { UNIFY } from '../../src/world/tokens';

export type G = CanvasRenderingContext2D;
export type RGB = [number, number, number];
export type RNG = () => number;

export function mk(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export const ctx = (c: HTMLCanvasElement): G => c.getContext('2d', { willReadFrequently: true })!;

/** mulberry32 */
export function rng(seed: number): RNG {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------------------------------------------

export const rgb = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
export const toHex = (c: RGB): number => (clamp255(c[0]) << 16) | (clamp255(c[1]) << 8) | clamp255(c[2]);
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
export const css = (h: number, a = 1): string => {
  const [r, g, b] = rgb(h);
  return `rgba(${r},${g},${b},${a})`;
};
export function mixHex(a: number, b: number, t: number): number {
  const A = rgb(a), B = rgb(b);
  return toHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}
export function shade(h: number, k: number): number {
  const c = rgb(h);
  return toHex([c[0] * k, c[1] * k, c[2] * k]);
}

/** The material rule: saturation capped, then pulled toward the painting grey. Use for every albedo colour (not for light/emissive). */
export function pal(h: number, cap: number = UNIFY.material.maxSaturation, pull: number = UNIFY.material.greyBiasAmount): number {
  const [r, g, b] = rgb(h).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  const d = mx - mn;
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let out: RGB = [r, g, b];
  if (s > cap) {
    const k = cap / s;
    out = [l + (r - l) * k, l + (g - l) * k, l + (b - l) * k];
    s = cap;
  }
  const grey = rgb(UNIFY.material.greyBias).map(v => v / 255);
  return toHex([0, 1, 2].map(i => (out[i] + (grey[i] - out[i]) * pull) * 255) as RGB);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Noise (periodic when px/py are given: tiles stay seamless)
// ---------------------------------------------------------------------------------------------------------------------------------

function ihash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const mod = (a: number, p: number) => ((a % p) + p) % p;

/** Value noise at (x, y) in lattice units; wraps every px / py cells when given. */
export function vnoise(x: number, y: number, seed: number, px = 0, py = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const X0 = px ? mod(xi, px) : xi, X1 = px ? mod(xi + 1, px) : xi + 1;
  const Y0 = py ? mod(yi, py) : yi, Y1 = py ? mod(yi + 1, py) : yi + 1;
  const a = ihash(X0, Y0, seed), b = ihash(X1, Y0, seed), c = ihash(X0, Y1, seed), d = ihash(X1, Y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export interface FbmOpts { seed: number; cx: number; cy?: number; oct?: number; gain?: number; ridged?: boolean; periodic?: boolean }
/** fbm over normalised coords u, v in [0, 1): `cx` x `cy` base cells; each octave doubles them (and the period). */
export function fbm(u: number, v: number, o: FbmOpts): number {
  const oct = o.oct ?? 5, gain = o.gain ?? 0.5;
  let cx = o.cx, cy = o.cy ?? o.cx, amp = 0.5, sum = 0, tot = 0;
  for (let i = 0; i < oct; i++) {
    let n = vnoise(u * cx, v * cy, o.seed + i * 1013, o.periodic === false ? 0 : cx, o.periodic === false ? 0 : cy);
    if (o.ridged) n = 1 - Math.abs(n * 2 - 1);
    sum += n * amp;
    tot += amp;
    amp *= gain;
    cx *= 2;
    cy *= 2;
  }
  return sum / tot;
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------------------------------------------------------------

export class Field {
  d: Float32Array;
  w: number;
  h: number;
  constructor(w: number, h: number, fill = 0) {
    this.w = w;
    this.h = h;
    this.d = new Float32Array(w * h).fill(fill);
  }
  static of(w: number, h: number, f: (u: number, v: number, x: number, y: number) => number): Field {
    const F = new Field(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) F.d[y * w + x] = f(x / w, y / h, x, y);
    return F;
  }
  at(x: number, y: number, wrap: boolean): number {
    if (wrap) { x = mod(x, this.w); y = mod(y, this.h); } else { x = Math.max(0, Math.min(this.w - 1, x)); y = Math.max(0, Math.min(this.h - 1, y)); }
    return this.d[y * this.w + x];
  }
  map(f: (v: number, i: number) => number): this {
    for (let i = 0; i < this.d.length; i++) this.d[i] = f(this.d[i], i);
    return this;
  }
  clone(): Field {
    const F = new Field(this.w, this.h);
    F.d.set(this.d);
    return F;
  }
}

/** Separable box blur, applied twice (close to a gaussian). */
export function blur(F: Field, r: number, wrap: boolean): Field {
  if (r < 1) return F.clone();
  let src = F.clone();
  const tmp = new Field(F.w, F.h);
  const n = r * 2 + 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < F.h; y++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += src.at(k, y, wrap);
      for (let x = 0; x < F.w; x++) {
        tmp.d[y * F.w + x] = s / n;
        s += src.at(x + r + 1, y, wrap) - src.at(x - r, y, wrap);
      }
    }
    const out = new Field(F.w, F.h);
    for (let x = 0; x < F.w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp.at(x, k, wrap);
      for (let y = 0; y < F.h; y++) {
        out.d[y * F.w + x] = s / n;
        s += tmp.at(x, y + r + 1, wrap) - tmp.at(x, y - r, wrap);
      }
    }
    src = out;
  }
  return src;
}

/** Draws with `draw` (white on transparent) and returns the alpha as a field; with `wrap` every shape is drawn 9 times so it tiles. */
export function mask(w: number, h: number, draw: (g: G) => void, wrap = false): Field {
  const c = mk(w, h);
  const g = ctx(c);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  const offs = wrap ? [-1, 0, 1] : [0];
  for (const ox of offs) for (const oy of offs) {
    g.save();
    g.translate(ox * w, oy * h);
    draw(g);
    g.restore();
  }
  const d = g.getImageData(0, 0, w, h).data;
  const F = new Field(w, h);
  for (let i = 0; i < F.d.length; i++) F.d[i] = d[i * 4 + 3] / 255;
  return F;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Height-field lighting
// ---------------------------------------------------------------------------------------------------------------------------------

export interface LitOpts {
  wrap: boolean;
  /** Normal strength (height units per pixel). */
  bump: number;
  ambient?: number;
  diffuse?: number;
  /** Specular strength (wet rock, glaze, metal) and its exponent. */
  spec?: number;
  shiny?: number;
  /** Cavity AO radius in px and strength. */
  aoR?: number;
  ao?: number;
  /** Optional per-pixel specular mask (0..1). */
  specMask?: Field;
  /** Light direction (toward the light), default upper left in front. */
  light?: [number, number, number];
}

/** Lights an albedo (3 floats per pixel, 0..255) with the height field; returns ImageData-ready bytes (alpha 255). */
export function litField(albedo: Float32Array, H: Field, o: LitOpts): Uint8ClampedArray {
  const { w, h } = H;
  const amb = o.ambient ?? 0.52, dif = o.diffuse ?? 0.62, spec = o.spec ?? 0, shiny = o.shiny ?? 16;
  let [lx, ly, lz] = o.light ?? [-0.55, -0.65, 0.55];
  const ll = Math.hypot(lx, ly, lz);
  lx /= ll; ly /= ll; lz /= ll;
  // half vector with the viewer at (0, 0, 1)
  let hx = lx, hy = ly, hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz);
  hx /= hl; hy /= hl; hz /= hl;
  const cav = o.aoR ? blur(H, o.aoR, o.wrap) : null;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const nx = (H.at(x - 1, y, o.wrap) - H.at(x + 1, y, o.wrap)) * o.bump;
      const ny = (H.at(x, y - 1, o.wrap) - H.at(x, y + 1, o.wrap)) * o.bump;
      const nl = Math.hypot(nx, ny, 1);
      const ndl = Math.max(0, (nx * lx + ny * ly + lz) / nl);
      let L = amb + dif * ndl;
      if (cav) L *= Math.max(0.35, 1 - Math.max(0, cav.d[i] - H.d[i]) * (o.ao ?? 2.2));
      let S = 0;
      if (spec) {
        const ndh = Math.max(0, (nx * hx + ny * hy + hz) / nl);
        S = spec * Math.pow(ndh, shiny) * (o.specMask ? o.specMask.d[i] : 1) * 255;
      }
      out[i * 4] = albedo[i * 3] * L + S;
      out[i * 4 + 1] = albedo[i * 3 + 1] * L + S;
      out[i * 4 + 2] = albedo[i * 3 + 2] * L + S * 0.95;
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

export function putBytes(c: HTMLCanvasElement, bytes: Uint8ClampedArray): void {
  const g = ctx(c);
  const img = g.createImageData(c.width, c.height);
  img.data.set(bytes);
  g.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Finishing passes
// ---------------------------------------------------------------------------------------------------------------------------------

/** The shared grain: per-pixel noise plus a soft mottle, multiplied in at `alpha` (UNIFY.fill.grainAlpha). Tileable. */
export function grainPass(c: HTMLCanvasElement, seed: number, alpha: number = UNIFY.fill.grainAlpha, mottle = 0.5): void {
  const g = ctx(c);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const W = c.width, Hh = c.height;
  const cx = Math.max(1, Math.round(W / 24)), cy = Math.max(1, Math.round(Hh / 24));
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] === 0) continue;
      const fine = ihash(x, y, seed);
      const soft = mottle ? vnoise((x / W) * cx, (y / Hh) * cy, seed + 7, cx, cy) : 0.5;
      const n = fine * (1 - mottle * 0.5) + soft * mottle * 0.5;
      const k = 1 - alpha * n * 1.6 + alpha * 0.5;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Paints the 1.5 u outline under the sprite: the silhouette dilated by `px` pixels in #0A0806 at 85%. */
export function outline(c: HTMLCanvasElement, px: number, color = UNIFY.outline.color, alpha = UNIFY.outline.alpha): void {
  const o = mk(c.width, c.height);
  const g = ctx(o);
  const steps = 16;
  for (let r = px; r > 0; r -= Math.max(0.75, px / 2)) {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      g.drawImage(c, Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = css(color, alpha);
  g.fillRect(0, 0, o.width, o.height);
  g.globalCompositeOperation = 'destination-over';
  // keep the sprite on top
  const top = mk(c.width, c.height);
  ctx(top).drawImage(c, 0, 0);
  const cg = ctx(c);
  cg.save();
  cg.setTransform(1, 0, 0, 1, 0, 0); // sprites are drawn in world units: this pass works in pixels
  cg.clearRect(0, 0, c.width, c.height);
  cg.drawImage(o, 0, 0);
  cg.drawImage(top, 0, 0);
  cg.restore();
}

/** Vertical light gradient on whatever is drawn (multiply by top 1.08 -> bottom 0.9), clipped to the drawn alpha. */
export function vgrad(c: HTMLCanvasElement, y0 = 0, y1 = c.height, top: number = UNIFY.fill.gradientTop, bottom: number = UNIFY.fill.gradientBottom): void {
  const g = ctx(c);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let y = 0; y < c.height; y++) {
    const t = clamp01((y - y0) / Math.max(1, y1 - y0));
    const k = top + (bottom - top) * t;
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Per-pixel pass over a canvas. */
export function pixels(c: HTMLCanvasElement, f: (r: number, g: number, b: number, a: number, x: number, y: number) => [number, number, number, number]): void {
  const g = ctx(c);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4;
    const o = f(d[i], d[i + 1], d[i + 2], d[i + 3], x, y);
    d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = o[3];
  }
  g.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Drawing helpers for made objects
// ---------------------------------------------------------------------------------------------------------------------------------

/** A noise texture canvas (greyscale, opaque) used as a pattern for grime, rust and wood grain. */
export function noiseCanvas(w: number, h: number, seed: number, cx: number, cy: number, oct = 4, ridged = false): HTMLCanvasElement {
  const c = mk(w, h);
  const g = ctx(c);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fbm(x / w, y / h, { seed, cx, cy, oct, ridged }) * 255;
    const i = (y * w + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Wear: inside the current drawn alpha, blotches of `col` where a noise field passes a threshold (rust through paint, chips,
 * grime). `cover` 0..1 is the share covered.
 */
export function wear(c: HTMLCanvasElement, seed: number, col: number, cover: number, opts: { cells?: number; alpha?: number; soft?: number; bias?: (x: number, y: number) => number; region?: [number, number, number, number] } = {}): void {
  const g = ctx(c);
  const [rx, ry, rw, rh] = opts.region ?? [0, 0, c.width, c.height];
  const img = g.getImageData(rx, ry, rw, rh);
  const d = img.data;
  const [cr, cg, cb] = rgb(col);
  const cells = opts.cells ?? 6, a = opts.alpha ?? 1, soft = opts.soft ?? 0.06;
  const thr = 1 - cover;
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = (y * rw + x) * 4;
    if (d[i + 3] < 8) continue;
    let n = fbm(x / rw, y / rh, { seed, cx: Math.max(1, Math.round(cells * rw / Math.max(rw, rh))), cy: Math.max(1, Math.round(cells * rh / Math.max(rw, rh))), oct: 4, periodic: false });
    if (opts.bias) n += opts.bias(x / rw, y / rh);
    const t = smooth(thr - soft, thr + soft, n) * a;
    if (t <= 0) continue;
    d[i] += (cr - d[i]) * t; d[i + 1] += (cg - d[i + 1]) * t; d[i + 2] += (cb - d[i + 2]) * t;
  }
  g.putImageData(img, rx, ry);
}

/** A horizontal cylinder (pipe, tube, rail): a vertical gradient with a highlight band and a dark underside. */
export function cylH(g: G, x: number, y: number, w: number, h: number, base: number, hi = 1.45, lo = 0.42): void {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, css(shade(base, 0.75)));
  gr.addColorStop(0.22, css(shade(base, hi)));
  gr.addColorStop(0.45, css(base));
  gr.addColorStop(1, css(shade(base, lo)));
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
}
/** A vertical cylinder (post, pole, pipe). */
export function cylV(g: G, x: number, y: number, w: number, h: number, base: number, hi = 1.45, lo = 0.42): void {
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, css(shade(base, 0.8)));
  gr.addColorStop(0.25, css(shade(base, hi)));
  gr.addColorStop(0.5, css(base));
  gr.addColorStop(1, css(shade(base, lo)));
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
}

/** A bevelled plate: base fill, lit top/left edge, dark bottom/right edge. */
export function plate(g: G, x: number, y: number, w: number, h: number, base: number, bev = 2): void {
  g.fillStyle = css(base);
  g.fillRect(x, y, w, h);
  g.fillStyle = css(shade(base, 1.35), 0.9);
  g.fillRect(x, y, w, bev);
  g.fillRect(x, y, bev, h);
  g.fillStyle = css(shade(base, 0.5), 0.9);
  g.fillRect(x, y + h - bev, w, bev);
  g.fillRect(x + w - bev, y, bev, h);
}

/** A rivet / bolt head: lit dome with a shadow. */
export function rivet(g: G, x: number, y: number, r: number, base: number): void {
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.arc(x + r * 0.35, y + r * 0.45, r, 0, Math.PI * 2);
  g.fill();
  const gr = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, css(shade(base, 1.7)));
  gr.addColorStop(0.6, css(base));
  gr.addColorStop(1, css(shade(base, 0.5)));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** Radial glow (for emissive maps and lit bulbs). */
export function glow(g: G, x: number, y: number, r: number, col: number, a = 1, core = 0.15): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, css(mixHex(col, 0xffffff, 0.6), a));
  gr.addColorStop(core, css(col, a * 0.9));
  gr.addColorStop(0.5, css(col, a * 0.28));
  gr.addColorStop(1, css(col, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Polygon fill from a flat point list. */
export function poly(g: G, pts: number[], fill: string | CanvasGradient | CanvasPattern): void {
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.fill();
}

/** Wandering polyline from (x0, y0) to (x1, y1). */
export function jag(x0: number, y0: number, x1: number, y1: number, r: RNG, amp: number, steps: number): number[] {
  const pts = [x0, y0];
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  let off = 0;
  for (let i = 1; i < steps; i++) {
    off = off * 0.55 + (r() - 0.5) * 2 * amp;
    const t = i / steps;
    pts.push(x0 + dx * t + nx * off, y0 + dy * t + ny * off);
  }
  pts.push(x1, y1);
  return pts;
}

export function stroke(g: G, pts: number[], w: number, col: string): void {
  g.strokeStyle = col;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
}

/** Loads an image from the dev server (null when missing): painted kit textures are re-used as material sources. */
export async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}

/** Re-grades a source image region into a greyscale-luminance pattern canvas (detail only), sized w x h. */
export function lumaOf(src: CanvasImageSource | null, w: number, h: number, sx = 0, sy = 0, sw?: number, sh?: number): HTMLCanvasElement | null {
  if (!src) return null;
  const c = mk(w, h);
  const g = ctx(c);
  const s = src as HTMLImageElement;
  g.drawImage(s, sx, sy, sw ?? s.width, sh ?? s.height, 0, 0, w, h);
  let mean = 0;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) mean += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
  mean /= d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const L = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / Math.max(1, mean);
    const v = Math.max(0, Math.min(255, 128 * L));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Overlays a luminance detail canvas (see lumaOf) with 'overlay' at `a`, clipped to what is drawn. */
export function detail(c: HTMLCanvasElement, lum: HTMLCanvasElement | null, a: number, x = 0, y = 0, w = c.width, h = c.height): void {
  if (!lum) return;
  const g = ctx(c);
  const t = mk(c.width, c.height);
  const tg = ctx(t);
  tg.drawImage(lum, x, y, w, h);
  // clip the detail to the drawn alpha first: a blend mode alone would paint into the transparent surround
  tg.globalCompositeOperation = 'destination-in';
  tg.drawImage(c, 0, 0);
  g.save();
  g.globalAlpha = a;
  g.globalCompositeOperation = 'soft-light';
  g.drawImage(t, 0, 0);
  g.restore();
}

/** Canvas to WebP blob. */
export function webp(c: HTMLCanvasElement, q: number): Promise<Blob> {
  // toDataURL is synchronous: toBlob's callback never fires in headless Chrome under --virtual-time-budget
  const url = c.toDataURL('image/webp', q);
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return Promise.resolve(new Blob([bytes], { type: 'image/webp' }));
}

/** Copies `src` into a new canvas scaled to (w, h) (emissive masks at half resolution). */
export function scaled(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = mk(w, h);
  const g = ctx(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return c;
}

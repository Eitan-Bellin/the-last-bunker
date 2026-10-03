/**
 * Wear decals (graphics overhaul G2-decals / G7): painted procedurally with canvas 2D — layered strokes,
 * value noise, varied alpha and soft edges — and saved as public/art/kit/decal-<name>.webp.
 * Open /tools/decals.html?auto on the dev server (or `&only=<name>`).
 *
 * Three kinds of output:
 * - mul:   ink on white, drawn with blend 'multiply' in the game (white disappears; can only darken)
 * - add:   light on black, drawn with blend 'add' (black disappears)
 * - alpha: transparent background, drawn normally — for things lighter than the wall
 *          (chalk, fresh cement, painted stencils, enamel plates), which multiply cannot show.
 */

type Blend = 'mul' | 'add' | 'alpha';
type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

interface Decal {
  name: string;
  w: number;
  h: number;
  blend: Blend;
  /** Paints in final-size units (the canvas is twice as large and pre-scaled). */
  paint: (ctx: Ctx, r: () => number, w: number, h: number) => void;
  /** Edge fade width as a fraction of the shorter side (mul/add default 0.2; alpha 0). */
  fade?: number;
  /** How much the wall's tooth breaks up the ink (0..1). */
  tooth?: number;
  /** Mul only: darkness gain applied to the finished decal (default 1.8). */
  gain?: number;
}

/** Hi-res factor: everything is painted at 2× and halved at the end for soft, clean edges. */
const HR = 2;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000);
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number, oct = 4): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    sum += vnoise(x * f, y * f, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

/** A hi-res layer in final-size units. */
function layer(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const [c, ctx] = canvas(w * HR, h * HR);
  ctx.scale(HR, HR);
  return [c, ctx];
}

const rgba = (c: number[], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// ---------------------------------------------------------------- strokes

/** Random walk that keeps drifting back toward its heading: the shape of a crack or a run of water. */
function walk(r: () => number, x: number, y: number, ang: number, len: number, step = 2.2, wig = 0.5): Pt[] {
  const pts: Pt[] = [[x, y]];
  let a = ang;
  for (let d = 0; d < len; d += step) {
    a += (r() - 0.5) * wig + (ang - a) * 0.18;
    if (r() < 0.08) a += (r() - 0.5) * 1.1;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push([x, y]);
  }
  return pts;
}

function poly(ctx: Ctx, pts: Pt[], width: number, color: string, blur = 0): void {
  if (pts.length < 2) return;
  ctx.save();
  if (blur) ctx.filter = `blur(${blur * HR}px)`;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.stroke();
  ctx.restore();
}

/** A stroke that thins from w0 to w1 along its length. */
function taper(ctx: Ctx, pts: Pt[], w0: number, w1: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < pts.length - 1; i++) {
    ctx.lineWidth = w0 + (w1 - w0) * (i / (pts.length - 1));
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    ctx.stroke();
  }
  ctx.restore();
}

function blob(ctx: Ctx, x: number, y: number, rx: number, ry: number, color: string, blur = 0): void {
  ctx.save();
  if (blur) ctx.filter = `blur(${blur * HR}px)`;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function dots(ctx: Ctx, r: () => number, n: number, at: () => Pt, rMin: number, rMax: number, colors: number[][], aMin: number, aMax: number): void {
  for (let i = 0; i < n; i++) {
    const [x, y] = at();
    const c = colors[Math.floor(r() * colors.length)];
    ctx.fillStyle = rgba(c, aMin + r() * (aMax - aMin));
    ctx.beginPath();
    ctx.arc(x, y, rMin + r() * (rMax - rMin), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Per-pixel pass over a canvas. */
function eachPixel(c: HTMLCanvasElement, f: (d: Uint8ClampedArray, i: number, x: number, y: number) => void): void {
  const ctx = c.getContext('2d')!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) f(img.data, (y * c.width + x) * 4, x, y);
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- cracks

const CRACK_DARK = [20, 18, 16];
const CRACK_MID = [28, 25, 22];
const SEEP = [40, 36, 30];

/** Cracks are drawn with a lit lower lip (alpha decals) so they read on dark concrete too. */
const CRACK_RIM = [200, 192, 176];

function crack(ctx: Ctx, r: () => number, x: number, y: number, ang: number, len: number, w: number, depth: number): Pt[] {
  const pts = walk(r, x, y, ang, len, 2.6, 0.75);
  // Damp seeping out of the crack, the lit broken lip, its shadow, then the black gap itself.
  poly(ctx, pts, w * 6, rgba(SEEP, 0.16), 3);
  taper(ctx, pts.map(([px, py]) => [px + w * 0.45, py + w * 0.75] as Pt), w * 1.1, w * 0.25, rgba(CRACK_RIM, 0.45));
  taper(ctx, pts, w * 1.7, w * 0.4, rgba(CRACK_MID, 0.55));
  taper(ctx, pts, w, w * 0.18, rgba(CRACK_DARK, 0.92));
  // Chipped flakes along the edge.
  for (let i = 2; i < pts.length; i += 3) {
    if (r() > 0.22) continue;
    const [px, py] = pts[i];
    const s = w * (0.3 + r() * 0.5);
    ctx.fillStyle = rgba(CRACK_MID, 0.5 + r() * 0.3);
    ctx.beginPath();
    ctx.moveTo(px + (r() - 0.5) * s * 2, py - s);
    ctx.lineTo(px + s * 1.2, py + (r() - 0.5) * s);
    ctx.lineTo(px + (r() - 0.5) * s, py + s * 1.1);
    ctx.lineTo(px - s, py + (r() - 0.5) * s);
    ctx.fill();
  }
  if (depth > 0) {
    for (let i = 4; i < pts.length - 4; i++) {
      if (r() > 0.09) continue;
      const side = r() < 0.5 ? -1 : 1;
      crack(ctx, r, pts[i][0], pts[i][1], ang + side * (0.45 + r() * 0.8), len * (0.2 + r() * 0.35), w * 0.62, depth - 1);
    }
  }
  return pts;
}

/** Fine hair cracks and dust specks around a main crack. */
function crackDust(ctx: Ctx, r: () => number, w: number, h: number): void {
  dots(ctx, r, 70, () => [r() * w, r() * h], 0.3, 0.9, [CRACK_MID, SEEP], 0.12, 0.4);
}

// ---------------------------------------------------------------- water, rust, mould, soot

// Painted over the wall (not multiplied), so damp must be near-black to darken even dim concrete.
const STAIN_BROWN = [34, 26, 16];
const STAIN_GREEN = [22, 28, 20];
const STAIN_DARK = [10, 10, 8];
/** Efflorescence: lime the water leaves behind as it dries — the pale crust that makes a stain read on dark concrete. */
const LIME = [214, 208, 188];

function streak(ctx: Ctx, r: () => number, x: number, y: number, len: number, w: number, col: number[], a: number): Pt[] {
  const pts: Pt[] = [];
  const ph = r() * 10;
  for (let d = 0; d <= len; d += 2) pts.push([x + Math.sin(d * 0.045 + ph) * 1.6 + (r() - 0.5) * 0.6, y + d]);
  poly(ctx, pts, w * 2.4, rgba(col, a * 0.35), 3);
  // Water runs widen and thin as they go; draw the body in short segments with falling alpha.
  for (let i = 0; i < pts.length - 1; i++) {
    const k = i / (pts.length - 1);
    const ww = w * (1 - k * 0.55) * (0.85 + 0.3 * vnoise(i * 0.15, x, 7));
    ctx.strokeStyle = rgba(col, a * (1 - k * 0.7));
    ctx.lineWidth = ww;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    ctx.stroke();
  }
  // Tide-mark edges: lime dries pale on one side of a run, grime dark on the other.
  for (const side of [-1, 1]) {
    const edge = pts.map(([px, py], i) => [px + side * w * 0.55 * (1 - (i / pts.length) * 0.55), py] as Pt);
    const part = edge.slice(0, Math.floor(edge.length * (0.35 + r() * 0.5)));
    if (side < 0 && r() < 0.6) poly(ctx, part.slice(0, Math.ceil(part.length * 0.6)), 1, rgba(LIME, Math.min(0.6, a)), 0.4);
    else poly(ctx, part, 0.8, rgba(STAIN_DARK, a * 0.4), 0.5);
  }
  const end = pts[pts.length - 1];
  blob(ctx, end[0], end[1] + 1, w * 0.45, w * 0.6, rgba(col, a * 0.8), 0.4);
  return pts;
}

function waterStain(ctx: Ctx, r: () => number, w: number, h: number, runs: number, strength: number): void {
  // The damp band where the water comes through the slab.
  for (let i = 0; i < 14; i++) blob(ctx, w * (0.1 + r() * 0.8), 12 + r() * 18, 12 + r() * 18, 8 + r() * 10, rgba(r() < 0.5 ? STAIN_BROWN : STAIN_GREEN, 0.3 * strength), 5);
  const tide: Pt[] = [];
  for (let x = 4; x <= w - 4; x += 3) tide.push([x, 26 + Math.sin(x * 0.11) * 4 + (r() - 0.5) * 3]);
  poly(ctx, tide, 1.2, rgba(STAIN_DARK, 0.3 * strength), 0.5);
  poly(ctx, tide.map(([x, y]) => [x, y + 2] as Pt), 1.6, rgba(LIME, 0.45 * strength), 0.8);
  dots(ctx, r, 70, () => [4 + r() * (w - 8), 22 + r() * 12], 0.4, 1.3, [LIME], 0.25, 0.6);
  // The damp shadow the runs sit in: wide, soft and fading downward.
  for (let i = 0; i < 6; i++) blob(ctx, w * (0.25 + r() * 0.5), 34 + r() * 70, 12 + r() * 16, 36 + r() * 50, rgba(r() < 0.5 ? STAIN_BROWN : STAIN_GREEN, 0.14 * strength), 9);
  for (let i = 0; i < runs; i++) {
    const x = 10 + r() * (w - 20);
    const len = h * (0.3 + r() * 0.62);
    streak(ctx, r, x, 14 + r() * 18, len, 6 + r() * 9, r() < 0.45 ? STAIN_GREEN : r() < 0.85 ? STAIN_BROWN : STAIN_DARK, (0.4 + r() * 0.3) * strength);
  }
  dots(ctx, r, 80, () => [r() * w, 10 + r() * h * 0.6], 0.3, 1, [STAIN_DARK, STAIN_BROWN], 0.1, 0.4);
}

const RUST = [150, 78, 36];
const RUST_DARK = [92, 46, 22];

function rustDrip(ctx: Ctx, r: () => number, w: number, h: number): void {
  const cx = w / 2, by = 14;
  blob(ctx, cx, by, 13, 11, rgba(RUST, 0.35), 3);
  const runs = [{ x: cx, len: h * 0.82, w: 11 }, { x: cx - 7, len: h * 0.42, w: 4.5 }, { x: cx + 7, len: h * 0.55, w: 4 }];
  for (const run of runs) {
    const pts: Pt[] = [];
    for (let d = 0; d <= run.len; d += 2) pts.push([run.x + Math.sin(d * 0.05 + run.x) * 1.4 + (r() - 0.5) * 0.5, by + d]);
    poly(ctx, pts, run.w * 2.2, rgba(RUST, 0.16), 2.5);
    for (let i = 0; i < pts.length - 1; i++) {
      const k = i / (pts.length - 1);
      const bulge = Math.sin(Math.min(1, k * 3) * Math.PI * 0.5);
      ctx.strokeStyle = rgba(k < 0.5 ? RUST : RUST_DARK, 0.55 * (1 - k * 0.75));
      ctx.lineWidth = run.w * (0.6 + 0.5 * bulge) * (1 - k * 0.7);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[i][0], pts[i][1]);
      ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
      ctx.stroke();
    }
    poly(ctx, pts.slice(0, Math.floor(pts.length * 0.6)), run.w * 0.3, rgba(RUST_DARK, 0.4), 0.4);
  }
  // The bolt that bleeds it all.
  blob(ctx, cx, by, 5, 5, rgba([40, 30, 24], 0.95));
  blob(ctx, cx - 1, by - 1, 2.2, 2.2, rgba([90, 70, 56], 0.8));
  ctx.strokeStyle = rgba(RUST, 0.8);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, by, 6.2, 0, Math.PI * 2);
  ctx.stroke();
  dots(ctx, r, 60, () => [cx + (r() - 0.5) * 20, by + r() * h * 0.7], 0.3, 1.1, [RUST, RUST_DARK], 0.2, 0.6);
}

function mould(ctx: Ctx, r: () => number, w: number, h: number): void {
  const cx = w / 2, cy = h / 2;
  for (let i = 0; i < 7; i++) blob(ctx, cx + (r() - 0.5) * 50, cy + (r() - 0.5) * 40, 18 + r() * 22, 14 + r() * 16, rgba([88, 98, 82], 0.16), 6);
  const cols = [[26, 34, 22], [52, 64, 34], [82, 90, 46], [38, 42, 38], [64, 70, 58]];
  const seed = Math.floor(r() * 1000);
  for (let i = 0; i < 2600; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 52;
    const x = cx + Math.cos(a) * d * 1.15, y = cy + Math.sin(a) * d * 0.9;
    const n = fbm(x / 16, y / 16, seed);
    if (n < 0.42 + d / 160) continue;
    const c = cols[Math.floor(r() * cols.length)];
    ctx.fillStyle = rgba(c, 0.25 + r() * 0.6);
    ctx.beginPath();
    ctx.arc(x, y, 0.4 + r() * (n > 0.6 ? 2.4 : 1.2), 0, Math.PI * 2);
    ctx.fill();
  }
  // Colonies: little rings with a darker rim.
  for (let i = 0; i < 9; i++) {
    const x = cx + (r() - 0.5) * 60, y = cy + (r() - 0.5) * 44, rad = 2 + r() * 5;
    ctx.strokeStyle = rgba(cols[0], 0.45);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.stroke();
    blob(ctx, x, y, rad * 0.8, rad * 0.8, rgba(cols[2], 0.25), 0.6);
  }
}

const SOOT = [26, 21, 17];

function soot(ctx: Ctx, r: () => number, w: number, h: number): void {
  const x0 = w / 2, y0 = h - 10;
  for (let k = 0; k < 44; k++) {
    const t = k / 44;
    const y = y0 - t * (h - 22);
    const spread = 7 + t * 34;
    blob(ctx, x0 + (r() - 0.5) * spread * 0.8 + Math.sin(t * 5) * 4, y, spread * (0.5 + r() * 0.5), 6 + r() * 6, rgba(SOOT, 0.11 * (1 - t) + 0.03), 3 + t * 5);
  }
  // Tongues licking upward.
  for (let i = 0; i < 6; i++) {
    const x = x0 + (r() - 0.5) * 30;
    const pts = walk(r, x, y0 - 6, -Math.PI / 2 + (r() - 0.5) * 0.5, 40 + r() * 50, 3, 0.35);
    poly(ctx, pts, 5 + r() * 7, rgba(SOOT, 0.12), 3);
    poly(ctx, pts.slice(0, pts.length >> 1), 2, rgba(SOOT, 0.16), 1);
  }
  blob(ctx, x0, y0, 16, 6, rgba(SOOT, 0.35), 3);
  dots(ctx, r, 120, () => [x0 + (r() - 0.5) * 70, y0 - r() * (h - 20)], 0.3, 1.2, [SOOT], 0.1, 0.4);
}

// ---------------------------------------------------------------- scratches and chalk

function scratchLine(ctx: Ctx, r: () => number, x0: number, y0: number, x1: number, y1: number): void {
  const pts: Pt[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) pts.push([x0 + (x1 - x0) * (i / n) + (r() - 0.5) * 0.7, y0 + (y1 - y0) * (i / n) + (r() - 0.5) * 0.7]);
  taper(ctx, pts, 1.6, 0.5, rgba([34, 31, 28], 0.75));
  poly(ctx, pts.map(([x, y]) => [x + 0.8, y + 0.4] as Pt), 0.6, rgba([60, 56, 52], 0.35));
}

/** Days counted in fives: four strokes and a slash. */
function tallyLayout(r: () => number, w: number, h: number, rows: number, line: (x0: number, y0: number, x1: number, y1: number) => void): void {
  const gh = Math.min(26, (h - 14) / rows - 6);
  for (let row = 0; row < rows; row++) {
    const y = 10 + row * (gh + 8) + (r() - 0.5) * 3;
    let x = 8 + r() * 4;
    const groups = 3 + Math.floor(r() * 2);
    for (let g = 0; g < groups && x < w - 26; g++) {
      const n = row === rows - 1 && g === groups - 1 ? 1 + Math.floor(r() * 4) : 5;
      for (let i = 0; i < Math.min(4, n); i++) {
        const xi = x + i * 4.6 + (r() - 0.5);
        line(xi, y + (r() - 0.5) * 2, xi + (r() - 0.5) * 2.5, y + gh + (r() - 0.5) * 2);
      }
      if (n === 5) line(x - 3, y + gh * 0.75, x + 17, y + gh * 0.2);
      x += 25 + r() * 4;
    }
  }
}

const CHALK = [236, 232, 220];

/** A chalk line: grains along the path, skipping where the rough wall doesn't take it. */
function chalkLine(ctx: Ctx, r: () => number, pts: Pt[], width: number, col = CHALK, a = 1): void {
  const seed = Math.floor(r() * 9999);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let d = 0; d < len; d += 0.35) {
      const t = d / len;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const skip = fbm(x / 3.5, y / 3.5, seed, 3);
      if (skip < 0.3) continue;
      for (let k = 0; k < 2; k++) {
        ctx.fillStyle = rgba(col, a * (0.18 + r() * 0.5) * smooth(0.3, 0.55, skip));
        ctx.beginPath();
        ctx.arc(x + (r() - 0.5) * width, y + (r() - 0.5) * width, 0.35 + r() * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Hand-drawn line between two points (a child's wobble). */
function wob(r: () => number, x0: number, y0: number, x1: number, y1: number, j = 0.8): Pt[] {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 4));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push([x0 + (x1 - x0) * (i / n) + (r() - 0.5) * j, y0 + (y1 - y0) * (i / n) + (r() - 0.5) * j]);
  return out;
}

/** Hand-drawn circle that overshoots where it closes. */
function wobCircle(r: () => number, cx: number, cy: number, rx: number, ry = rx): Pt[] {
  const out: Pt[] = [];
  const a0 = r() * Math.PI * 2;
  for (let a = 0; a <= Math.PI * 2.15; a += 0.2) {
    const k = 1 + (r() - 0.5) * 0.08 + a * 0.012;
    out.push([cx + Math.cos(a0 + a) * rx * k, cy + Math.sin(a0 + a) * ry * k]);
  }
  return out;
}

function stick(ctx: Ctx, r: () => number, x: number, foot: number, hgt: number, col: number[], dress = false): void {
  const head = hgt * 0.17;
  const neck = foot - hgt + head * 2;
  const hip = foot - hgt * 0.38;
  chalkLine(ctx, r, wobCircle(r, x, foot - hgt + head, head), 1.4, col);
  chalkLine(ctx, r, wob(r, x, neck, x, hip), 1.4, col);
  chalkLine(ctx, r, wob(r, x - hgt * 0.26, neck + hgt * 0.16, x, neck + hgt * 0.08), 1.3, col);
  chalkLine(ctx, r, wob(r, x, neck + hgt * 0.08, x + hgt * 0.26, neck + hgt * 0.02), 1.3, col);
  if (dress) chalkLine(ctx, r, [[x, neck + 2], [x - hgt * 0.17, hip + 3], [x + hgt * 0.17, hip + 3], [x, neck + 2]], 1.3, col);
  chalkLine(ctx, r, wob(r, x, hip, x - hgt * 0.14, foot), 1.3, col);
  chalkLine(ctx, r, wob(r, x, hip, x + hgt * 0.14, foot), 1.3, col);
}

function kidDrawing(ctx: Ctx, r: () => number, w: number, h: number): void {
  const yellow = [232, 204, 120], red = [214, 128, 104], blue = [150, 186, 220], green = [150, 196, 132];
  // Sun.
  chalkLine(ctx, r, wobCircle(r, 26, 26, 11), 2, yellow);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    chalkLine(ctx, r, wob(r, 26 + Math.cos(a) * 15, 26 + Math.sin(a) * 15, 26 + Math.cos(a) * 22, 26 + Math.sin(a) * 22), 1.4, yellow);
  }
  chalkLine(ctx, r, [[21, 28], [24, 31], [28, 31], [31, 28]], 1, yellow);
  // House.
  const hx = 62, hy = 62, hw = 44, hh = 42;
  chalkLine(ctx, r, [...wob(r, hx, hy, hx + hw, hy), ...wob(r, hx + hw, hy, hx + hw, hy + hh), ...wob(r, hx + hw, hy + hh, hx, hy + hh), ...wob(r, hx, hy + hh, hx, hy)], 1.7);
  chalkLine(ctx, r, [...wob(r, hx - 5, hy + 1, hx + hw / 2, hy - 26), ...wob(r, hx + hw / 2, hy - 26, hx + hw + 5, hy + 1)], 1.8, red);
  chalkLine(ctx, r, [...wob(r, hx + 8, hy + hh, hx + 8, hy + 18), ...wob(r, hx + 8, hy + 18, hx + 20, hy + 18), ...wob(r, hx + 20, hy + 18, hx + 20, hy + hh)], 1.4);
  chalkLine(ctx, r, [[hx + 27, hy + 9], [hx + 38, hy + 9], [hx + 38, hy + 20], [hx + 27, hy + 20], [hx + 27, hy + 9]], 1.3, blue);
  chalkLine(ctx, r, [[hx + 32.5, hy + 9], [hx + 32.5, hy + 20]], 1, blue);
  chalkLine(ctx, r, wob(r, hx + 34, hy - 18, hx + 34, hy - 30), 1.6);
  // Family: two grown-ups and a little one, holding hands.
  stick(ctx, r, 130, 104, 40, CHALK);
  stick(ctx, r, 152, 104, 36, [240, 190, 180], true);
  stick(ctx, r, 172, 104, 22, blue);
  // Ground.
  const ground: Pt[] = [];
  for (let x = 8; x < w - 6; x += 5) ground.push([x, 108 + Math.sin(x * 0.2) * 1.4 + (r() - 0.5)]);
  chalkLine(ctx, r, ground, 1.6, green);
  void h;
}

function kidDrawing2(ctx: Ctx, r: () => number, w: number, h: number): void {
  const cols = [[214, 128, 104], [232, 204, 120], [150, 186, 220]];
  // Rainbow.
  cols.forEach((c, i) => {
    const pts: Pt[] = [];
    for (let a = Math.PI * 1.05; a <= Math.PI * 1.95; a += 0.08) pts.push([60 + Math.cos(a) * (46 - i * 7), 70 + Math.sin(a) * (40 - i * 6)]);
    chalkLine(ctx, r, pts, 2.6, c);
  });
  // Flowers.
  for (const [fx, fh, c] of [[24, 34, cols[0]], [100, 44, cols[1]], [130, 30, [240, 190, 180]]] as [number, number, number[]][]) {
    const top = 112 - fh;
    chalkLine(ctx, r, wob(r, fx, 112, fx + (r() - 0.5) * 4, top + 5), 1.3, [150, 196, 132]);
    chalkLine(ctx, r, wob(r, fx, 100, fx + 8, 92), 1.2, [150, 196, 132]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      chalkLine(ctx, r, wobCircle(r, fx + Math.cos(a) * 5.5, top + Math.sin(a) * 5.5, 3.6), 1.1, c);
    }
    chalkLine(ctx, r, wobCircle(r, fx, top, 2), 1.2, [232, 204, 120]);
  }
  // A cat.
  chalkLine(ctx, r, wobCircle(r, 62, 100, 9, 8), 1.4);
  chalkLine(ctx, r, [[55, 94], [56, 85], [61, 92]], 1.3);
  chalkLine(ctx, r, [[63, 92], [68, 85], [69, 94]], 1.3);
  for (const s of [-1, 1]) for (const dy of [-1.5, 1.5]) chalkLine(ctx, r, wob(r, 62 + s * 4, 101 + dy, 62 + s * 13, 100 + dy * 2), 0.8);
  chalkLine(ctx, r, wobCircle(r, 62, 120, 11, 7), 1.4);
  const grass: Pt[] = [];
  for (let x = 6; x < w - 6; x += 4) grass.push([x, 126 + (x % 8 === 0 ? -3 : 0)]);
  chalkLine(ctx, r, grass, 1.2, [150, 196, 132]);
  void h;
}

// ---------------------------------------------------------------- spray paint

/**
 * Stencilled spray paint: a crisp core, a soft overspray halo with speckles, worn patches where the wall shows
 * through, and a couple of runs where too much paint went on.
 */
function spray(ctx: Ctx, r: () => number, w: number, h: number, shape: (c: Ctx) => void, col: number[], wear = 0.5): void {
  const [core, cctx] = layer(w, h);
  cctx.fillStyle = rgba(col, 1);
  shape(cctx);
  const [halo, hctx] = layer(w, h);
  hctx.filter = `blur(${2.6 * HR}px)`;
  hctx.drawImage(core, 0, 0, w, h);
  // Speckles where the halo is, outside the core.
  const hd = hctx.getImageData(0, 0, halo.width, halo.height).data;
  const cd = cctx.getImageData(0, 0, core.width, core.height).data;
  const [sp, sctx] = layer(w, h);
  for (let i = 0; i < 2600; i++) {
    const x = r() * w, y = r() * h;
    const j = ((Math.floor(y * HR) * core.width) + Math.floor(x * HR)) * 4 + 3;
    const p = (hd[j] / 255) * (1 - cd[j] / 255);
    if (r() > p * 1.6) continue;
    sctx.fillStyle = rgba(col, 0.35 + r() * 0.5);
    sctx.beginPath();
    sctx.arc(x, y, 0.25 + r() * 0.55, 0, Math.PI * 2);
    sctx.fill();
  }
  // Worn paint: the core loses alpha in noisy patches.
  const seed = Math.floor(r() * 9999);
  eachPixel(core, (d, i, x, y) => {
    if (!d[i + 3]) return;
    const n = fbm(x / (9 * HR), y / (9 * HR), seed);
    const fine = vnoise(x / (1.6 * HR), y / (1.6 * HR), seed + 5);
    d[i + 3] *= Math.max(0, Math.min(1, 1.15 - wear * smooth(0.45, 0.75, n) - 0.3 * fine * wear));
  });
  // Runs.
  const runs: Pt[] = [];
  for (let k = 0; k < 600 && runs.length < 3; k++) {
    const x = 4 + r() * (w - 8), y = 4 + r() * (h - 8);
    const j = ((Math.floor(y * HR) * core.width) + Math.floor(x * HR)) * 4 + 3;
    const below = ((Math.floor((y + 2) * HR) * core.width) + Math.floor(x * HR)) * 4 + 3;
    if (cd[j] > 200 && (y + 2 >= h || cd[below] < 40)) runs.push([x, y]);
  }
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.drawImage(halo, 0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.drawImage(sp, 0, 0, w, h);
  ctx.globalAlpha = 0.92;
  ctx.drawImage(core, 0, 0, w, h);
  ctx.restore();
  for (const [x, y] of runs) {
    const len = 3 + r() * 11;
    poly(ctx, [[x, y], [x + (r() - 0.5) * 0.6, y + len]], 0.9, rgba(col, 0.7));
    blob(ctx, x, y + len, 0.9, 1.2, rgba(col, 0.75));
  }
}

function stencilText(text: string, size: number, w: number, h: number, cuts: (c: Ctx) => void): (c: Ctx) => void {
  return c => {
    c.save();
    c.font = `${size}px Impact, "Arial Black", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + size * 0.04);
    // Stencil bridges: the islands of a cut stencil need ties, so the letters have gaps.
    c.globalCompositeOperation = 'destination-out';
    cuts(c);
    c.restore();
  };
}

// ---------------------------------------------------------------- enamel plates

type Shape = { path: (c: Ctx) => void; dist: (x: number, y: number) => number };

function rectShape(x0: number, y0: number, x1: number, y1: number, rad = 4): Shape {
  return {
    path: c => { c.beginPath(); c.roundRect(x0, y0, x1 - x0, y1 - y0, rad); },
    dist: (x, y) => Math.min(x - x0, x1 - x, y - y0, y1 - y),
  };
}

function circleShape(cx: number, cy: number, rad: number): Shape {
  return { path: c => { c.beginPath(); c.arc(cx, cy, rad, 0, Math.PI * 2); }, dist: (x, y) => rad - Math.hypot(x - cx, y - cy) };
}

function triShape(cx: number, top: number, bottom: number, half: number): Shape {
  const pts: Pt[] = [[cx, top], [cx + half, bottom], [cx - half, bottom]];
  const edge = (a: Pt, b: Pt, x: number, y: number) => {
    const nx = b[1] - a[1], ny = a[0] - b[0];
    const l = Math.hypot(nx, ny);
    return -((x - a[0]) * nx + (y - a[1]) * ny) / l;
  };
  return {
    path: c => {
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1] + 3);
      c.arcTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1], 4);
      c.arcTo(pts[2][0], pts[2][1], pts[0][0], pts[0][1], 4);
      c.arcTo(pts[0][0], pts[0][1], pts[1][0], pts[1][1], 4);
      c.closePath();
    },
    dist: (x, y) => Math.min(edge(pts[0], pts[1], x, y), edge(pts[1], pts[2], x, y), edge(pts[2], pts[0], x, y)),
  };
}

const IRON = [52, 40, 32];
const PLATE_RUST = [138, 74, 36];

/**
 * A worn enamel plate: uneven enamel, the symbol, chipped edges showing iron and rust,
 * rust bleeding from the rivets, grime collecting low, a contact shadow on the wall.
 */
function plate(ctx: Ctx, r: () => number, w: number, h: number, shape: Shape, base: number[], symbol: (c: Ctx) => void, rivets: Pt[], chips = 1): void {
  // Contact shadow.
  ctx.save();
  ctx.filter = `blur(${2 * HR}px)`;
  ctx.translate(1.2, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  shape.path(ctx);
  ctx.fill();
  ctx.restore();
  const [p, pc] = layer(w, h);
  pc.fillStyle = rgba(base, 1);
  shape.path(pc);
  pc.fill();
  pc.save();
  pc.globalCompositeOperation = 'source-atop';
  symbol(pc);
  // Grime gathering toward the bottom.
  const g = pc.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(40,30,20,0)');
  g.addColorStop(1, 'rgba(40,30,20,0.38)');
  pc.fillStyle = g;
  pc.fillRect(0, 0, w, h);
  pc.restore();
  const seed = Math.floor(r() * 9999);
  eachPixel(p, (d, i, x, y) => {
    if (!d[i + 3]) return;
    const ux = x / HR, uy = y / HR;
    const n = fbm(ux / 7, uy / 7, seed);
    const v = 0.86 + 0.26 * fbm(ux / 22, uy / 22, seed + 3);
    d[i] *= v; d[i + 1] *= v; d[i + 2] *= v;
    const thr = 0.6 + Math.min(1, shape.dist(ux, uy) / 12) * 0.2 / chips;
    if (n > thr) {
      const c = n > thr + 0.035 ? IRON : PLATE_RUST;
      const k = 0.8 + 0.3 * vnoise(ux / 1.5, uy / 1.5, seed + 9);
      d[i] = c[0] * k; d[i + 1] = c[1] * k; d[i + 2] = c[2] * k;
    } else if (n > thr - 0.05) {
      // A ring of hairline crazing around each chip.
      d[i] *= 0.82; d[i + 1] *= 0.8; d[i + 2] *= 0.78;
    }
  });
  ctx.drawImage(p, 0, 0, w, h);
  // Edge light along the top, shade along the bottom.
  ctx.save();
  shape.path(ctx);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,250,235,0.18)';
  ctx.lineWidth = 1.2;
  ctx.translate(0, 0.8);
  shape.path(ctx);
  ctx.stroke();
  ctx.restore();
  for (const [x, y] of rivets) {
    poly(ctx, [[x, y], [x + 0.6, y + 8 + r() * 14]], 2.2, rgba(PLATE_RUST, 0.45), 0.8);
    blob(ctx, x, y, 2.1, 2.1, rgba([70, 66, 60], 1));
    blob(ctx, x - 0.5, y - 0.5, 0.9, 0.9, rgba([170, 160, 140], 0.8));
  }
  dots(ctx, r, 50, () => [r() * w, r() * h], 0.3, 0.9, [[40, 34, 28]], 0.15, 0.4);
}

const BLACK = 'rgb(28,26,24)';
const ENAMEL_WHITE = [222, 216, 200];

function runningMan(c: Ctx, x: number, y: number, s: number, col: string): void {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.strokeStyle = col;
  c.fillStyle = col;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.arc(3, -16, 3.2, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 3.6;
  c.beginPath();
  c.moveTo(1.5, -11); c.lineTo(-1.5, -1); // torso
  c.moveTo(1, -9); c.lineTo(6, -6); c.lineTo(9, -9); // front arm
  c.moveTo(1, -9); c.lineTo(-4, -7); c.lineTo(-6, -3); // back arm
  c.moveTo(-1.5, -1); c.lineTo(4, 3); c.lineTo(3, 9); // front leg
  c.moveTo(-1.5, -1); c.lineTo(-5, 4); c.lineTo(-10, 5); // back leg
  c.stroke();
  c.restore();
}

function exitSymbol(c: Ctx, w: number, h: number, col: string): void {
  c.save();
  c.strokeStyle = col;
  c.fillStyle = col;
  // Door frame on the right, the runner heading into it, an arrow underneath.
  c.lineWidth = 3;
  c.strokeRect(w * 0.6, h * 0.2, w * 0.2, h * 0.58);
  runningMan(c, w * 0.42, h * 0.62, 1.55, col);
  c.lineWidth = 3;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(w * 0.14, h * 0.5); c.lineTo(w * 0.26, h * 0.5);
  c.moveTo(w * 0.21, h * 0.42); c.lineTo(w * 0.27, h * 0.5); c.lineTo(w * 0.21, h * 0.58);
  c.stroke();
  c.restore();
}

// ---------------------------------------------------------------- the set

export const DECALS: Decal[] = [
  {
    name: 'crack-a', w: 128, h: 128, blend: 'alpha', fade: 0.2, tooth: 0.25,
    paint: (c, r, w, h) => { crack(c, r, 12, 20, 0.72, 135, 6.5, 1); crackDust(c, r, w, h); },
  },
  {
    name: 'crack-b', w: 128, h: 128, blend: 'alpha', fade: 0.2, tooth: 0.25,
    paint: (c, r, w, h) => { crack(c, r, 4, 62, 0.06, 124, 6.5, 1); crack(c, r, 60, 66, 2.4, 40, 4, 0); crackDust(c, r, w, h); },
  },
  {
    name: 'crack-c', w: 128, h: 128, blend: 'alpha', fade: 0.2, tooth: 0.25,
    paint: (c, r, w, h) => { crack(c, r, 62, 6, Math.PI / 2 + 0.08, 120, 6.8, 1); crackDust(c, r, w, h); },
  },
  {
    name: 'crack-d', w: 128, h: 128, blend: 'alpha', fade: 0.2, tooth: 0.25,
    // A hairline map of fine cracks (shrinkage), lighter than the structural ones.
    paint: (c, r, w, h) => {
      for (let i = 0; i < 5; i++) crack(c, r, 20 + r() * (w - 40), 20 + r() * (h - 40), r() * Math.PI * 2, 30 + r() * 36, 3.4, 1);
      crackDust(c, r, w, h);
    },
  },
  {
    name: 'crack-web', w: 128, h: 128, blend: 'alpha', fade: 0.2, tooth: 0.25,
    paint: (c, r, w, h) => {
      const cx = 64, cy = 62;
      // Crushed centre where something hit.
      blob(c, cx, cy, 11, 9, rgba(SEEP, 0.3), 3);
      blob(c, cx, cy, 6, 5, rgba(CRACK_MID, 0.75), 1);
      dots(c, r, 40, () => [cx + (r() - 0.5) * 16, cy + (r() - 0.5) * 14], 0.4, 1.6, [CRACK_DARK, CRACK_MID], 0.4, 0.9);
      const spokes: Pt[][] = [];
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.35;
        spokes.push(crack(c, r, cx + Math.cos(a) * 5, cy + Math.sin(a) * 5, a, 26 + r() * 30, 4.6, 0));
      }
      // Rings joining neighbouring spokes.
      for (const ring of [9, 17]) {
        for (let i = 0; i < n; i++) {
          if (r() < 0.3) continue;
          const a = spokes[i], b = spokes[(i + 1) % n];
          if (a.length <= ring || b.length <= ring) continue;
          const pts = wob(r, a[ring][0], a[ring][1], b[ring + 1][0], b[ring + 1][1], 1.4);
          taper(c, pts, 3.2, 1.6, rgba(CRACK_DARK, 0.85));
        }
      }
      crackDust(c, r, w, h);
    },
  },
  { name: 'stain-a', w: 96, h: 256, blend: 'alpha', fade: 0.14, tooth: 0.25, paint: (c, r, w, h) => waterStain(c, r, w, h, 8, 1) },
  { name: 'stain-b', w: 96, h: 256, blend: 'alpha', fade: 0.14, tooth: 0.25, paint: (c, r, w, h) => waterStain(c, r, w, h, 5, 0.75) },
  { name: 'rust-drip', w: 64, h: 192, blend: 'mul', fade: 0.12, gain: 1.35, paint: rustDrip },
  { name: 'mould', w: 128, h: 128, blend: 'mul', gain: 1.25, paint: mould },
  { name: 'soot', w: 128, h: 128, blend: 'mul', gain: 1.35, paint: soot },
  {
    name: 'scratch-tally', w: 128, h: 96, blend: 'mul', fade: 0.1, gain: 1.4,
    paint: (c, r, w, h) => tallyLayout(r, w, h, 3, (x0, y0, x1, y1) => scratchLine(c, r, x0, y0, x1, y1)),
  },
  {
    name: 'chalk-tally', w: 128, h: 96, blend: 'alpha',
    paint: (c, r, w, h) => tallyLayout(r, w, h, 3, (x0, y0, x1, y1) => chalkLine(c, r, wob(r, x0, y0, x1, y1, 0.6), 1.8)),
  },
  { name: 'chalk-kid', w: 192, h: 128, blend: 'alpha', paint: kidDrawing },
  { name: 'chalk-kid-b', w: 160, h: 128, blend: 'alpha', paint: kidDrawing2 },
  {
    name: 'handprints', w: 128, h: 128, blend: 'mul', gain: 1.15,
    paint: (c, r, w, h) => {
      const cols = [[176, 118, 52], [150, 62, 44], [64, 112, 110], [176, 118, 52]];
      const hands: [number, number, number, number][] = [[34, 40, 0.75, -0.3], [80, 34, 1, 0.15], [56, 84, 0.65, 0.35], [98, 88, 0.8, -0.1]];
      hands.forEach(([x, y, s, rot], i) => {
        const [hc, hx] = layer(w, h);
        hx.translate(x, y);
        hx.rotate(rot);
        hx.scale(s, s);
        hx.fillStyle = rgba(cols[i], 1);
        hx.beginPath();
        hx.ellipse(0, 6, 11, 12, 0, 0, Math.PI * 2);
        hx.fill();
        const fingers: [number, number, number][] = [[-12, 2, -1.0], [-6, -8, -0.25], [0, -10, 0], [6, -9, 0.2], [11, -5, 0.45]];
        for (const [fx, fy, fa] of fingers) {
          hx.save();
          hx.translate(fx, fy);
          hx.rotate(fa);
          hx.beginPath();
          hx.roundRect(-2.6, fx === -12 ? -4 : -11, 5.2, fx === -12 ? 11 : 14, 2.6);
          hx.fill();
          hx.restore();
        }
        const seed = Math.floor(r() * 9999);
        eachPixel(hc, (d, j, px, py) => {
          if (!d[j + 3]) return;
          d[j + 3] *= Math.max(0, Math.min(1, 0.25 + 1.1 * fbm(px / (3 * HR), py / (3 * HR), seed, 3)));
        });
        c.globalAlpha = 0.85;
        c.drawImage(hc, 0, 0, w, h);
        c.globalAlpha = 1;
      });
    },
  },
  {
    name: 'arrow', w: 128, h: 64, blend: 'alpha', fade: 0.06,
    paint: (c, r, w, h) => spray(c, r, w, h, s => {
      s.beginPath();
      s.moveTo(12, 25); s.lineTo(76, 25); s.lineTo(76, 10); s.lineTo(116, 32); s.lineTo(76, 54); s.lineTo(76, 39); s.lineTo(12, 39);
      s.closePath();
      s.fill();
    }, [214, 172, 72], 0.55),
  },
  {
    name: 'stencil-B', w: 96, h: 96, blend: 'alpha', fade: 0.06,
    paint: (c, r, w, h) => spray(c, r, w, h, stencilText('B', 84, w, h, s => {
      s.fillRect(0, h * 0.31, w * 0.47, 3.2);
      s.fillRect(0, h * 0.64, w * 0.47, 3.2);
    }), [222, 216, 198], 0.45),
  },
  {
    // Ten stencil digits in one strip (64×96 cells); the game crops the one it needs.
    name: 'stencil-digits', w: 640, h: 96, blend: 'alpha', fade: 0,
    paint: (c, r, w, h) => spray(c, r, w, h, s => {
      for (let d = 0; d < 10; d++) {
        const cx = d * 64 + 32;
        s.save();
        s.font = '80px Impact, "Arial Black", sans-serif';
        s.textAlign = 'center';
        s.textBaseline = 'middle';
        s.fillText(String(d), cx, h / 2 + 3);
        s.globalCompositeOperation = 'destination-out';
        if (d === 0 || d === 8) { s.fillRect(cx - 1.6, 4, 3.2, 22); s.fillRect(cx - 1.6, h - 26, 3.2, 22); }
        if (d === 6) s.fillRect(cx - 1.6, h * 0.5, 3.2, 22);
        if (d === 9) s.fillRect(cx - 1.6, h * 0.28, 3.2, 20);
        if (d === 4) s.fillRect(cx - 4, h * 0.56, 3, 10);
        s.restore();
      }
    }, [222, 216, 198], 0.4),
  },
  {
    name: 'patch', w: 128, h: 96, blend: 'alpha',
    paint: (c, r, w, h) => cementPatch(c, r, w / 2, h / 2, 50, 34),
  },
  {
    name: 'patch-b', w: 128, h: 128, blend: 'alpha',
    // A small patch over a crack that keeps running out of both ends.
    paint: (c, r, w, h) => {
      c.globalAlpha = 0.85;
      crack(c, r, 4, 40, 0.55, 150, 4, 1);
      c.globalAlpha = 1;
      cementPatch(c, r, 64, 64, 30, 24);
      void w; void h;
    },
  },
  {
    name: 'sign-radiation', w: 96, h: 96, blend: 'alpha',
    paint: (c, r, w, h) => plate(c, r, w, h, rectShape(8, 8, 88, 88, 5), [204, 166, 54], p => {
      p.fillStyle = BLACK;
      const cx = 48, cy = 50;
      p.beginPath();
      p.arc(cx, cy, 6.5, 0, Math.PI * 2);
      p.fill();
      for (const a of [-150, -30, 90]) {
        const a0 = ((a - 30) * Math.PI) / 180, a1 = ((a + 30) * Math.PI) / 180;
        p.beginPath();
        p.arc(cx, cy, 30, a0, a1);
        p.arc(cx, cy, 10, a1, a0, true);
        p.closePath();
        p.fill();
      }
      p.strokeStyle = BLACK;
      p.lineWidth = 2.4;
      p.strokeRect(13, 13, 70, 70);
    }, [[14, 14], [82, 14], [14, 82], [82, 82]]),
  },
  {
    name: 'sign-voltage', w: 96, h: 96, blend: 'alpha',
    paint: (c, r, w, h) => plate(c, r, w, h, triShape(48, 8, 86, 44), [210, 172, 56], p => {
      p.strokeStyle = BLACK;
      p.lineWidth = 6;
      p.lineJoin = 'round';
      p.beginPath();
      p.moveTo(48, 18); p.lineTo(84, 80); p.lineTo(12, 80); p.closePath();
      p.stroke();
      p.fillStyle = BLACK;
      p.beginPath();
      p.moveTo(52, 32); p.lineTo(38, 58); p.lineTo(48, 58); p.lineTo(42, 76); p.lineTo(60, 50); p.lineTo(50, 50); p.lineTo(58, 32);
      p.closePath();
      p.fill();
    }, [[48, 26]]),
  },
  {
    name: 'sign-nosmoke', w: 96, h: 96, blend: 'alpha',
    paint: (c, r, w, h) => plate(c, r, w, h, circleShape(48, 48, 40), ENAMEL_WHITE, p => {
      p.fillStyle = BLACK;
      p.fillRect(22, 50, 42, 8);
      p.fillStyle = 'rgb(200,120,60)';
      p.fillRect(64, 50, 9, 8);
      p.strokeStyle = 'rgba(60,58,56,0.9)';
      p.lineWidth = 2.2;
      p.beginPath();
      p.moveTo(70, 46); p.bezierCurveTo(64, 38, 76, 34, 70, 26);
      p.stroke();
      p.strokeStyle = 'rgb(168,52,40)';
      p.lineWidth = 9;
      p.beginPath();
      p.arc(48, 48, 32, 0, Math.PI * 2);
      p.stroke();
      p.beginPath();
      p.moveTo(25, 25); p.lineTo(71, 71);
      p.stroke();
    }, [[48, 12], [48, 84]], 1.2),
  },
  {
    name: 'sign-water', w: 96, h: 96, blend: 'alpha',
    paint: (c, r, w, h) => plate(c, r, w, h, rectShape(10, 8, 86, 88, 6), [58, 96, 130], p => {
      p.fillStyle = 'rgb(226,222,210)';
      p.beginPath();
      p.moveTo(48, 20);
      p.bezierCurveTo(56, 36, 68, 46, 68, 58);
      p.arc(48, 58, 20, 0, Math.PI);
      p.bezierCurveTo(28, 46, 40, 36, 48, 20);
      p.fill();
      p.fillStyle = 'rgba(58,96,130,0.7)';
      p.beginPath();
      p.ellipse(41, 62, 4, 7, -0.3, 0, Math.PI * 2);
      p.fill();
    }, [[16, 14], [80, 14]]),
  },
  {
    name: 'sign-exit', w: 128, h: 64, blend: 'alpha',
    paint: (c, r, w, h) => plate(c, r, w, h, rectShape(6, 8, 122, 58, 4), [54, 116, 78], p => exitSymbol(p, w, h, 'rgb(228,232,218)'), [[12, 14], [116, 14]], 1.3),
  },
  {
    name: 'sign-exit-glow', w: 128, h: 64, blend: 'add', fade: 0.12,
    paint: (c, r, w, h) => {
      c.save();
      c.filter = `blur(${7 * HR}px)`;
      c.fillStyle = 'rgba(70,200,120,0.55)';
      c.fillRect(14, 14, 100, 38);
      c.restore();
      c.save();
      c.filter = `blur(${1.6 * HR}px)`;
      exitSymbol(c, w, h, 'rgba(170,255,200,0.9)');
      c.restore();
      exitSymbol(c, w, h, 'rgba(220,255,230,0.55)');
      void r;
    },
  },
  {
    name: 'jbox', w: 96, h: 128, blend: 'alpha',
    paint: junctionBox,
  },
];

function cementPatch(ctx: Ctx, r: () => number, cx: number, cy: number, rx: number, ry: number): void {
  const seed = Math.floor(r() * 9999);
  const pts: Pt[] = [];
  for (let a = 0; a < Math.PI * 2; a += 0.12) {
    // A squarish trowelled blob.
    const ca = Math.cos(a), sa = Math.sin(a);
    const sq = 1 / Math.pow(Math.pow(Math.abs(ca), 4) + Math.pow(Math.abs(sa), 4), 0.25);
    const k = 0.86 + 0.24 * vnoise(Math.cos(a) * 2 + 3, Math.sin(a) * 2 + 3, seed);
    pts.push([cx + ca * rx * sq * k * 0.92, cy + sa * ry * sq * k * 0.92]);
  }
  const path = (c: Ctx) => { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts) c.lineTo(p[0], p[1]); c.closePath(); };
  // Feathered contact edge, then the fresh cement itself.
  ctx.save();
  ctx.filter = `blur(${1.2 * HR}px)`;
  ctx.strokeStyle = 'rgba(54,52,50,0.4)';
  ctx.lineWidth = 2.2;
  path(ctx);
  ctx.stroke();
  ctx.restore();
  const [p, pc] = layer(ctx.canvas.width / HR, ctx.canvas.height / HR);
  pc.fillStyle = 'rgb(128,129,126)';
  path(pc);
  pc.fill();
  pc.save();
  pc.globalCompositeOperation = 'source-atop';
  // Trowel sweeps.
  for (let i = 0; i < 9; i++) {
    const ax = cx + (r() - 0.5) * rx * 1.6, ay = cy + (r() - 0.5) * ry * 1.6, rad = 14 + r() * 26;
    const a0 = r() * Math.PI * 2;
    pc.strokeStyle = r() < 0.5 ? 'rgba(160,160,154,0.22)' : 'rgba(98,100,98,0.22)';
    pc.lineWidth = 3 + r() * 6;
    pc.beginPath();
    pc.arc(ax, ay, rad, a0, a0 + 0.8 + r());
    pc.stroke();
  }
  dots(pc, r, 500, () => [cx + (r() - 0.5) * rx * 2.2, cy + (r() - 0.5) * ry * 2.2], 0.25, 0.8, [[96, 96, 92], [176, 176, 170], [120, 118, 112]], 0.3, 0.8);
  pc.restore();
  eachPixel(p, (d, i, x, y) => {
    if (!d[i + 3]) return;
    const v = 0.9 + 0.18 * fbm(x / (12 * HR), y / (12 * HR), seed);
    d[i] *= v; d[i + 1] *= v; d[i + 2] *= v * 1.02;
  });
  ctx.drawImage(p, 0, 0, ctx.canvas.width / HR, ctx.canvas.height / HR);
  // Raised lip catching the light.
  ctx.save();
  path(ctx);
  ctx.clip();
  ctx.strokeStyle = 'rgba(180,180,174,0.18)';
  ctx.lineWidth = 1.2;
  path(ctx);
  ctx.stroke();
  ctx.restore();
}

function junctionBox(ctx: Ctx, r: () => number, w: number, h: number): void {
  // Scorch above and around the box.
  for (let i = 0; i < 8; i++) blob(ctx, 52 + (r() - 0.5) * 30, 34 - r() * 26, 10 + r() * 12, 8 + r() * 10, rgba(SOOT, 0.16), 5);
  // Conduit coming down from the ceiling.
  ctx.fillStyle = 'rgb(70,72,70)';
  ctx.fillRect(44, 0, 9, 34);
  ctx.fillStyle = 'rgba(160,160,150,0.35)';
  ctx.fillRect(45.5, 0, 2, 34);
  ctx.fillStyle = 'rgb(54,54,52)';
  ctx.fillRect(41, 22, 15, 6);
  // Shadow, box, bevels.
  ctx.save();
  ctx.filter = `blur(${2 * HR}px)`;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(28, 32, 50, 62);
  ctx.restore();
  const [b, bc] = layer(w, h);
  bc.fillStyle = 'rgb(86,94,82)';
  bc.fillRect(26, 28, 48, 60);
  bc.fillStyle = 'rgba(190,196,180,0.3)';
  bc.fillRect(26, 28, 48, 2.5);
  bc.fillRect(26, 28, 2.5, 60);
  bc.fillStyle = 'rgba(0,0,0,0.35)';
  bc.fillRect(26, 85, 48, 3);
  bc.fillRect(71, 28, 3, 60);
  // Open: dark inside, a burnt terminal block.
  bc.fillStyle = 'rgb(22,22,22)';
  bc.fillRect(31, 33, 38, 50);
  bc.fillStyle = 'rgb(70,66,58)';
  for (let i = 0; i < 4; i++) bc.fillRect(36 + i * 8, 44, 5, 9);
  bc.fillStyle = 'rgba(10,8,6,0.8)';
  bc.beginPath();
  bc.ellipse(52, 46, 13, 9, 0, 0, Math.PI * 2);
  bc.fill();
  const seed = Math.floor(r() * 9999);
  eachPixel(b, (d, i, x, y) => {
    if (!d[i + 3]) return;
    const n = fbm(x / (6 * HR), y / (6 * HR), seed);
    if (n > 0.66) { d[i] = 120 + n * 30; d[i + 1] = 66; d[i + 2] = 34; }
    const v = 0.88 + 0.2 * fbm(x / (14 * HR), y / (14 * HR), seed + 2);
    d[i] *= v; d[i + 1] *= v; d[i + 2] *= v;
  });
  ctx.drawImage(b, 0, 0, w, h);
  // The door hangs open on its left hinge.
  ctx.fillStyle = 'rgb(66,74,64)';
  ctx.beginPath();
  ctx.moveTo(26, 30); ctx.lineTo(12, 38); ctx.lineTo(12, 98); ctx.lineTo(26, 88);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.moveTo(26, 30); ctx.lineTo(19, 34); ctx.lineTo(19, 93); ctx.lineTo(26, 88);
  ctx.closePath();
  ctx.fill();
  // Torn wires spilling out.
  const wires: [string, number][] = [['rgb(150,52,40)', 38], ['rgb(186,156,62)', 46], ['rgb(30,30,30)', 54], ['rgb(62,84,124)', 61]];
  for (const [col, x] of wires) {
    const ex = x + (r() - 0.5) * 24, ey = 104 + r() * 16;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, 52);
    ctx.bezierCurveTo(x + (r() - 0.5) * 20, 80, ex + (r() - 0.5) * 16, 92, ex, ey);
    ctx.stroke();
    blob(ctx, ex, ey + 1, 1.3, 1.8, 'rgb(206,136,64)');
  }
  dots(ctx, r, 40, () => [20 + r() * 60, 26 + r() * 70], 0.3, 0.9, [[30, 26, 22]], 0.2, 0.5);
}

// ---------------------------------------------------------------- pipeline

function finish(d: Decal, ink: HTMLCanvasElement): HTMLCanvasElement {
  const seed = d.name.length * 131 + d.w;
  const tooth = d.tooth ?? (d.blend === 'alpha' ? 0.12 : 0.3);
  const fade = (d.fade ?? (d.blend === 'alpha' ? 0 : 0.2)) * Math.min(d.w, d.h) * HR;
  const W = ink.width, H = ink.height;
  eachPixel(ink, (px, i, x, y) => {
    if (!px[i + 3]) return;
    // The wall's tooth: fine noise breaks up the ink.
    const t = vnoise(x / (1.4 * HR), y / (1.4 * HR), seed) * 0.6 + vnoise(x / (5 * HR), y / (5 * HR), seed + 1) * 0.4;
    let a = 1 - tooth * smooth(0.35, 0.85, t);
    if (fade > 0) {
      const e = Math.min(x, W - 1 - x, y, H - 1 - y) / fade + (fbm(x / (18 * HR), y / (18 * HR), seed + 2) - 0.5) * 0.7;
      a *= smooth(0, 1, e);
    }
    px[i + 3] *= a;
  });
  // Halve to the final size.
  const [out, octx] = canvas(d.w, d.h);
  if (d.blend !== 'alpha') {
    octx.fillStyle = d.blend === 'mul' ? '#fff' : '#000';
    octx.fillRect(0, 0, d.w, d.h);
  }
  octx.drawImage(ink, 0, 0, d.w, d.h);
  // Multiply decals end up small and on dim concrete: push the ink well down so it still reads
  // (the game dials it back per sprite with alpha).
  if (d.blend === 'mul') {
    const gain = d.gain ?? 1.8;
    eachPixel(out, (px, i) => {
      for (let ch = 0; ch < 3; ch++) px[i + ch] = 255 - (255 - px[i + ch]) * gain;
    });
  }
  return out;
}

async function save(c: HTMLCanvasElement, key: string): Promise<number> {
  const blob = await new Promise<Blob>(res => c.toBlob(b => res(b!), 'image/webp', 0.9));
  await fetch(`/__art/save/${key}.webp`, { method: 'POST', body: blob });
  return blob.size;
}

const log = document.getElementById('log')!;
const outs = document.getElementById('outs')!;
const write = (s: string) => { log.textContent += `${s}\n`; };

/** Preview: each decal on a lamp-lit concrete swatch, blended the way the game draws it. */
function preview(d: Decal, c: HTMLCanvasElement): void {
  const box = document.createElement('div');
  box.className = `out ${d.blend}`;
  const im = document.createElement('img');
  im.src = c.toDataURL('image/png');
  im.style.width = `${d.w * 1.5}px`;
  im.style.mixBlendMode = d.blend === 'mul' ? 'multiply' : d.blend === 'add' ? 'screen' : 'normal';
  const cap = document.createElement('span');
  cap.textContent = d.name;
  box.append(im, cap);
  outs.appendChild(box);
}

/** All decals on a concrete swatch, blended as in the game, saved to store/compare/g7-wear/decal-sheet.png for review. */
async function contactSheet(list: [Decal, HTMLCanvasElement][], scale: number): Promise<string> {
  const cell = 200 * scale, cols = 6;
  const [c, ctx] = canvas(cols * cell, Math.ceil(list.length / cols) * cell);
  const r = rng(77);
  ctx.fillStyle = '#6f6c66';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(${r() < 0.5 ? '40,38,34' : '150,146,138'},${0.05 + r() * 0.08})`;
    ctx.beginPath();
    ctx.arc(r() * c.width, r() * c.height, 6 + r() * 40, 0, Math.PI * 2);
    ctx.fill();
  }
  list.forEach(([d, img], i) => {
    const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
    if (d.blend === 'add') {
      ctx.fillStyle = '#1a1a19';
      ctx.fillRect(x + 4, y + 4, cell - 8, cell - 8);
    }
    const s = Math.min((cell - 30) / d.w, (cell - 30) / d.h);
    ctx.globalCompositeOperation = d.blend === 'mul' ? 'multiply' : d.blend === 'add' ? 'lighter' : 'source-over';
    ctx.drawImage(img, x + (cell - d.w * s) / 2, y + 4 + (cell - 24 - d.h * s) / 2, d.w * s, d.h * s);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff';
    ctx.font = `${12 * scale}px monospace`;
    ctx.fillText(d.name, x + 6, y + cell - 6);
  });
  const blob = await new Promise<Blob>(res => c.toBlob(b => res(b!), 'image/png'));
  await fetch('/__store/save/store/compare/g7-wear/decal-sheet.png', { method: 'POST', body: blob });
  return `${(blob.size / 1024).toFixed(0)} KB`;
}

async function run(): Promise<void> {
  log.textContent = '';
  const p = new URLSearchParams(location.search);
  const only = p.get('only');
  const dry = p.has('dry');
  await document.fonts.ready;
  const done: [Decal, HTMLCanvasElement][] = [];
  for (const d of DECALS) {
    if (only && !d.name.includes(only)) continue;
    const [ink, ctx] = layer(d.w, d.h);
    const r = rng(9001 + d.name.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
    d.paint(ctx, r, d.w, d.h);
    const out = finish(d, ink);
    preview(d, out);
    done.push([d, out]);
    if (dry) { write(`${d.name} (dry)`); continue; }
    const bytes = await save(out, `kit/decal-${d.name}`);
    write(`kit/decal-${d.name}`.padEnd(28) + ` ${d.w}x${d.h} ${d.blend.padEnd(5)} ${(bytes / 1024).toFixed(1)} KB`);
  }
  if (p.has('sheet')) write(`sheet ${await contactSheet(done, Number(p.get('sheet')) || 2)}`);
  write('done');
  (window as unknown as { __decalsDone: boolean }).__decalsDone = true;
}

if (new URLSearchParams(location.search).has('auto') || new URLSearchParams(location.search).has('dry')) void run();

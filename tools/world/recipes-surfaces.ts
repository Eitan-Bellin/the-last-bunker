/**
 * World kit recipes, part 1: tiles and strips painted per pixel (rock cut faces, banding strips, cut edge, walls, tape, railing, deck).
 * Every function returns canvases of exactly the size in `src/world/tokensAssets.ts`.
 */
import { STRATA } from '../../src/world/tokens';
import { KIT_STRATUM, type WorldAssetDef, type WorldKitId } from '../../src/world/tokensAssets';
import {
  Field, blur, clamp01, css, ctx, fbm, glow, grainPass, hashStr, jag, litField, mask, mixHex, mk, outline, pal, putBytes, rgb, rng, scaled,
  shade, smooth, stroke, vnoise, wear, type G, type RNG,
} from './paint';

export interface Baked {
  albedo: HTMLCanvasElement;
  emissive?: HTMLCanvasElement;
}
export interface Sources {
  wall: HTMLImageElement | null;
  column: HTMLImageElement | null;
  wheel: HTMLImageElement | null;
}

const TAU = Math.PI * 2;

/** Albedo buffer helpers. */
function albedoBuf(w: number, h: number): Float32Array {
  return new Float32Array(w * h * 3);
}
function setA(A: Float32Array, i: number, c: number, k = 1): void {
  A[i * 3] = ((c >> 16) & 255) * k;
  A[i * 3 + 1] = ((c >> 8) & 255) * k;
  A[i * 3 + 2] = (c & 255) * k;
}
function lerpA(A: Float32Array, i: number, c: number, t: number): void {
  if (t <= 0) return;
  A[i * 3] += (((c >> 16) & 255) - A[i * 3]) * t;
  A[i * 3 + 1] += (((c >> 8) & 255) - A[i * 3 + 1]) * t;
  A[i * 3 + 2] += ((c & 255) - A[i * 3 + 2]) * t;
}
function mulA(A: Float32Array, i: number, k: number): void {
  A[i * 3] *= k; A[i * 3 + 1] *= k; A[i * 3 + 2] *= k;
}

/** Stamps a dome (stone, pebble) into height and albedo, wrapping around the tile edges. */
function stampStone(H: Field, A: Float32Array, cx: number, cy: number, rx: number, ry: number, amp: number, col: number, wrapX: boolean, wrapY: boolean): void {
  const { w, h } = H;
  const x0 = Math.floor(cx - rx - 1), x1 = Math.ceil(cx + rx + 1), y0 = Math.floor(cy - ry - 1), y1 = Math.ceil(cy + ry + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
    if (d >= 1) continue;
    let X = x, Y = y;
    if (wrapX) X = ((X % w) + w) % w; else if (X < 0 || X >= w) continue;
    if (wrapY) Y = ((Y % h) + h) % h; else if (Y < 0 || Y >= h) continue;
    const i = Y * w + X;
    const dome = Math.sqrt(1 - d);
    H.d[i] = Math.max(H.d[i], H.d[i] * 0.4 + dome * amp);
    lerpA(A, i, col, smooth(0, 0.35, dome));
  }
}

// =================================================================================================================================
// Rock cut-face tiles
// =================================================================================================================================

interface RockParams {
  cells: number;
  beds: number;
  bedFreq: number;
  warp: number;
  ridge: number;
  stones: number;
  stoneR: [number, number];
  stoneCol: number[];
  cracks: number;
  bump: number;
  spec: number;
  drape?: boolean;
}

const ROCK: Record<WorldKitId, RockParams> = {
  surface: { cells: 5, beds: 0.08, bedFreq: 9, warp: 0.6, ridge: 0.12, stones: 70, stoneR: [3, 9], stoneCol: [0x6a5444, 0x7a6a5a, 0x3a2a20], cracks: 2, bump: 2.2, spec: 0 },
  shelter: { cells: 4, beds: 0.14, bedFreq: 7, warp: 0.5, ridge: 0.15, stones: 55, stoneR: [4, 11], stoneCol: [0x7a5c44, 0x8a7460, 0x5a4030], cracks: 2, bump: 2.0, spec: 0 },
  works: { cells: 4, beds: 0.22, bedFreq: 9, warp: 0.35, ridge: 0.1, stones: 110, stoneR: [3, 10], stoneCol: [0x8a8270, 0x9a8a6a, 0x5e5848], cracks: 3, bump: 2.4, spec: 0 },
  metro: { cells: 3, beds: 0.04, bedFreq: 4, warp: 0.3, ridge: 0.3, stones: 10, stoneR: [6, 14], stoneCol: [0x6a6c72, 0x8a8e96], cracks: 6, bump: 2.8, spec: 0.05 },
  mines: { cells: 4, beds: 0.05, bedFreq: 5, warp: 0.4, ridge: 0.35, stones: 20, stoneR: [5, 12], stoneCol: [0x4a4440, 0x2a2624], cracks: 4, bump: 2.6, spec: 0.35 },
  caves: { cells: 3, beds: 0.06, bedFreq: 3, warp: 0.8, ridge: 0.25, stones: 14, stoneR: [6, 16], stoneCol: [0x4a3e60, 0x2a2238], cracks: 3, bump: 2.4, spec: 0.22, drape: true },
  core: { cells: 3, beds: 0.03, bedFreq: 3, warp: 0.5, ridge: 0.4, stones: 12, stoneR: [8, 18], stoneCol: [0x2a2426, 0x141012], cracks: 7, bump: 3, spec: 0.12 },
};

/** A crack mask (wrapped) of n jagged cracks. */
function crackMask(S: number, Hh: number, r: RNG, n: number, width: number, wrapAll: boolean, dir: 'any' | 'v' | 'h' = 'any'): Field {
  const cracks: { pts: number[]; w: number }[] = [];
  for (let k = 0; k < n; k++) {
    const x = r() * S, y = r() * Hh;
    const a = dir === 'v' ? Math.PI / 2 + (r() - 0.5) * 0.4 : dir === 'h' ? (r() - 0.5) * 0.3 : r() * Math.PI;
    const len = (0.25 + r() * 0.35) * S;
    cracks.push({ pts: jag(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, r, len * 0.05, 14), w: width * (0.6 + r() * 0.8) });
  }
  return mask(S, Hh, g => {
    for (const c of cracks) {
      stroke(g, c.pts, c.w * 2.6, 'rgba(255,255,255,0.25)');
      stroke(g, c.pts, c.w, 'rgba(255,255,255,1)');
      // a branch
      const m = Math.floor(c.pts.length / 4) * 2;
      stroke(g, [c.pts[m], c.pts[m + 1], c.pts[m] + (c.pts[m + 3] - c.pts[m + 1]) * 3, c.pts[m + 1] - (c.pts[m + 2] - c.pts[m]) * 3], c.w * 0.5, 'rgba(255,255,255,0.8)');
    }
  }, wrapAll);
}

export function rockTile(def: WorldAssetDef, kit: WorldKitId): Baked {
  const [S] = def.px;
  const P = ROCK[kit];
  const st = STRATA[KIT_STRATUM[kit]].palette;
  const rock = pal(st.rock), dark = pal(st.rockDark), rim = pal(st.rockRim);
  const seed = hashStr(def.id);
  const r = rng(seed);
  const H = new Field(S, S);
  const A = albedoBuf(S, S);
  const cy = P.drape ? P.cells * 4 : P.cells;
  const cx = P.drape ? Math.max(1, Math.round(P.cells / 1.5)) : P.cells;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u0 = x / S, v0 = y / S, i = y * S + x;
    // periodic domain warp: breaks the lattice look of value noise and keeps the tile seamless
    const u = u0 + (fbm(u0, v0, { seed: seed + 41, cx: 3, oct: 3 }) - 0.5) * 0.09;
    const v = v0 + (fbm(u0, v0, { seed: seed + 43, cx: 3, oct: 3 }) - 0.5) * 0.09;
    const n = fbm(u, v, { seed, cx: P.drape ? cx * 2 : cx, cy: P.drape ? cy : cx, oct: 6 });
    const rd = fbm(u, v, { seed: seed + 1, cx: cx * 2, cy: (P.drape ? cy : cx * 2), oct: 4, ridged: true });
    const warp = fbm(u, v, { seed: seed + 2, cx: 2, cy: 2, oct: 3 }) - 0.5;
    const bedPhase = v * P.bedFreq + warp * P.warp;
    // irregular beds: each bed has its own thickness profile and tone (a soft step, not a sine)
    const bedIdx = Math.floor(bedPhase), bf = bedPhase - bedIdx;
    const bedTone = vnoise(((bedIdx % P.bedFreq) + P.bedFreq) % P.bedFreq * 1.7, 0.3, seed + 17, P.bedFreq * 1.7) * 2 - 1;
    const bed = bedTone * 0.6 + (smooth(0, 0.12, bf) - smooth(0.88, 1, bf)) * 0.4;
    H.d[i] = n * 1.0 + rd * P.ridge + bed * P.beds;
    const t = fbm(u, v, { seed: seed + 3, cx: cx * 2, cy: P.drape ? cy : cx * 2, oct: 5 });
    setA(A, i, mixHex(dark, rock, smooth(0.28, 0.66, t)));
    // beds carry tone, the lit crests pick up the rim colour
    mulA(A, i, 1 + 0.5 * P.beds * bedTone);
    if (bf < 0.035 || bf > 0.965) mulA(A, i, 1 - P.beds * 1.2);
    lerpA(A, i, rim, smooth(0.66, 0.9, rd) * 0.22);
    if (P.drape) lerpA(A, i, shade(rim, 0.9), smooth(0.55, 0.85, fbm(u, v, { seed: seed + 9, cx: cx * 4, cy: 2, oct: 3 })) * 0.25);
  }
  // stones
  for (let k = 0; k < P.stones; k++) {
    let y = r() * S;
    if (kit === 'works') y = r() * S * 0.5; // gravel in the upper half, beds below
    const rr = P.stoneR[0] + r() * (P.stoneR[1] - P.stoneR[0]);
    const col = pal(P.stoneCol[Math.floor(r() * P.stoneCol.length)]);
    stampStone(H, A, r() * S, y, rr, rr * (0.55 + r() * 0.3), 0.9 + r() * 0.4, shade(col, 0.8 + r() * 0.4), true, true);
  }
  // joints, blocks, columns and cracks
  const cr = rng(seed + 11);
  let M = crackMask(S, S, cr, P.cracks, kit === 'core' ? 3 : 2, true);
  if (kit === 'metro') {
    // granite blocks: wandering courses and staggered vertical joints
    M = combine(M, mask(S, S, g => {
      const rows = 4;
      for (let k = 0; k < rows; k++) {
        const y = (k / rows) * S + 10;
        stroke(g, jag(-20, y, S + 20, y + (cr() - 0.5) * 6, cr, 4, 16), 2.2, 'rgba(255,255,255,0.9)');
        const cols = 2 + Math.floor(cr() * 2);
        for (let j = 0; j < cols; j++) {
          const x = ((j + (k % 2) * 0.5) / cols) * S + cr() * 30;
          stroke(g, jag(x, y, x + (cr() - 0.5) * 16, y + S / rows, cr, 3, 6), 2, 'rgba(255,255,255,0.85)');
        }
      }
    }, true));
  }
  if (kit === 'mines') {
    M = combine(M, mask(S, S, g => {
      for (let k = 0; k < 7; k++) {
        const x = (k / 7) * S + cr() * 30;
        const y0 = cr() * S;
        stroke(g, jag(x, y0, x + (cr() - 0.5) * 60, y0 + S * (0.5 + cr() * 0.4), cr, 9, 12), 1.4 + cr() * 1.2, 'rgba(255,255,255,0.85)');
      }
    }, true));
  }
  const Mb = blur(M, 1, true);
  for (let i = 0; i < S * S; i++) {
    const m = Mb.d[i];
    if (m <= 0.01) continue;
    H.d[i] -= m * 0.9;
    lerpA(A, i, shade(dark, 0.45), m * 0.85);
  }
  // wet sheen mask (mines, caves): streaks running down
  const specMask = P.spec ? Field.of(S, S, (u, v) => 0.25 + 0.75 * smooth(0.45, 0.8, fbm(u, v, { seed: seed + 21, cx: 6, cy: 1, oct: 3 }))) : undefined;
  const bytes = litField(A, H, { wrap: true, bump: P.bump * 6, ambient: 0.5, diffuse: 0.62, aoR: 5, ao: 1.8, spec: P.spec, shiny: 24, specMask });
  const c = mk(S, S);
  putBytes(c, bytes);
  const g = ctx(c);

  // painted extras (wrapped)
  const ex = rng(seed + 31);
  const wrapDraw = (draw: (g2: G) => void) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.save(); g.translate(ox, oy); draw(g); g.restore(); }
  };
  let em: HTMLCanvasElement | undefined;
  if (kit === 'surface' || kit === 'shelter') {
    const roots: number[][] = [];
    const n = kit === 'surface' ? 9 : 4;
    for (let k = 0; k < n; k++) {
      const x = ex() * S, y = ex() * S;
      roots.push(jag(x, y, x + (ex() - 0.5) * 80, y + 60 + ex() * 120, ex, 7, 10));
    }
    wrapDraw(gg => {
      for (const p of roots) {
        stroke(gg, p, 3.2, css(0x1a1008, 0.55));
        stroke(gg, p.map((v, j) => (j % 2 ? v - 1 : v - 0.6)), 1.1, css(0x9a7a5a, 0.35));
      }
    });
    // ash / charcoal specks
    const specks: [number, number, number, number][] = [];
    for (let k = 0; k < (kit === 'surface' ? 900 : 300); k++) specks.push([ex() * S, ex() * S, 0.6 + ex() * 1.6, ex()]);
    for (const [x, y, s, t] of specks) { g.fillStyle = t < 0.5 ? css(0x0c0806, 0.5) : css(0xb8aa98, 0.35); g.fillRect(x, y, s, s * 0.8); }
  }
  if (kit === 'works' || kit === 'metro') {
    for (let k = 0; k < (kit === 'metro' ? 1400 : 500); k++) { g.fillStyle = ex() < 0.5 ? css(0xe8e4dc, 0.3) : css(0x0e0e10, 0.35); g.fillRect(ex() * S, ex() * S, 1 + ex(), 1 + ex()); }
  }
  if (kit === 'mines') {
    em = mk(S, S);
    const eg = ctx(em);
    const veins: number[][] = [];
    for (let k = 0; k < 4; k++) { const x = ex() * S, y = ex() * S; veins.push(jag(x, y, x + 140 + ex() * 120, y + (ex() - 0.5) * 160, ex, 10, 16)); }
    wrapDraw(gg => { for (const p of veins) { stroke(gg, p, 5, css(pal(0x2a6a58), 0.28)); stroke(gg, p, 1.2, css(pal(0x3fa58a, 0.6, 0.05), 0.6)); } });
    for (let k = 0; k < 70; k++) {
      const x = ex() * S, y = ex() * S;
      g.fillStyle = css(0xd8b04a, 0.85);
      g.fillRect(x, y, 1.5, 1.5);
      glow(eg, x + 0.75, y + 0.75, 3, 0xd8b04a, 0.5);
    }
  }
  if (kit === 'caves' || kit === 'core') {
    em = mk(S, S);
    const eg = ctx(em);
    if (kit === 'caves') {
      const xs: [number, number, number][] = [];
      for (let k = 0; k < 26; k++) xs.push([ex() * S, ex() * S, 2 + ex() * 4]);
      for (const [x, y, s] of xs) {
        for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
          const X = x + ox, Y = y + oy;
          if (X < -10 || X > S + 10 || Y < -10 || Y > S + 10) continue;
          g.fillStyle = css(0x7af2ff, 0.55);
          g.beginPath(); g.moveTo(X, Y - s * 1.6); g.lineTo(X + s * 0.6, Y); g.lineTo(X, Y + s * 0.5); g.lineTo(X - s * 0.6, Y); g.closePath(); g.fill();
          glow(eg, X, Y, s * 3.5, 0x7af2ff, 0.55);
        }
      }
    } else {
      const fis: number[][] = [];
      for (let k = 0; k < 5; k++) { const x = ex() * S, y = ex() * S, a = ex() * Math.PI; fis.push(jag(x, y, x + Math.cos(a) * 180, y + Math.sin(a) * 180, ex, 12, 12)); }
      wrapDraw(gg => { for (const p of fis) { stroke(gg, p, 6, css(0x3a0c04, 0.6)); stroke(gg, p, 2, css(0xb03010, 0.8)); stroke(gg, p, 0.8, css(0xffa040, 0.8)); } });
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        eg.save(); eg.translate(ox, oy);
        for (const p of fis) { stroke(eg, p, 12, css(0xff3a10, 0.18)); stroke(eg, p, 4, css(0xff5a1e, 0.6)); stroke(eg, p, 1.4, css(0xffc070, 0.95)); }
        eg.restore();
      }
    }
  }
  grainPass(c, seed + 99);
  return { albedo: c, emissive: em && def.emissive && def.emissive !== true ? scaled(blackUnder(em), S * def.emissive.scale, S * def.emissive.scale) : undefined };
}

function combine(a: Field, b: Field): Field {
  for (let i = 0; i < a.d.length; i++) a.d[i] = Math.max(a.d[i], b.d[i]);
  return a;
}

/** Emissive maps are glow on BLACK (additive): fill the transparent parts. */
export function blackUnder(c: HTMLCanvasElement): HTMLCanvasElement {
  const o = mk(c.width, c.height);
  const g = ctx(o);
  g.fillStyle = '#000';
  g.fillRect(0, 0, o.width, o.height);
  g.drawImage(c, 0, 0);
  return o;
}

// =================================================================================================================================
// Banding strips (512 x 128, tile sideways, feathered top and bottom)
// =================================================================================================================================

export function rockBand(def: WorldAssetDef, kit: WorldKitId): Baked {
  const [W, Hh] = def.px;
  const st = STRATA[KIT_STRATUM[kit]].palette;
  const seed = hashStr(def.id);
  const r = rng(seed);
  const rock = pal(st.rock), dark = pal(st.rockDark), rim = pal(st.rockRim);
  const H = new Field(W, Hh);
  const A = albedoBuf(W, Hh);
  const alpha = new Float32Array(W * Hh);
  const bandCol: Record<WorldKitId, number> = {
    surface: shade(dark, 0.55), shelter: mixHex(rock, rim, 0.25), works: mixHex(rock, 0xb8a888, 0.35), metro: pal(0x9a9c9c),
    mines: pal(0x3a3430), caves: pal(0x8a80a0), core: pal(0x221a1a),
  };
  const bc = bandCol[kit];
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / Hh, i = y * W + x;
    const edge = fbm(u, 0.5, { seed: seed + 5, cx: 6, cy: 1, oct: 4 }) - 0.5, edge2 = fbm(u, 0.2, { seed: seed + 6, cx: 7, cy: 1, oct: 4 }) - 0.5;
    const top = 0.3 + edge * 0.18, bot = 0.72 + edge2 * 0.18;
    const inBand = smooth(top - 0.03, top + 0.03, v) * (1 - smooth(bot - 0.03, bot + 0.03, v));
    const n = fbm(u, v, { seed, cx: 8, cy: 2, oct: 5 });
    H.d[i] = n * 0.8 + inBand * 0.5;
    setA(A, i, mixHex(dark, rock, smooth(0.3, 0.7, fbm(u, v, { seed: seed + 3, cx: 10, cy: 3, oct: 4 }))));
    lerpA(A, i, mixHex(bc, shade(bc, 1.3), n), inBand * 0.9);
    // fine laminae in the band (cross-bedding for works)
    const lam = Math.sin((v * 22 + (kit === 'works' ? u * 6 : 0) + edge * 3) * TAU);
    mulA(A, i, 1 + lam * 0.06 * inBand);
    // contact lines
    const cl = Math.exp(-Math.pow((v - top) * Hh / 1.6, 2)) + Math.exp(-Math.pow((v - bot) * Hh / 1.6, 2));
    mulA(A, i, 1 - cl * 0.45);
    H.d[i] -= cl * 0.3;
    alpha[i] = smooth(0, 0.22, v) * (1 - smooth(0.78, 1, v)) * (0.85 + 0.15 * n);
  }
  // pebbles along the band
  const nPeb = kit === 'shelter' || kit === 'works' || kit === 'surface' ? 70 : 24;
  for (let k = 0; k < nPeb; k++) {
    const rr = 2 + r() * (kit === 'shelter' ? 7 : 5);
    stampStone(H, A, r() * W, Hh * (0.36 + r() * 0.3), rr, rr * 0.65, 1, pal(shade(mixHex(rim, rock, r()), 0.7 + r() * 0.5)), true, false);
  }
  const bytes = litField(A, H, { wrap: true, bump: 9, ambient: 0.52, diffuse: 0.6, aoR: 3, ao: 1.6, spec: kit === 'mines' || kit === 'caves' ? 0.25 : 0 });
  for (let i = 0; i < W * Hh; i++) bytes[i * 4 + 3] = alpha[i] * 255;
  const c = mk(W, Hh);
  putBytes(c, bytes);
  const g = ctx(c);
  let em: HTMLCanvasElement | undefined;
  const ex = rng(seed + 7);
  if (kit === 'surface') for (let k = 0; k < 160; k++) { g.fillStyle = css(0x050404, 0.55); g.fillRect(ex() * W, Hh * (0.35 + ex() * 0.3), 1 + ex() * 3, 1 + ex() * 2); }
  if (kit === 'mines' || kit === 'caves' || kit === 'core') {
    em = mk(W, Hh);
    const eg = ctx(em);
    const col = kit === 'mines' ? 0x3fa58a : kit === 'caves' ? 0x7af2ff : 0xff5a1e;
    const pts = jag(-20, Hh * 0.5, W + 20, Hh * 0.52, ex, 8, 24);
    for (const ox of [-W, 0, W]) {
      g.save(); g.translate(ox, 0);
      if (kit === 'core') { stroke(g, pts, 5, css(0x3a0c04, 0.7)); stroke(g, pts, 1.6, css(0xffa040, 0.8)); }
      else { stroke(g, pts, 3, css(pal(col, 0.6, 0.05), 0.7)); }
      g.restore();
      eg.save(); eg.translate(ox, 0);
      stroke(eg, pts, kit === 'core' ? 10 : 6, css(col, kit === 'mines' ? 0.12 : 0.3));
      stroke(eg, pts, kit === 'core' ? 2.5 : 1.5, css(col, kit === 'mines' ? 0.35 : 0.8));
      eg.restore();
    }
    if (kit !== 'core') for (let k = 0; k < 30; k++) { const x = ex() * W, y = Hh * (0.38 + ex() * 0.26); g.fillStyle = css(col, 0.6); g.fillRect(x, y, 1.6, 1.6); glow(eg, x, y, 4, col, 0.6); }
  }
  grainPass(c, seed + 99);
  const e = def.emissive && def.emissive !== true ? def.emissive : null;
  return { albedo: c, emissive: em && e ? scaled(blackUnder(em), W * e.scale, Hh * e.scale) : undefined };
}

// =================================================================================================================================
// Cut edge
// =================================================================================================================================

export function edgeRim(def: WorldAssetDef): Baked {
  const [W, Hh] = def.px;
  const seed = hashStr(def.id);
  const c = mk(W, Hh);
  const g = ctx(c);
  const img = g.createImageData(W, Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const u = x / W;
    const top = 3 + (fbm(u, 0, { seed, cx: 16, cy: 1, oct: 3 }) - 0.5) * 3;
    const chip = vnoise(u * 40, 0, seed + 3, 40) < 0.07 ? 0.4 : 1;
    const core = smooth(top - 0.8, top + 0.4, y) * (1 - smooth(top + 3.2, top + 4.6, y));
    const tail = y > top + 4 ? Math.pow(1 - clamp01((y - top - 4) / (Hh - top - 4)), 2) * 0.35 : 0;
    const a = Math.max(core * chip, tail) * (0.8 + 0.2 * vnoise(u * 90, y * 0.3, seed + 5, 90));
    const i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return { albedo: c };
}

export function edgeAo(def: WorldAssetDef): Baked {
  const [W, Hh] = def.px;
  const seed = hashStr(def.id);
  const c = mk(W, Hh);
  const g = ctx(c);
  const img = g.createImageData(W, Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const u = x / W;
    const reach = 0.75 + (fbm(u, 0, { seed, cx: 6, cy: 1, oct: 4 }) - 0.5) * 0.5;
    const t = clamp01(y / (Hh * reach));
    const a = Math.pow(1 - t, 1.6) * (0.9 + 0.1 * vnoise(u * 64, y * 0.4, seed + 1, 64));
    const i = (y * W + x) * 4;
    img.data[i] = 8; img.data[i + 1] = 6; img.data[i + 2] = 5;
    img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return { albedo: c };
}

// =================================================================================================================================
// Caution tape, railing, deck (strips, tile sideways)
// =================================================================================================================================

export function tape(def: WorldAssetDef): Baked {
  const [W, Hh] = def.px;
  const seed = hashStr(def.id);
  const c = mk(W, Hh);
  const g = ctx(c);
  const yel = pal(0xd8b030, 0.62, 0.08), blk = pal(0x1c1a16);
  const img = g.createImageData(W, Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const u = x / W;
    const mid = Hh / 2 + Math.sin(u * TAU) * 1.8;
    const tw = Math.abs(Math.cos(u * TAU * 2 + 0.6));
    const half = 6.5 * (0.35 + 0.65 * tw);
    const d = Math.abs(y - mid);
    const fray = (vnoise(u * 120, y * 0.5, seed, 120) - 0.5) * 1.2;
    const a = 1 - smooth(half - 0.6 + fray, half + 0.6 + fray, d);
    if (a <= 0) continue;
    const stripe = ((x + (y - mid) * 1.0) % 24 + 24) % 24 < 12;
    let col = stripe ? yel : blk;
    const dirt = fbm(u, y / Hh, { seed: seed + 2, cx: 8, cy: 1, oct: 4 });
    col = mixHex(col, pal(0x4a3c2a), smooth(0.55, 0.85, dirt) * 0.6);
    // the twist: the far face is darker, a crease along the middle
    let k = 0.55 + 0.45 * tw;
    k *= 1 - 0.18 * Math.exp(-Math.pow((y - mid) / 1.2, 2)) * (1 - tw);
    k *= 1.06 - 0.12 * ((y - mid + half) / (2 * half));
    const [R, G2, B] = rgb(col);
    const i = (y * W + x) * 4;
    img.data[i] = R * k; img.data[i + 1] = G2 * k; img.data[i + 2] = B * k; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  grainPass(c, seed + 9, 0.12, 0.3);
  outline(c, 2);
  return { albedo: c };
}

/** Neutral light enamel (the runtime tints it with the stratum's secondary colour). */
const NEUTRAL_PAINT = 0xd6d2c8;

export function railing(def: WorldAssetDef): Baked {
  const [W, Hh] = def.px; // 256 x 48, 2 px/u, deck line at the bottom
  const seed = hashStr(def.id);
  const c = mk(W, Hh);
  const g = ctx(c);
  const P = def.ppu;
  const base = NEUTRAL_PAINT;
  // posts (square tube) every 64 u, away from the seam
  for (const px of [32, 160]) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(px + 4, 9, 2, Hh - 9);
    const gr = g.createLinearGradient(px, 0, px + 5, 0);
    gr.addColorStop(0, css(shade(base, 1.08)));
    gr.addColorStop(0.45, css(shade(base, 0.92)));
    gr.addColorStop(1, css(shade(base, 0.55)));
    g.fillStyle = gr;
    g.fillRect(px, 8, 5, Hh - 8);
    // base flange
    g.fillStyle = css(shade(base, 0.7));
    g.fillRect(px - 2, Hh - 10, 9, 2);
  }
  // rails
  const topY = 6, midY = 25;
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(0, topY + 6, W, 2);
  cylH(g, 0, topY, W, 6, base);
  cylH(g, 0, midY, W, 3.5, shade(base, 0.95));
  // kick plate
  const kp = g.createLinearGradient(0, Hh - 9, 0, Hh);
  kp.addColorStop(0, css(shade(base, 1.05)));
  kp.addColorStop(0.2, css(shade(base, 0.86)));
  kp.addColorStop(1, css(shade(base, 0.6)));
  g.fillStyle = kp;
  g.fillRect(0, Hh - 8, W, 8);
  // scuffs and chips on the paint
  wear(c, seed, shade(base, 0.62), 0.12, { cells: 14, soft: 0.04 });
  wear(c, seed + 1, 0x7a6a58, 0.05, { cells: 20, soft: 0.03 });
  grainPass(c, seed + 9, 0.12, 0.3);
  outline(c, 1.5 * P);
  // the outline must not close the strip at its ends: the rails run on
  return { albedo: c };
}

function cylH(g: G, x: number, y: number, w: number, h: number, base: number): void {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, css(shade(base, 0.85)));
  gr.addColorStop(0.25, css(shade(base, 1.12)));
  gr.addColorStop(0.5, css(shade(base, 0.95)));
  gr.addColorStop(1, css(shade(base, 0.5)));
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
}

/** Dark painted steel shared by decks, stairs and doors frames. */
export const STEEL = 0x4a4c48;

export function deck(def: WorldAssetDef): Baked {
  const [W, Hh] = def.px; // 256 x 64, walking line at y = 0
  const seed = hashStr(def.id);
  const P = def.ppu;
  const c = mk(W, Hh);
  const g = ctx(c);
  const steel = pal(STEEL);
  const pad = 4;
  // grating lip (top 3 u)
  const lipH = 3 * P;
  g.fillStyle = css(shade(steel, 0.55));
  g.fillRect(0, pad, W, lipH);
  for (let x = 0; x < W; x += 4) { g.fillStyle = css(shade(steel, 1.25)); g.fillRect(x, pad, 2, lipH - 1); }
  g.fillStyle = css(shade(steel, 1.5));
  g.fillRect(0, pad, W, 1);
  // channel face
  const fy = pad + lipH, fh = 9 * P;
  const gr = g.createLinearGradient(0, fy, 0, fy + fh);
  gr.addColorStop(0, css(shade(steel, 1.25)));
  gr.addColorStop(0.12, css(shade(steel, 1.05)));
  gr.addColorStop(0.8, css(shade(steel, 0.85)));
  gr.addColorStop(0.88, css(shade(steel, 1.15)));
  gr.addColorStop(1, css(shade(steel, 0.5)));
  g.fillStyle = gr;
  g.fillRect(0, fy, W, fh);
  for (let x = 8; x < W; x += 16) { rivetDot(g, x, fy + 4, 1.6, steel); rivetDot(g, x, fy + fh - 4, 1.6, steel); }
  // brackets (knee braces) every 64 u
  const by = fy + fh;
  for (const bx of [48, 176]) {
    g.fillStyle = css(shade(steel, 0.8));
    g.beginPath();
    g.moveTo(bx - 3, by); g.lineTo(bx + 3, by); g.lineTo(bx + 3, by + 26); g.lineTo(bx - 22, by); g.closePath();
    g.fill();
    g.fillStyle = css(shade(steel, 1.2));
    g.fillRect(bx - 3, by, 2, 26);
    g.fillStyle = css(shade(steel, 0.45));
    g.fillRect(bx + 2, by, 1.5, 26);
  }
  // soffit shadow under the deck (soft, fades out)
  const sh = g.createLinearGradient(0, by, 0, by + 10);
  sh.addColorStop(0, 'rgba(6,5,4,0.45)');
  sh.addColorStop(1, 'rgba(6,5,4,0)');
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = sh;
  g.fillRect(0, by, W, 10);
  g.globalCompositeOperation = 'source-over';
  wear(c, seed, pal(0x7a4a2c), 0.1, { cells: 16, soft: 0.04, bias: (_x, y) => (y > 0.3 ? 0.06 : 0) });
  grainPass(c, seed + 9, 0.12, 0.3);
  outline(c, 1.5 * P * 0.8);
  return { albedo: c };
}

function rivetDot(g: G, x: number, y: number, r: number, base: number): void {
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.beginPath(); g.arc(x + 0.6, y + 0.7, r, 0, TAU); g.fill();
  g.fillStyle = css(shade(base, 1.5));
  g.beginPath(); g.arc(x - 0.2, y - 0.2, r * 0.85, 0, TAU); g.fill();
}

// =================================================================================================================================
// Walls: the Bell Square vault bay and the service corridor tile
// =================================================================================================================================

export function hubVault(def: WorldAssetDef, src: Sources): Baked {
  const [S, Hh] = def.px; // 512 x 512, 192 u
  const P = def.ppu;
  const seed = hashStr(def.id);
  const H = new Field(S, Hh);
  const A = albedoBuf(S, Hh);
  const concrete = pal(0x8a857a), green = pal(0x5d6b58), cream = pal(0x8d8670), line = pal(0x2a2420);
  const pil = 13 * P; // half pilaster width at each seam
  const archL = 36 * P, archR = S - 36 * P, archTop = 34 * P, rad = (archR - archL) / 2, archCy = archTop + rad;
  const dadoY = Hh * 0.64;
  const lum = src.wall ? wallLuma(src.wall, S, Hh) : null;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / Hh, i = y * S + x;
    // board-formed concrete: boards 8 u tall
    const board = Math.floor(y / (8 * P));
    const bt = vnoise(board * 3.1, 0.5, seed + board) * 0.1 - 0.05;
    const grainW = fbm(u, v, { seed: seed + 2, cx: 3, cy: 40, oct: 3 }) - 0.5;
    let h = 0.2 + grainW * 0.08 + bt;
    const bl = (y % (8 * P)) < 1.2 ? 1 : 0;
    h -= bl * 0.08;
    // pilasters at both seams
    const dx = Math.min(x, S - 1 - x);
    const inPil = dx < pil;
    if (inPil) h += 0.9 - smooth(pil - 3, pil, dx) * 0.4;
    // the arch recess
    const inArchX = x > archL && x < archR;
    const ry = y - archCy;
    const inArch = inArchX && (y >= archCy || Math.hypot(x - (archL + rad), ry) < rad);
    const dEdge = inArch ? Math.min(x - archL, archR - x, y >= archCy ? 1e9 : rad - Math.hypot(x - (archL + rad), ry)) : 0;
    if (inArch) h -= 0.9 - smooth(0, 7, dEdge) * 0.15;
    // form-tie holes on a grid
    const tx = ((x - S / 2) % (24 * P) + 24 * P) % (24 * P) - 12 * P, ty = (y % (16 * P)) - 8 * P;
    const tie = Math.hypot(tx, ty) < 1.6 ? 1 : 0;
    h -= tie * 0.3;
    // concrete albedo
    let col = mixHex(shade(concrete, 0.82), concrete, smooth(0.3, 0.7, fbm(u, v, { seed: seed + 3, cx: 6, oct: 4 })));
    col = shade(col, 1 + bt * 1.2);
    // paint: green dado, cream above, a dark line between
    const paintN = fbm(u, v, { seed: seed + 4, cx: 10, oct: 4 });
    const worn = smooth(0.68, 0.74, paintN + (1 - v) * -0.05 + (inPil ? 0.06 : 0) + (v > 0.92 ? 0.12 : 0));
    const paint = Math.abs(y - dadoY) < 2.2 ? line : y > dadoY ? green : cream;
    col = mixHex(paint, col, worn);
    if (worn > 0.5) h -= 0.08;
    if (inArch) col = shade(col, 0.72 - 0.18 * (1 - smooth(0, 30, dEdge)));
    setA(A, i, col);
    // grime up from the floor and water streaks from the top
    const grime = smooth(0.82, 1, v) * 0.35 + smooth(0.6, 0.9, fbm(u, v, { seed: seed + 6, cx: 18, cy: 2, oct: 3 })) * 0.18 * (1 - v);
    mulA(A, i, 1 - grime);
    if (tie) mulA(A, i, 0.45);
    H.d[i] = h;
  }
  const bytes = litField(A, H, { wrap: true, bump: 5, ambient: 0.56, diffuse: 0.55, aoR: 4, ao: 1.4, spec: 0.08, shiny: 12 });
  const c = mk(S, Hh);
  putBytes(c, bytes);
  const g = ctx(c);
  // the shadow each pilaster casts to its right (light from the upper left), and the arch soffit shade
  const shw = g.createLinearGradient(pil, 0, pil + 18 * P, 0);
  shw.addColorStop(0, 'rgba(8,6,5,0.38)');
  shw.addColorStop(1, 'rgba(8,6,5,0)');
  g.fillStyle = shw;
  g.fillRect(pil, 0, 18 * P, Hh);
  g.save();
  g.beginPath();
  g.moveTo(archL, Hh);
  g.lineTo(archL, archCy);
  g.arc(archL + rad, archCy, rad, Math.PI, 0);
  g.lineTo(archR, Hh);
  g.closePath();
  g.clip();
  const ins = g.createLinearGradient(archL, 0, archL + 26 * P, 0);
  ins.addColorStop(0, 'rgba(6,5,4,0.5)');
  ins.addColorStop(1, 'rgba(6,5,4,0)');
  g.fillStyle = ins;
  g.fillRect(archL, 0, 26 * P, Hh);
  const top = g.createRadialGradient(archL + rad, archCy, rad * 0.55, archL + rad, archCy, rad);
  top.addColorStop(0, 'rgba(6,5,4,0)');
  top.addColorStop(1, 'rgba(6,5,4,0.4)');
  g.fillStyle = top;
  g.fillRect(archL, archTop, rad * 2, rad);
  g.restore();
  // keystone
  const kx = archL + rad;
  g.fillStyle = css(shade(concrete, 1.08));
  g.beginPath(); g.moveTo(kx - 7 * P, archTop - 2 * P); g.lineTo(kx + 7 * P, archTop - 2 * P); g.lineTo(kx + 5 * P, archTop + 10 * P); g.lineTo(kx - 5 * P, archTop + 10 * P); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(kx + 4 * P, archTop - 1 * P, 1.5 * P, 11 * P);
  if (lum) { const d = ctx(c); d.save(); d.globalCompositeOperation = 'soft-light'; d.globalAlpha = 0.55; d.drawImage(lum, 0, 0); d.restore(); }
  grainPass(c, seed + 9);
  return { albedo: c };
}

/** The painted kit wall as a luminance detail layer (keeps its stains and texture, drops its colour). */
function wallLuma(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const c = mk(w, h);
  const g = ctx(c);
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  let mean = 0;
  for (let i = 0; i < d.data.length; i += 4) mean += d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11;
  mean /= d.data.length / 4;
  for (let i = 0; i < d.data.length; i += 4) {
    const L = (d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11) / mean;
    const v = Math.max(0, Math.min(255, 128 + (L - 1) * 150));
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  // make it tile sideways: cross-fade the half-shifted copy toward the edges
  const t = mk(w, h);
  const tg = ctx(t);
  tg.drawImage(c, w / 2, 0);
  tg.drawImage(c, -w / 2, 0);
  tg.globalCompositeOperation = 'destination-in';
  const gr = tg.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(0.2, 'rgba(0,0,0,0.6)');
  gr.addColorStop(0.5, 'rgba(0,0,0,0)');
  gr.addColorStop(0.8, 'rgba(0,0,0,0.6)');
  gr.addColorStop(1, 'rgba(0,0,0,1)');
  tg.fillStyle = gr;
  tg.fillRect(0, 0, w, h);
  g.drawImage(t, 0, 0);
  return c;
}

export function corridorTile(def: WorldAssetDef): Baked {
  const [W, Hh] = def.px; // 256 x 256 = 100 u
  const seed = hashStr(def.id);
  const H = new Field(W, Hh);
  const A = albedoBuf(W, Hh);
  const spec = new Field(W, Hh);
  const cream = pal(0xc4bc9a, 0.45, 0.1), green = pal(0x4f6b5e, 0.45, 0.08), capC = pal(0x2f4a3e), skirt = pal(0x2a2a26), grout = pal(0x5a5448);
  const dado = Math.round(Hh * 0.6), skirtY = Hh - 12;
  const tw = 32, th = 16;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / Hh, i = y * W + x;
    let col: number, h: number, s = 0;
    if (y >= skirtY) {
      col = shade(skirt, 1 - (y - skirtY) / 30);
      h = 0.4 - (y === skirtY ? 0.3 : 0);
    } else if (y >= dado && y < dado + 8) {
      // bullnose cap row
      const t = (y - dado) / 8;
      col = capC;
      h = 0.5 + Math.sin(t * Math.PI) * 0.5;
      s = 1;
    } else {
      const ty = y < dado ? y : y - dado - 8;
      const row = Math.floor(ty / th);
      const off = row % 2 ? tw / 2 : 0;
      const lx = ((x + off) % tw + tw) % tw, ly = ty % th;
      const tile = Math.floor((x + off) / tw) + row * 97;
      const edge = Math.min(lx, tw - 1 - lx, ly, th - 1 - ly);
      const isGrout = edge < 1;
      const base = y < dado ? cream : green;
      const tone = 1 + (vnoise(tile * 1.37, row * 2.1, seed) - 0.5) * 0.12;
      col = isGrout ? grout : shade(base, tone);
      h = isGrout ? 0 : 0.55 + smooth(0, 3, edge) * 0.45;
      s = isGrout ? 0 : 1;
      // a chipped tile: the glaze is gone
      if (!isGrout && vnoise(tile * 0.71, row * 1.9, seed + 5) > 0.86 && fbm(u, v, { seed: seed + 8, cx: 32, oct: 3 }) > 0.55) {
        col = pal(0x8a8478);
        h -= 0.3;
        s = 0;
      }
    }
    // grime from the floor up, water streaks from above
    const streak = smooth(0.62, 0.85, fbm(u, v, { seed: seed + 3, cx: 12, cy: 1, oct: 3 })) * (0.3 + 0.7 * smooth(0.0, 0.7, 1 - v)) * 0.32;
    const grime = smooth(0.55, 1, v) * 0.3 + smooth(0.5, 0.8, fbm(u, v, { seed: seed + 4, cx: 6, oct: 4 })) * 0.12;
    setA(A, i, col, 1 - streak - grime);
    lerpA(A, i, pal(0x6a5a3a), streak * 0.4);
    H.d[i] = h;
    spec.d[i] = s * (1 - grime * 1.5);
  }
  const bytes = litField(A, H, { wrap: true, bump: 3, ambient: 0.6, diffuse: 0.5, aoR: 2, ao: 1.2, spec: 0.55, shiny: 40, specMask: spec });
  const c = mk(W, Hh);
  putBytes(c, bytes);
  grainPass(c, seed + 9);
  return { albedo: c };
}

export { glow };

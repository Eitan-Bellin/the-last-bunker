import { CanvasSource, Container, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import { isLiteMode } from '../core/crashGuard';
import { hashString, rgba, seeded, shade } from './draw';
import { gfxLevel } from './gfxFeatures';
import { VIEW } from './perfFx';

/**
 * [plan4:ST-10] Rock strata: the earth under the bunker as five bands of geology, measured in world units from the ground (not floor
 * indices, so the service galleries cannot shift them):
 *
 *   0    0 - 290   soil and clay      warm red-brown, fine grain; roots, stones
 *   1  290 - 1030  gravel, sandstone  beige-grey, thin horizontal beds; the water table (700-820, blue, seepage); fossil bones
 *   2 1030 - 1850  granite            cold grey blocks, diagonal cracks; old concrete foundations, a rusted rail section
 *   3 1850 - 2600  basalt and ore     dark and bluish; copper-green veins, gold flecks, crystals
 *   4 2600 -       bedrock            near black, faint red geothermal glow in the cracks
 *
 * How it is made (all procedural, Canvas 2D, nothing saved):
 *  - one 512x512 tile per band (256 at Low), painted from the existing rock painting (darkened and re-tinted when it is
 *    loaded) plus grain, pebbles, blocks and cracks, then blended so it repeats without a seam; each band is ONE tiling sprite,
 *  - 60 px transitions: a vertical alpha ramp of the upper band's own pattern laid over the top of the next band,
 *  - sparse feature sprites (roots, bones, seepage, foundations, rail, ore veins, crystals, glow) from ONE 1024x1024 atlas, at most 24
 *    pieces, placed from hash(band, floor(x / 512)): the same picture every time, no state,
 *  - only what the camera can see exists: tiles are painted one per timer tick (cached across rebuilds), feature sprites of a band are
 *    created the first time the band is on screen, and a band off screen is switched off (see `onRender` below).
 * Cost: at most 5 tiling sprites + 4 transitions + 1 atlas batch = 10 draw calls with every band in view at the very worst (measured: 0, the
 * sprite batcher merges them with their neighbours), no per-frame allocation, ~5.2 MB of tiles (1.3 MB at Low) + 2 MB atlas (1024x512, Medium and High only).
 */

/** World y where each band begins (band 4 runs to the bottom of the world). */
export const BAND_TOP = [0, 290, 1030, 1850, 2600] as const;
/** Height of the transition between two bands. */
export const BLEND_H = 60;
/** Water table inside band 1 (world y). */
export const WATER_TOP = 700;
export const WATER_BOTTOM = 820;
const COLUMN = 512;
/** World width of one tile repeat per band: wide enough that the repeat is hard to spot, narrow enough to keep the grain sharp. */
const TILE_W = [620, 720, 760, 720, 700] as const;

export interface StrataOpts {
  /** The painted rock backdrop (base layer of every band when loaded). */
  rock?: Texture | null;
  /** Feature sprites (veins, foundations, bones, roots); off at Low. Default: on unless the quality level is Low. */
  features?: boolean;
  /** Small tiles (256) for Low quality / lite mode. Default: follows the quality level. */
  small?: boolean;
}

type G = CanvasRenderingContext2D;
const mk = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Tile painting
// ---------------------------------------------------------------------------------------------------------------------------------

let noiseCv: HTMLCanvasElement | null = null;
/** 128x128 value noise (two octaves), made once and used as a repeating pattern for grain and mottling. */
function noiseCanvas(): HTMLCanvasElement {
  if (noiseCv) return noiseCv;
  const n = 128;
  const c = mk(n, n);
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  const rnd = seeded(31337);
  const coarse = new Float32Array(16 * 16);
  for (let i = 0; i < coarse.length; i++) coarse[i] = rnd();
  const at = (x: number, y: number) => {
    const fx = (x / n) * 16, fy = (y / n) * 16;
    const x0 = Math.floor(fx) & 15, y0 = Math.floor(fy) & 15, x1 = (x0 + 1) & 15, y1 = (y0 + 1) & 15;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = coarse[y0 * 16 + x0] * (1 - sx) + coarse[y0 * 16 + x1] * sx, b = coarse[y1 * 16 + x0] * (1 - sx) + coarse[y1 * 16 + x1] * sx;
    return a * (1 - sy) + b * sy;
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = Math.round(255 * (0.45 * at(x, y) + 0.55 * rnd()));
      const o = (y * n + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  noiseCv = c;
  return c;
}

/** Grain: the noise pattern laid over the whole tile with a blend mode. */
function grain(g: G, S: number, scale: number, mode: GlobalCompositeOperation, alpha: number, ox = 0, oy = 0): void {
  const pat = g.createPattern(noiseCanvas(), 'repeat');
  if (!pat) return;
  g.save();
  g.globalCompositeOperation = mode;
  g.globalAlpha = alpha;
  g.translate(ox, oy);
  g.scale(scale, scale);
  g.fillStyle = pat;
  g.fillRect(-ox / scale, -oy / scale, S / scale + 2, S / scale + 2);
  g.restore();
}

/** Calls `fn` once per copy of a shape of radius r at (x, y) that must wrap around the tile edges. */
function wrap(S: number, x: number, y: number, r: number, fn: (dx: number, dy: number) => void): void {
  if (!S) { fn(0, 0); return; } // a piece on the atlas does not repeat
  const xs = x - r < 0 ? [0, S] : x + r > S ? [0, -S] : [0];
  const ys = y - r < 0 ? [0, S] : y + r > S ? [0, -S] : [0];
  for (const dx of xs) for (const dy of ys) fn(dx, dy);
}

function blot(g: G, S: number, x: number, y: number, rx: number, ry: number, color: number, a: number): void {
  wrap(S, x, y, Math.max(rx, ry), (dx, dy) => {
    const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, Math.max(rx, ry));
    gr.addColorStop(0, rgba(color, a));
    gr.addColorStop(1, rgba(color, 0));
    g.save();
    g.translate(x + dx, y + dy);
    g.scale(1, ry / rx);
    g.translate(-(x + dx), -(y + dy));
    g.fillStyle = gr;
    g.fillRect(x + dx - rx, y + dy - rx, rx * 2, rx * 2);
    g.restore();
  });
}

/** A lit, rounded stone: contact shadow, body shaded from the upper left, a rim light. */
function stone(g: G, x: number, y: number, rx: number, ry: number, col: number, rot = 0): void {
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.beginPath();
  g.ellipse(x + rx * 0.12, y + ry * 0.3, rx * 1.02, ry * 1.0, rot, 0, Math.PI * 2);
  g.fill();
  const gr = g.createRadialGradient(x - rx * 0.4, y - ry * 0.5, Math.min(rx, ry) * 0.1, x, y, Math.max(rx, ry) * 1.1);
  gr.addColorStop(0, rgba(shade(col, 1.4), 1));
  gr.addColorStop(0.6, rgba(col, 1));
  gr.addColorStop(1, rgba(shade(col, 0.5), 1));
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  g.fill();
}

/** Wandering line from (x0, y0) to (x1, y1) with sideways jitter, as a flat point list. */
function jag(x0: number, y0: number, x1: number, y1: number, rnd: () => number, amp: number, steps: number, smooth = 0): number[] {
  const pts = [x0, y0];
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  const off: number[] = [];
  for (let i = 1; i < steps; i++) off.push((rnd() - 0.5) * 2 * amp);
  for (let k = 0; k < smooth; k++) for (let i = 1; i < off.length - 1; i++) off[i] = (off[i - 1] + off[i] * 2 + off[i + 1]) / 4;
  for (let i = 1; i < steps; i++) {
    const t = i / steps, o = off[i - 1];
    pts.push(x0 + dx * t + nx * o, y0 + dy * t + ny * o);
  }
  pts.push(x1, y1);
  return pts;
}

function line(g: G, pts: number[], w: number, col: string): void {
  g.strokeStyle = col;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
}

/** A ribbon along a point list whose width follows `wf(t)` (0..1 along the line); filled with `fill`. Organic widths instead of a uniform stroke. */
function ribbon(g: G, pts: number[], wf: (t: number) => number, fill: string | CanvasGradient, dx = 0, dy = 0): void {
  const n = pts.length / 2;
  if (n < 2) return;
  const L: number[] = [], R: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const tx = pts[b * 2] - pts[a * 2], ty = pts[b * 2 + 1] - pts[a * 2 + 1], len = Math.hypot(tx, ty) || 1;
    const w = wf(i / (n - 1)) / 2, nx = -ty / len * w, ny = tx / len * w;
    L.push(pts[i * 2] + nx + dx, pts[i * 2 + 1] + ny + dy);
    R.push(pts[i * 2] - nx + dx, pts[i * 2 + 1] - ny + dy);
  }
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(L[0], L[1]);
  for (let i = 2; i < L.length; i += 2) g.lineTo(L[i], L[i + 1]);
  for (let i = R.length - 2; i >= 0; i -= 2) g.lineTo(R[i], R[i + 1]);
  g.closePath();
  g.fill();
}

/** A crack: tapering dark core with a faint lit lip on its lower side, so it reads as a cut into the rock, not a drawn line. */
function crack(g: G, pts: number[], w: number, core = 'rgba(8,8,10,0.85)', lip = 'rgba(190,180,160,0.22)'): void {
  const prof = (t: number) => w * (0.25 + 0.95 * Math.pow(Math.sin(Math.PI * Math.min(0.999, Math.max(0.001, t))), 0.7)) * (0.8 + 0.4 * Math.sin(t * 37));
  ribbon(g, pts, t => prof(t) * 2.6, 'rgba(0,0,0,0.10)');
  ribbon(g, pts, prof, lip, w * 0.45, w * 0.7);
  ribbon(g, pts, prof, core);
}

/**
 * Makes a tile repeat without a seam: the half-shifted copy is faded in toward the edges, so both edges show the same picture.
 * (Ghosting of the soft rock grain is invisible; a sharp feature must not sit on the centre line.)
 */
function seamless(c: HTMLCanvasElement, S: number, vertical: boolean): void {
  const t = mk(S, S);
  const tg = t.getContext('2d')!;
  const h = S / 2;
  if (vertical) { tg.drawImage(c, 0, h); tg.drawImage(c, 0, -h); } else { tg.drawImage(c, h, 0); tg.drawImage(c, -h, 0); }
  tg.globalCompositeOperation = 'destination-in';
  const gr = vertical ? tg.createLinearGradient(0, 0, 0, S) : tg.createLinearGradient(0, 0, S, 0);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(0.18, 'rgba(0,0,0,0.75)');
  gr.addColorStop(0.5, 'rgba(0,0,0,0)');
  gr.addColorStop(0.82, 'rgba(0,0,0,0.75)');
  gr.addColorStop(1, 'rgba(0,0,0,1)');
  tg.fillStyle = gr;
  tg.fillRect(0, 0, S, S);
  c.getContext('2d')!.drawImage(t, 0, 0);
}

/** The slice of the rock painting (fractions of its height) each band starts from, and the colour grade laid over it. */
const SLICE: [number, number][] = [[0.0, 0.33], [0.43, 0.73], [0.76, 1], [0.8, 1], [0.84, 1]];
const BASE = [0x4d3322, 0x6c6252, 0x4a4c52, 0x2c3238, 0x1a1618] as const;

type RockSrc = { img: CanvasImageSource; w: number; h: number } | null;

function rockSource(rock: Texture | null | undefined): RockSrc {
  if (!rock || rock.destroyed || !rock.source) return null;
  const r = rock.source.resource as { width?: number; height?: number; close?: () => void } | null;
  if (!r || !r.width || !r.height) return null;
  return { img: r as unknown as CanvasImageSource, w: r.width, h: r.height };
}

/** Paints band i's tile: base colour, the painting (graded), grain, then the band's own stones, beds, blocks and cracks. */
export function paintTile(i: number, rock: Texture | null | undefined, S = 512): HTMLCanvasElement {
  const c = mk(S, S);
  const g = c.getContext('2d')!;
  const k = S / 512;
  const rnd = seeded(9001 + i * 7919);
  g.fillStyle = rgba(BASE[i], 1);
  g.fillRect(0, 0, S, S);
  const src = rockSource(rock);
  if (src) {
    try {
      const [a, b] = SLICE[i];
      g.save();
      if (i === 3) { g.translate(0, S); g.scale(1, -1); } // basalt: the granite slice upside down, so its blocks differ
      if (i === 4) { g.translate(S, 0); g.scale(-1, 1); }
      g.drawImage(src.img, 0, src.h * a, src.w, src.h * (b - a), 0, 0, S, S);
      g.restore();
    } catch {
      // the bitmap was already released: the procedural base stands
    }
  }
  // Grade: warm and low saturation near the top, cold and dark deep down (style rule 3: one lamp-lit palette, never above 0.6 saturation).
  const grade = (mode: GlobalCompositeOperation, col: number, a: number) => { g.globalCompositeOperation = mode; g.fillStyle = rgba(col, a); g.fillRect(0, 0, S, S); g.globalCompositeOperation = 'source-over'; };
  if (i === 0) { grade('multiply', 0xe0b090, 0.55); grade('soft-light', 0x8a4a28, 0.35); }
  if (i === 1) { grade('multiply', 0xd8d0c0, 0.5); grade('color', 0x9a8466, 0.18); }
  if (i === 2) { grade('color', 0x808490, 0.4); grade('screen', 0x16181c, 1); grade('multiply', 0xc8ccd4, 0.5); }
  if (i === 3) { grade('color', 0x505862, 0.62); grade('multiply', 0x929aa4, 0.7); }
  if (i === 4) { grade('color', 0x2a2024, 0.8); grade('multiply', 0x5a5258, 0.8); }
  if (!src) {
    // No painting (not loaded yet, or the file is missing): the base carries a large mottle of its own.
    for (let n = 0; n < 40; n++) blot(g, S, rnd() * S, rnd() * S, (30 + rnd() * 70) * k, (14 + rnd() * 30) * k, rnd() < 0.5 ? shade(BASE[i], 1.5) : shade(BASE[i], 0.6), 0.28);
  }
  grain(g, S, 1.5 * k, 'overlay', 0.4);
  grain(g, S, 4 * k, 'soft-light', 0.5, 17, 9);

  if (i === 0) {
    // Soil and clay: wavy laminae, a scatter of small stones, darker clods.
    for (let n = 0; n < 7; n++) {
      const y = ((n + 0.5) / 7) * S + (rnd() - 0.5) * 30 * k;
      const pts = jag(-10, y, S + 10, y + (rnd() - 0.5) * 16 * k, rnd, 8 * k, 12);
      line(g, pts, (2 + rnd() * 3) * k, rgba(0x1c0f08, 0.22));
      line(g, pts.map((v, j) => (j % 2 ? v + 3 * k : v)), 1.4 * k, rgba(0xc89a6a, 0.12));
    }
    for (let n = 0; n < 46; n++) {
      const x = rnd() * S, y = rnd() * S, r = (3 + rnd() * 7) * k;
      wrap(S, x, y, r * 1.3, (dx, dy) => stone(g, x + dx, y + dy, r, r * 0.7, shade(0x6a4e3c, 0.55 + rnd() * 0.55), (rnd() - 0.5) * 0.6));
    }
    for (let n = 0; n < 24; n++) blot(g, S, rnd() * S, rnd() * S, (14 + rnd() * 26) * k, (8 + rnd() * 12) * k, 0x1c1008, 0.3);
  } else if (i === 1) {
    // Gravel in the upper part, fine sandstone beds in the lower part.
    for (let n = 0; n < 150; n++) {
      const x = rnd() * S, y = rnd() * S * 0.55 + S * 0.02, r = (4 + rnd() * 11) * k;
      const tone = 0.7 + rnd() * 0.6;
      wrap(S, x, y, r * 1.3, (dx, dy) => stone(g, x + dx, y + dy, r, r * (0.6 + rnd() * 0.25), shade(rnd() < 0.7 ? 0x84827a : 0x9a8a6a, tone), (rnd() - 0.5) * 0.5));
    }
    for (let n = 0; n < 16; n++) {
      const y = S * (0.5 + rnd() * 0.5);
      const pts = jag(-10, y, S + 10, y + (rnd() - 0.5) * 20 * k, rnd, 5 * k, 14);
      line(g, pts, (1 + rnd() * 2.4) * k, rgba(rnd() < 0.5 ? 0x4a3820 : 0xd8c090, 0.2));
    }
  } else if (i === 2) {
    // Granite: big blocks with dark joints, mica speckle, a few diagonal cracks.
    for (let n = 0; n < 16; n++) blot(g, S, rnd() * S, rnd() * S, (50 + rnd() * 70) * k, (30 + rnd() * 50) * k, rnd() < 0.5 ? 0xb4b8c0 : 0x2a2c32, 0.22);
    for (let n = 0; n < 7; n++) {
      const x = rnd() * S, y = rnd() * S, a = (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.5);
      const len = (110 + rnd() * 150) * k;
      crack(g, jag(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, rnd, 9 * k, 9), (1.6 + rnd() * 1.6) * k);
    }
    for (let n = 0; n < 5; n++) {
      const y = rnd() * S, x = rnd() * S;
      crack(g, jag(x, y, x + (60 + rnd() * 120) * k, y + (rnd() - 0.5) * 20 * k, rnd, 4 * k, 6), 1.6 * k);
    }
    for (let n = 0; n < 420; n++) { g.fillStyle = rnd() < 0.55 ? rgba(0xe4e4e8, 0.28) : rgba(0x101014, 0.4); g.fillRect(rnd() * S, rnd() * S, (1 + rnd() * 1.4) * k, (1 + rnd()) * k); }
  } else if (i === 3) {
    // Basalt: columnar joints, blue sheen, a few pale mineral dots.
    for (let n = 0; n < 16; n++) {
      const x = (n / 16) * S + rnd() * 20 * k;
      crack(g, jag(x, -4, x + (rnd() - 0.5) * 50 * k, S + 4, rnd, 8 * k, 12), (1.2 + rnd() * 1.5) * k, 'rgba(4,6,10,0.8)', 'rgba(150,170,200,0.16)');
    }
    for (let n = 0; n < 4; n++) { const y = rnd() * S; crack(g, jag(0, y, S, y + (rnd() - 0.5) * 30 * k, rnd, 6 * k, 14), 1 * k, 'rgba(4,6,10,0.4)'); }
    for (let n = 0; n < 18; n++) blot(g, S, rnd() * S, rnd() * S, (40 + rnd() * 60) * k, (26 + rnd() * 40) * k, rnd() < 0.5 ? 0x5a7a9a : 0x06080c, 0.2);
    for (let n = 0; n < 260; n++) { g.fillStyle = rnd() < 0.5 ? rgba(0x9ab0c8, 0.3) : rgba(0x040608, 0.45); g.fillRect(rnd() * S, rnd() * S, (1 + rnd()) * k, (1 + rnd()) * k); }
  } else {
    // Bedrock: near black, deep jagged cracks that glow red from within.
    for (let n = 0; n < 14; n++) blot(g, S, rnd() * S, rnd() * S, (50 + rnd() * 80) * k, (30 + rnd() * 50) * k, rnd() < 0.5 ? 0x3a3034 : 0x020202, 0.3);
    for (let n = 0; n < 6; n++) {
      const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, len = (120 + rnd() * 160) * k;
      const pts = jag(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, rnd, 12 * k, 10);
      line(g, pts, 11 * k, rgba(0xa02810, 0.07));
      line(g, pts, 5 * k, rgba(0xd04818, 0.14));
      line(g, pts, 1.8 * k, rgba(0xff8a3a, 0.55));
      line(g, pts, 0.7 * k, rgba(0xffd090, 0.5));
    }
    for (let n = 0; n < 6; n++) blot(g, S, rnd() * S, rnd() * S, (40 + rnd() * 50) * k, (22 + rnd() * 22) * k, 0x8a2a10, 0.16);
    for (let n = 0; n < 200; n++) { g.fillStyle = rgba(0x000000, 0.4); g.fillRect(rnd() * S, rnd() * S, (1 + rnd()) * k, (1 + rnd()) * k); }
  }

  seamless(c, S, false);
  seamless(c, S, true);

  if (i === 1) {
    // The water table (world y 700-820): wet rock, cold blue, darker beds; baked into the tile, which is exactly one repeat tall.
    const y0 = ((WATER_TOP - BAND_TOP[1]) / (BAND_TOP[2] - BAND_TOP[1])) * S, y1 = ((WATER_BOTTOM - BAND_TOP[1]) / (BAND_TOP[2] - BAND_TOP[1])) * S;
    const wet = g.createLinearGradient(0, y0 - 14 * k, 0, y1 + 14 * k);
    wet.addColorStop(0, 'rgba(70,120,160,0)');
    wet.addColorStop(0.25, 'rgba(80,150,220,0.7)');
    wet.addColorStop(0.75, 'rgba(70,140,210,0.7)');
    wet.addColorStop(1, 'rgba(60,110,150,0)');
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = wet;
    g.fillRect(0, y0 - 14 * k, S, y1 - y0 + 28 * k);
    g.globalCompositeOperation = 'source-over';
    const wr = seeded(4141);
    for (let n = 0; n < 10; n++) {
      const y = y0 + (y1 - y0) * wr();
      const pts = jag(-10, y, S + 10, y + (wr() - 0.5) * 8, wr, 3 * k, 14);
      line(g, pts, (1.2 + wr() * 2) * k, rgba(0x0a1822, 0.3));
      line(g, pts.map((v, j) => (j % 2 ? v + 2 * k : v)), 1 * k, rgba(0x9ac8e0, 0.2));
    }
    for (let n = 0; n < 90; n++) { g.fillStyle = rgba(0xbcdcf0, 0.25 + wr() * 0.3); g.fillRect(wr() * S, y0 + (y1 - y0) * wr(), (1 + wr() * 1.4) * k, (1 + wr()) * k); }
  }
  return c;
}

/** The transition piece: the first BLEND_H world units of the pattern that follows band i, fading out downward. */
function paintFade(tile: HTMLCanvasElement, S: number, texH: number): HTMLCanvasElement {
  const c = mk(S, Math.max(4, Math.ceil(texH)));
  const g = c.getContext('2d')!;
  g.drawImage(tile, 0, 0, S, c.height, 0, 0, S, c.height);
  g.globalCompositeOperation = 'destination-in';
  const gr = g.createLinearGradient(0, 0, 0, c.height);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(0.35, 'rgba(0,0,0,0.8)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, c.height);
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Feature atlas (one 1024x1024 texture, 24 pieces)
// ---------------------------------------------------------------------------------------------------------------------------------

type PieceId =
  | 'rootA' | 'rootB' | 'rootC' | 'stonesA' | 'stonesB' | 'ribs' | 'femur' | 'skull' | 'seepA' | 'seepB' | 'seepC' | 'faultA' | 'faultB'
  | 'slab' | 'beam' | 'column' | 'rail' | 'copperA' | 'copperB' | 'gold' | 'crystalA' | 'crystalB' | 'crystalC' | 'glow';

interface Piece { id: PieceId; w: number; h: number; paint: (g: G, w: number, h: number, rnd: () => number) => void }

function root(g: G, w: number, h: number, rnd: () => number): void {
  const branch = (x: number, y: number, w0: number, depth: number, dir: number) => {
    let cx = x, cy = y, dx = dir;
    const n = 5 + Math.floor(rnd() * 4);
    for (let s = 0; s < n; s++) {
      dx = dx * 0.55 + (rnd() - 0.5) * 2.6;
      const nx = cx + dx * 5, ny = cy + 8 + rnd() * 12;
      const wk = Math.max(0.5, w0 * (1 - s / (n + 1)));
      g.strokeStyle = 'rgba(14,8,4,0.75)';
      g.lineWidth = wk + 1.6;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny); g.stroke();
      g.strokeStyle = rgba(0x3a2616, 1);
      g.lineWidth = wk;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny); g.stroke();
      g.strokeStyle = rgba(0xa07a52, 0.3);
      g.lineWidth = Math.max(0.4, wk * 0.3);
      g.beginPath(); g.moveTo(cx - wk * 0.25, cy); g.lineTo(nx - wk * 0.25, ny); g.stroke();
      if (depth < 2 && rnd() < 0.45 && cy < h - 40) branch(nx, ny, wk * 0.6, depth + 1, rnd() < 0.5 ? -1.5 : 1.5);
      cx = nx; cy = ny;
      if (cy > h - 6 || nx < 3 || nx > w - 3) break;
    }
  };
  branch(w / 2, 0, 4.2, 0, 0);
  branch(w / 2 - 6, 0, 3, 0, -1.2);
  branch(w / 2 + 6, 0, 3, 0, 1.2);
}

function stones(g: G, w: number, h: number, rnd: () => number): void {
  for (let n = 0; n < 4; n++) {
    const r = 12 + rnd() * 14;
    stone(g, 18 + rnd() * (w - 36), h * 0.45 + rnd() * h * 0.25, r, r * 0.66, shade(0x7a6a58, 0.6 + rnd() * 0.7), (rnd() - 0.5) * 0.5);
  }
}

function bone(g: G, x: number, y: number, len: number, th: number, rot: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(-len / 2 + 1, -th / 2 + 2, len, th);
  const gr = g.createLinearGradient(0, -th, 0, th);
  gr.addColorStop(0, rgba(0xb8aa88, 0.8));
  gr.addColorStop(1, rgba(0x6a5c42, 0.8));
  g.fillStyle = gr;
  g.beginPath();
  g.roundRect(-len / 2, -th / 2, len, th, th / 2);
  g.fill();
  for (const sx of [-1, 1]) { g.beginPath(); g.arc(sx * len / 2, -th * 0.35, th * 0.7, 0, Math.PI * 2); g.arc(sx * len / 2, th * 0.35, th * 0.7, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

const PIECES: Piece[] = [
  { id: 'rootA', w: 150, h: 230, paint: root },
  { id: 'rootB', w: 150, h: 230, paint: root },
  { id: 'rootC', w: 150, h: 230, paint: root },
  { id: 'stonesA', w: 120, h: 72, paint: stones },
  { id: 'stonesB', w: 120, h: 72, paint: stones },
  {
    id: 'ribs', w: 200, h: 110, paint: (g, w, h) => {
      // A fossil ribcage pressed into the sandstone: spine and curved ribs, a darker sunken bed around them.
      blot(g, 0, w / 2, h / 2, w * 0.55, h * 0.5, 0x1c140a, 0.35);
      g.strokeStyle = rgba(0xa89a78, 0.75); g.lineCap = 'round';
      g.lineWidth = 6; g.beginPath(); g.moveTo(14, h * 0.28); g.quadraticCurveTo(w / 2, h * 0.1, w - 14, h * 0.3); g.stroke();
      for (let n = 0; n < 7; n++) {
        const x = 26 + n * ((w - 52) / 6);
        g.lineWidth = 4.5 - n * 0.2; g.strokeStyle = rgba(shade(0xa89a78, 1 - n * 0.03), 0.78);
        g.beginPath(); g.moveTo(x, h * 0.26); g.quadraticCurveTo(x + 6, h * 0.95, x - 14 + n * 3, h * 0.92); g.stroke();
        g.lineWidth = 1.4; g.strokeStyle = 'rgba(40,28,14,0.5)';
        g.beginPath(); g.moveTo(x + 2, h * 0.3); g.quadraticCurveTo(x + 8, h * 0.95, x - 12 + n * 3, h * 0.94); g.stroke();
      }
    },
  },
  {
    id: 'femur', w: 150, h: 50, paint: (g, w, h) => { blot(g, 0, w / 2, h / 2, w * 0.55, h * 0.55, 0x1c140a, 0.35); bone(g, w / 2, h / 2, w - 36, 9, -0.12); bone(g, w * 0.7, h * 0.7, 48, 6, 0.5); },
  },
  {
    id: 'skull', w: 110, h: 80, paint: (g, w, h) => {
      blot(g, 0, w / 2, h / 2, w * 0.55, h * 0.55, 0x1c140a, 0.35);
      const gr = g.createRadialGradient(w * 0.4, h * 0.35, 4, w * 0.5, h * 0.5, w * 0.45);
      gr.addColorStop(0, rgba(0xb8aa88, 0.85)); gr.addColorStop(1, rgba(0x6a5a40, 0.85));
      g.fillStyle = gr; g.beginPath(); g.ellipse(w * 0.5, h * 0.42, w * 0.36, h * 0.34, 0, 0, Math.PI * 2); g.fill();
      g.fillRect(w * 0.34, h * 0.62, w * 0.34, h * 0.2);
      g.fillStyle = 'rgba(20,12,6,0.85)';
      g.beginPath(); g.ellipse(w * 0.38, h * 0.44, 8, 9, 0, 0, Math.PI * 2); g.ellipse(w * 0.62, h * 0.44, 8, 9, 0, 0, Math.PI * 2); g.fill();
      for (let n = 0; n < 6; n++) g.fillRect(w * 0.37 + n * 6, h * 0.72, 3, 9);
    },
  },
  {
    id: 'seepA', w: 56, h: 210, paint: (g, w, h, rnd) => seep(g, w, h, rnd),
  },
  { id: 'seepB', w: 56, h: 210, paint: (g, w, h, rnd) => seep(g, w, h, rnd) },
  { id: 'seepC', w: 72, h: 150, paint: (g, w, h, rnd) => seep(g, w, h, rnd) },
  { id: 'faultA', w: 240, h: 240, paint: (g, w, h, rnd) => faultCrack(g, w, h, rnd) },
  { id: 'faultB', w: 240, h: 240, paint: (g, w, h, rnd) => faultCrack(g, w, h, rnd) },
  {
    id: 'slab', w: 240, h: 150, paint: (g, w, h, rnd) => {
      // Old foundation block, broken off at the top, rebar stubs, rust weeping down, hairline cracks.
      const top = [8, 44, 16, 26, 30, 12, 62, 30, 100, 8, 140, 24, 180, 6, 210, 22, 228, 40];
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.beginPath(); g.moveTo(14, h); for (let i = 0; i < top.length; i += 2) g.lineTo(top[i] + 5, top[i + 1] + 8); g.lineTo(w - 4, h); g.fill();
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, rgba(0x8a8884, 1)); gr.addColorStop(1, rgba(0x4e4c4a, 1));
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(6, h - 4); g.lineTo(0, 90); g.lineTo(top[0], top[1]); for (let i = 2; i < top.length; i += 2) g.lineTo(top[i], top[i + 1]); g.lineTo(w, 96); g.lineTo(w - 8, h - 4); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(220,214,200,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(top[0], top[1] + 1); for (let i = 2; i < top.length; i += 2) g.lineTo(top[i], top[i + 1] + 1); g.stroke();
      for (let n = 0; n < 5; n++) { const x = 20 + rnd() * (w - 40); const y0 = 6 + rnd() * 14; g.strokeStyle = rgba(0x7a3a1a, 0.95); g.lineWidth = 2.4; g.beginPath(); g.moveTo(x, y0 + 14); g.lineTo(x + (rnd() - 0.5) * 10, y0 - 8); g.stroke(); }
      for (let n = 0; n < 7; n++) { const x = 10 + rnd() * (w - 20); g.fillStyle = rgba(0x7a3a1a, 0.3); g.fillRect(x, 20 + rnd() * 20, 2 + rnd() * 3, 20 + rnd() * 70); }
      for (let n = 0; n < 4; n++) crack(g, jag(10 + rnd() * (w - 20), 30, 10 + rnd() * (w - 20), h - 8, rnd, 8, 7), 1.5);
      grain(g, 240, 1, 'source-atop', 0.14);
      g.globalCompositeOperation = 'destination-in';
      const m = g.createLinearGradient(0, h - 22, 0, h); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0.0)');
      g.fillStyle = m; g.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'beam', w: 200, h: 70, paint: (g, w, h, rnd) => {
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(8, 24, w - 24, 30);
      const gr = g.createLinearGradient(0, 14, 0, 52); gr.addColorStop(0, rgba(0x8e8c88, 1)); gr.addColorStop(1, rgba(0x56544f, 1));
      g.fillStyle = gr; g.beginPath(); g.moveTo(10, 16); g.lineTo(w - 38, 14); g.lineTo(w - 26, 26); g.lineTo(w - 44, 36); g.lineTo(w - 30, 50); g.lineTo(10, 52); g.closePath(); g.fill();
      g.fillStyle = rgba(0xe6dccc, 0.3); g.fillRect(10, 16, w - 50, 2);
      for (let n = 0; n < 3; n++) { g.strokeStyle = rgba(0x7a3a1a, 1); g.lineWidth = 2.4; g.beginPath(); g.moveTo(w - 34, 22 + n * 12); g.lineTo(w - 6 - rnd() * 8, 20 + n * 12 + (rnd() - 0.5) * 10); g.stroke(); }
      for (let n = 0; n < 5; n++) { g.fillStyle = rgba(0x7a3a1a, 0.3); g.fillRect(14 + rnd() * (w - 70), 30, 2 + rnd() * 3, 10 + rnd() * 20); }
      g.fillStyle = rgba(0x20180e, 0.28); for (let n = 0; n < 5; n++) g.fillRect(24 + n * 32, 14, 2, 38);
    },
  },
  {
    id: 'column', w: 90, h: 160, paint: (g, w, h, rnd) => {
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(16, 22, 62, h - 24);
      const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, rgba(0x9a9894, 1)); gr.addColorStop(0.6, rgba(0x6a6864, 1)); gr.addColorStop(1, rgba(0x3e3c3a, 1));
      g.fillStyle = gr; g.beginPath(); g.moveTo(12, h); g.lineTo(12, 26); g.lineTo(22, 16); g.lineTo(34, 24); g.lineTo(46, 10); g.lineTo(60, 22); g.lineTo(74, 16); g.lineTo(74, h); g.closePath(); g.fill();
      for (const x of [22, 36, 52, 66]) { g.strokeStyle = rgba(0x7a3a1a, 1); g.lineWidth = 2.2; g.beginPath(); g.moveTo(x, 18); g.lineTo(x + (rnd() - 0.5) * 8, 0); g.stroke(); }
      g.fillStyle = 'rgba(30,26,20,0.3)'; for (let y = 40; y < h; y += 26) g.fillRect(12, y, 62, 2);
      for (let n = 0; n < 4; n++) { g.fillStyle = rgba(0x7a3a1a, 0.3); g.fillRect(16 + rnd() * 50, 30, 2 + rnd() * 3, 30 + rnd() * 80); }
      g.fillStyle = rgba(0x4a5a30, 0.3); g.beginPath(); g.ellipse(30, h - 10, 22, 10, 0, 0, Math.PI * 2); g.fill();
      grain(g, 160, 1, 'source-atop', 0.14);
      g.globalCompositeOperation = 'destination-in';
      const m = g.createLinearGradient(0, h - 26, 0, h); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = m; g.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'rail', w: 320, h: 56, paint: (g, w, h, rnd) => {
      // A rusted rail section laid on sleepers over a ballast bed, snapped off at one end.
      blot(g, 0, w / 2, h - 8, w * 0.52, 14, 0x1a1410, 0.5);
      for (let x = 12; x < w - 20; x += 26) {
        const gr = g.createLinearGradient(0, 30, 0, 46); gr.addColorStop(0, rgba(0x4a3622, 1)); gr.addColorStop(1, rgba(0x20160c, 1));
        g.fillStyle = gr; g.fillRect(x, 30, 14, 15);
        g.fillStyle = rgba(0xa08060, 0.25); g.fillRect(x, 30, 14, 1.4);
      }
      for (let n = 0; n < 70; n++) stone(g, 8 + rnd() * (w - 16), 42 + rnd() * 8, 2 + rnd() * 3, 1.6 + rnd() * 1.5, shade(0x6a645a, 0.6 + rnd() * 0.8));
      const rail = (y: number, hh: number, x1: number) => {
        const gr = g.createLinearGradient(0, y, 0, y + hh); gr.addColorStop(0, rgba(0xa05a30, 1)); gr.addColorStop(0.5, rgba(0x6a3418, 1)); gr.addColorStop(1, rgba(0x3a1c0c, 1));
        g.fillStyle = gr; g.fillRect(2, y, x1, hh);
      };
      rail(22, 8, w - 70); rail(29, 3, w - 70); rail(30, 5, w - 82);
      g.fillStyle = rgba(0xd8a070, 0.4); g.fillRect(2, 22, w - 70, 1.3);
      g.fillStyle = rgba(0x2a140a, 0.7); g.beginPath(); g.moveTo(w - 70, 22); g.lineTo(w - 62, 25); g.lineTo(w - 68, 28); g.lineTo(w - 60, 31); g.lineTo(w - 70, 31); g.fill();
      for (let n = 0; n < 8; n++) { g.fillStyle = rgba(0x8a4a20, 0.3); g.fillRect(20 + rnd() * (w - 110), 30, 1.4, 6 + rnd() * 8); }
    },
  },
  { id: 'copperA', w: 250, h: 190, paint: (g, w, h, rnd) => vein(g, w, h, rnd, 0x4a9a84, 0xc87a4a) },
  { id: 'copperB', w: 250, h: 190, paint: (g, w, h, rnd) => vein(g, w, h, rnd, 0x58a890, 0xb8683a) },
  {
    id: 'gold', w: 160, h: 120, paint: (g, w, h, rnd) => {
      // Gold in thin stringers and flecks through a quartz-pale seam, with a few tiny glints.
      const pts = jag(8, h * 0.78, w - 8, h * 0.22, rnd, 9, 14, 2);
      for (let i = 0; i < pts.length; i += 2) { pts[i] = Math.min(w - 8, Math.max(8, pts[i])); pts[i + 1] = Math.min(h - 10, Math.max(10, pts[i + 1])); }
      const pr = (t: number) => 2 + 5 * Math.sin(Math.PI * Math.min(0.999, Math.max(0.001, t))) * (0.6 + 0.6 * Math.abs(Math.sin(t * 19)));
      ribbon(g, pts, t => pr(t) * 1.8, 'rgba(2,4,8,0.35)');
      ribbon(g, pts, pr, rgba(0xa8a49c, 0.6));
      ribbon(g, pts, t => pr(t) * 0.3, rgba(0xe8e4dc, 0.5), 0, -0.8);
      for (let n = 0; n < 26; n++) {
        const t = rnd(), x = 6 + (w - 12) * t + (rnd() - 0.5) * 16, y = h * 0.8 - h * 0.6 * t + (rnd() - 0.5) * 16, r = 0.8 + rnd() * 2.2;
        g.fillStyle = rgba(rnd() < 0.6 ? 0xc8a050 : 0xe0c070, 0.95);
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        if (r > 2) { g.fillStyle = 'rgba(255,248,220,0.45)'; g.fillRect(x - 0.3, y - r * 1.3, 0.6, r * 2.6); g.fillRect(x - r * 1.3, y - 0.3, r * 2.6, 0.6); }
      }
    },
  },
  { id: 'crystalA', w: 130, h: 150, paint: (g, w, h, rnd) => crystals(g, w, h, rnd, 0x7fb4c0, 5) },
  { id: 'crystalB', w: 130, h: 150, paint: (g, w, h, rnd) => crystals(g, w, h, rnd, 0x9a92c4, 4) },
  { id: 'crystalC', w: 100, h: 110, paint: (g, w, h, rnd) => crystals(g, w, h, rnd, 0x86b8a8, 3) },
  {
    id: 'glow', w: 220, h: 120, paint: g => {
      const gr = g.createRadialGradient(110, 60, 0, 110, 60, 110);
      gr.addColorStop(0, 'rgba(255,170,90,0.9)'); gr.addColorStop(0.35, 'rgba(230,90,40,0.45)'); gr.addColorStop(1, 'rgba(140,30,10,0)');
      g.save(); g.translate(0, 60); g.scale(1, 0.55); g.translate(0, -60); g.fillStyle = gr; g.fillRect(0, 0, 220, 120); g.restore();
    },
  },
];

function seep(g: G, w: number, h: number, rnd: () => number): void {
  // A wet run down the rock face: dark soaked streak with a cold sheen and a bead or two at the foot.
  const x = w / 2;
  const wid = g.createLinearGradient(0, 0, w, 0);
  wid.addColorStop(0, 'rgba(4,10,16,0)'); wid.addColorStop(0.5, 'rgba(4,10,16,0.42)'); wid.addColorStop(1, 'rgba(4,10,16,0)');
  g.fillStyle = wid; g.fillRect(0, 0, w, h);
  const sheen = g.createLinearGradient(0, 0, w, 0);
  sheen.addColorStop(0.3, 'rgba(120,170,210,0)'); sheen.addColorStop(0.45, 'rgba(120,170,210,0.38)'); sheen.addColorStop(0.6, 'rgba(120,170,210,0)');
  g.fillStyle = sheen; g.fillRect(0, 6, w, h * 0.85);
  for (let n = 0; n < 3; n++) { g.fillStyle = rgba(0xb8dcf0, 0.45); g.beginPath(); g.ellipse(x + (rnd() - 0.5) * w * 0.4, h * (0.35 + 0.18 * n + rnd() * 0.1), 1.2, 2.4, 0, 0, Math.PI * 2); g.fill(); }
  g.globalCompositeOperation = 'destination-in';
  const m = g.createLinearGradient(0, 0, 0, h); m.addColorStop(0, 'rgba(0,0,0,0.2)'); m.addColorStop(0.2, 'rgba(0,0,0,1)'); m.addColorStop(0.8, 'rgba(0,0,0,0.9)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}

function faultCrack(g: G, w: number, h: number, rnd: () => number): void {
  const main = jag(8, 8, w - 8, h - 8, rnd, 14, 22);
  crack(g, main, 3.6);
  for (let n = 0; n < 4; n++) {
    const i = 2 * (3 + Math.floor(rnd() * 15)), side = rnd() < 0.5 ? -1 : 1;
    crack(g, jag(main[i], main[i + 1], main[i] + side * (30 + rnd() * 50), main[i + 1] + (rnd() * 40 - 10), rnd, 5, 8), 1.7);
  }
}

function vein(g: G, w: number, h: number, rnd: () => number, ore: number, oxide: number): void {
  // Ore vein: a soft dark halo in the rock, an irregular ribbon of ore (green carbonate with warm copper oxide), lit from above, specks that catch the lamp.
  const main = jag(10, h * 0.84, w - 10, h * 0.16, rnd, 13, 18, 2);
  for (let i = 0; i < main.length; i += 2) { main[i] = Math.min(w - 12, Math.max(12, main[i])); main[i + 1] = Math.min(h - 12, Math.max(12, main[i + 1])); }
  for (let i = 0; i < main.length; i += 4) blot(g, 0, main[i], main[i + 1], 22, 22, 0x02040a, 0.28);
  const prof = (t: number) => 2 + 4.2 * Math.pow(Math.sin(Math.PI * Math.min(0.999, Math.max(0.001, t))), 0.6) * (0.6 + 0.6 * Math.abs(Math.sin(t * 23)));
  ribbon(g, main, t => prof(t) * 1.5, rgba(shade(ore, 0.35), 0.9));
  ribbon(g, main, prof, rgba(shade(ore, 0.8), 0.95));
  ribbon(g, main, t => prof(t) * 0.55, rgba(ore, 0.95), 0, -0.8);
  ribbon(g, main, t => prof(t) * 0.14, rgba(shade(ore, 1.6), 0.8), 0, -1.6);
  for (let n = 0; n < 5; n++) {
    const i = 2 * (1 + Math.floor(rnd() * 14)), sd = rnd() < 0.5 ? -1 : 1;
    const br = jag(main[i], main[i + 1], main[i] + sd * (20 + rnd() * 34), main[i + 1] + (rnd() * 36 - 8), rnd, 4, 6);
    ribbon(g, br, t => 1 + 3.6 * (1 - t), rgba(shade(ore, 0.7), 0.9));
    ribbon(g, br, t => 0.4 + 1.6 * (1 - t), rgba(ore, 0.9), 0, -0.5);
  }
  for (let n = 0; n < 22; n++) {
    const i = 2 * Math.floor(rnd() * (main.length / 2));
    const x = main[i] + (rnd() - 0.5) * 12, y = main[i + 1] + (rnd() - 0.5) * 12;
    g.fillStyle = rgba(oxide, 0.85); g.beginPath(); g.ellipse(x, y, 1 + rnd() * 2.6, 0.8 + rnd() * 1.6, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  for (let n = 0; n < 4; n++) {
    const i = 2 * Math.floor(rnd() * (main.length / 2));
    const x = main[i] + (rnd() - 0.5) * 6, y = main[i + 1] + (rnd() - 0.5) * 6;
    g.fillStyle = 'rgba(240,255,250,0.75)'; g.fillRect(x - 0.4, y - 2.4, 0.8, 4.8); g.fillRect(x - 2.4, y - 0.4, 4.8, 0.8);
  }
}

function crystals(g: G, w: number, h: number, rnd: () => number, col: number, n: number): void {
  // A cluster of prisms growing out of a dark pocket, a soft cold glow under it (style rule: saturation stays under 0.6).
  blot(g, 0, w / 2, h * 0.78, w * 0.55, h * 0.3, col, 0.22);
  blot(g, 0, w / 2, h * 0.86, w * 0.5, h * 0.2, 0x02040a, 0.7);
  for (let i = 0; i < n; i++) {
    const bx = w * (0.18 + 0.64 * (i / Math.max(1, n - 1))) + (rnd() - 0.5) * 8, by = h * 0.9;
    const ph = h * (0.4 + rnd() * 0.4) * (1 - Math.abs(i / Math.max(1, n - 1) - 0.5) * 0.7), pw = 9 + rnd() * 8, lean = (rnd() - 0.5) * 0.5;
    const tx = bx + lean * ph;
    const gr = g.createLinearGradient(bx - pw, 0, bx + pw, 0);
    gr.addColorStop(0, rgba(shade(col, 1.35), 0.95)); gr.addColorStop(0.5, rgba(col, 0.9)); gr.addColorStop(1, rgba(shade(col, 0.45), 0.95));
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(bx - pw / 2, by); g.lineTo(tx - pw / 2, by - ph); g.lineTo(tx, by - ph - pw * 0.8); g.lineTo(tx + pw / 2, by - ph); g.lineTo(bx + pw / 2, by); g.closePath(); g.fill();
    g.fillStyle = rgba(shade(col, 1.7), 0.55);
    g.beginPath(); g.moveTo(tx - pw / 2, by - ph); g.lineTo(tx, by - ph - pw * 0.8); g.lineTo(tx + pw * 0.1, by - ph); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(bx - pw * 0.28, by - ph * 0.85, 1.4, ph * 0.7);
  }
}

export const ATLAS_W = 1024;
export const ATLAS_H = 512;
/** Texels per world unit of each piece on the sheet (the pieces are painted at world size, then scaled down to fit 1024x512 = 2 MB). */
const K: Record<PieceId, number> = {
  rootA: 0.72, rootB: 0.72, rootC: 0.72, stonesA: 0.8, stonesB: 0.8, ribs: 0.8, femur: 0.8, skull: 0.8, seepA: 0.7, seepB: 0.7, seepC: 0.7,
  faultA: 0.7, faultB: 0.7, slab: 0.78, beam: 0.78, column: 0.78, rail: 0.8, copperA: 0.78, copperB: 0.78, gold: 0.85, crystalA: 0.85, crystalB: 0.85,
  crystalC: 0.85, glow: 0.5,
};

/** Shelf-packs the pieces (at their sheet size) into the atlas with 2 px of padding; returns each piece's rectangle on the sheet. */
function pack(): { id: PieceId; x: number; y: number; w: number; h: number }[] {
  const out: { id: PieceId; x: number; y: number; w: number; h: number }[] = [];
  const sorted = [...PIECES].sort((a, b) => b.h * K[b.id] - a.h * K[a.id]);
  let x = 2, y = 2, rowH = 0;
  for (const p of sorted) {
    const w = Math.ceil(p.w * K[p.id]), h = Math.ceil(p.h * K[p.id]);
    if (x + w + 2 > ATLAS_W) { x = 2; y += rowH + 4; rowH = 0; }
    out.push({ id: p.id, x, y, w, h });
    x += w + 4;
    rowH = Math.max(rowH, h);
  }
  if (y + rowH + 2 > ATLAS_H) throw new Error('strata atlas overflow');
  return out;
}

/** Paints the whole feature sheet (exported for the preview tool). */
export function paintAtlas(): { canvas: HTMLCanvasElement; rects: Map<PieceId, Rectangle> } {
  const cv = mk(ATLAS_W, ATLAS_H);
  const g = cv.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  const rects = new Map<PieceId, Rectangle>();
  for (const r of pack()) {
    const piece = PIECES.find(p => p.id === r.id)!;
    const tmp = mk(piece.w, piece.h); // each piece paints on its own canvas at world size, so its masks stay inside it
    piece.paint(tmp.getContext('2d')!, piece.w, piece.h, seeded(hashString(piece.id)));
    g.drawImage(tmp, 0, 0, piece.w, piece.h, r.x, r.y, r.w, r.h);
    rects.set(r.id, new Rectangle(r.x, r.y, r.w, r.h));
  }
  return { canvas: cv, rects };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Placement: pure function of (band, column), no state
// ---------------------------------------------------------------------------------------------------------------------------------

interface Rule {
  id: PieceId[];
  /** Expected pieces per 512-unit column. */
  per: number;
  y0: number;
  y1: number;
  /** 'top': the piece hangs from its y (roots, seepage); 'mid': centred. */
  anchor?: 'top' | 'mid' | 'bottom';
  /** Scale range. */
  s?: [number, number];
  /** The geothermal glow: not tinted, softer. (Normal blend: an additive batch per column would break the sprite batch and cost draw calls.) */
  add?: boolean;
  /** Only east of this x (the rail line follows the metro side). */
  minX?: number;
  /** Sprite alpha (fossils sit sunk in the rock). */
  a?: number;
}

const RULES: Rule[][] = [
  [
    { id: ['rootA', 'rootB', 'rootC'], per: 1.3, y0: 6, y1: 60, anchor: 'top', s: [0.8, 1.15] },
    { id: ['stonesA', 'stonesB'], per: 1.2, y0: 40, y1: 270, s: [0.6, 1.0] },
  ],
  [
    { id: ['ribs', 'femur', 'femur'], per: 0.35, y0: 360, y1: 1000, s: [0.7, 1.0], a: 0.6 },
    { id: ['skull'], per: 0.1, y0: 400, y1: 980, s: [0.55, 0.75], a: 0.6 },
    { id: ['seepA', 'seepB', 'seepC'], per: 2.2, y0: WATER_TOP - 30, y1: WATER_BOTTOM - 70, anchor: 'top', s: [0.9, 1.4] },
    { id: ['faultA', 'faultB'], per: 0.4, y0: 360, y1: 940, s: [0.9, 1.4] },
    { id: ['faultA', 'faultB'], per: 0.75, y0: 280, y1: 310, s: [1.3, 1.9], a: 0.8 },
  ],
  [
    { id: ['slab', 'beam', 'column'], per: 1.0, y0: 1090, y1: 1810, s: [0.8, 1.2] },
    { id: ['faultA', 'faultB'], per: 0.9, y0: 1060, y1: 1790, s: [1, 1.8] },
    { id: ['rail'], per: 0.5, y0: 1480, y1: 1500, s: [1, 1.25], minX: 640 },
    { id: ['faultA', 'faultB'], per: 0.75, y0: 1020, y1: 1050, s: [1.3, 1.9], a: 0.8 },
  ],
  [
    { id: ['copperA', 'copperB'], per: 1.2, y0: 1920, y1: 2540, s: [0.9, 1.4] },
    { id: ['gold'], per: 1, y0: 1920, y1: 2540, s: [0.8, 1.2] },
    { id: ['crystalA', 'crystalB', 'crystalC'], per: 1.3, y0: 1900, y1: 2560, s: [0.8, 1.3] },
    { id: ['faultA', 'faultB'], per: 0.75, y0: 1840, y1: 1870, s: [1.3, 1.9], a: 0.8 },
  ],
  [
    { id: ['faultA', 'faultB'], per: 0.6, y0: 2640, y1: 4000, s: [1.2, 2] },
    { id: ['faultA', 'faultB'], per: 0.75, y0: 2590, y1: 2620, s: [1.3, 1.9], a: 0.8 },
    { id: ['glow'], per: 1.6, y0: 2680, y1: 4400, s: [1.2, 2.4], add: true },
  ],
];

/** Per-band tint on the feature sprites: the deeper, the colder and darker (the depth fade applies on top). */
const FEATURE_TINT = [0xc0b0a0, 0xb8b4ac, 0xa8acb4, 0x9098a8, 0x84808a] as const;
/** Per-band brightness of the tile itself (deeper = darker and colder; the lamp-lit bunker must stay the brightest thing on screen). */
const TILE_TINT = [0xb8a89c, 0xa89f94, 0x9ea2aa, 0x8c94a0, 0x867f8a] as const;

// ---------------------------------------------------------------------------------------------------------------------------------
// Assets shared by every build (the tiles and the atlas survive structure rebuilds)
// ---------------------------------------------------------------------------------------------------------------------------------

interface TileSet { key: string; size: number; tiles: (Texture | null)[]; fades: (Texture | null)[]; pending: boolean }
let tileSet: TileSet | null = null;
let atlas: { tex: Texture; rects: Map<PieceId, Rectangle>; frames: Map<PieceId, Texture> } | null = null;

function makeTexture(canvas: HTMLCanvasElement, mips: boolean, repeat: boolean): Texture {
  const source = new CanvasSource({ resource: canvas, autoGenerateMipmaps: mips, scaleMode: 'linear', addressMode: repeat ? 'repeat' : 'clamp-to-edge' });
  return new Texture({ source });
}

function atlasFor(): NonNullable<typeof atlas> {
  if (atlas) return atlas;
  const { canvas, rects } = paintAtlas();
  const tex = makeTexture(canvas, false, false);
  const frames = new Map<PieceId, Texture>();
  for (const [id, r] of rects) frames.set(id, new Texture({ source: tex.source, frame: r }));
  atlas = { tex, rects, frames };
  return atlas;
}

/** Texture size in world units of one band's tile: [x, y] world units per tile repeat. Bands 0-3 are one repeat tall exactly. */
const bandHeight = (i: number, bottom: number): number => (i < 4 ? BAND_TOP[i + 1] - BAND_TOP[i] : Math.max(900, bottom - BAND_TOP[4]));

/** The newest build waiting for its tiles (a rebuild replaces it; the old one is destroyed). */
let live: { upgrade: () => void; bottom: number; rock: Texture | null | undefined; mips: boolean; features: boolean } | null = null;

/** Paints the next missing tile (and its transition piece) of the live build, then schedules the one after it. */
function paintNext(): void {
  const set = tileSet;
  if (!set) return;
  set.pending = false;
  if (!live) return;
  const n = set.tiles.findIndex((t, idx) => !t && BAND_TOP[idx] < live!.bottom);
  if (n < 0) {
    if (live.features && !atlas) { atlasFor(); set.pending = true; setTimeout(paintNext, 0); return; }
    live.upgrade();
    return;
  }
  const S = set.size;
  const cv = paintTile(n, live.rock, S);
  set.tiles[n] = makeTexture(cv, live.mips, true);
  if (n < 4) {
    // The transition continues the upper band's pattern past its end, which is the tile's first rows (the tile repeats vertically).
    set.fades[n] = makeTexture(paintFade(cv, S, (BLEND_H / bandHeight(n, live.bottom)) * S), live.mips, true);
  }
  live.upgrade();
  set.pending = true;
  setTimeout(paintNext, 0);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The container
// ---------------------------------------------------------------------------------------------------------------------------------

interface Band {
  i: number;
  y0: number;
  y1: number;
  group: Container;
  tile: TilingSprite;
  fade: TilingSprite | null;
  /** Feature sprites by 512-unit column : a column off screen is switched off, so a view of 400 units shows 2 of 6. */
  cols: { c: Container; x0: number; x1: number; on: boolean }[];
  featsBuilt: boolean;
  on: boolean;
}

/**
 * The rock for everything below the ground, from y = 0 to `bottomY`, spanning x = `left` .. `right`. Add it behind the casing.
 * Off-screen bands are switched off by the container's own `onRender` (the camera rectangle is perfFx.VIEW), so nothing here needs a
 * per-frame call from the renderer.
 */
export function buildStrata(bottomY: number, left: number, right: number, opts: StrataOpts = {}): Container {
  const root = new Container();
  root.eventMode = 'none';
  const lowQ = gfxLevel() === 'low' || isLiteMode();
  const small = opts.small ?? lowQ;
  const wantFeatures = opts.features ?? !lowQ;
  const S = small ? 256 : 512;
  // No mipmaps: Pixi's tiling shader samples every interior texel at mip 0 (lod bias -32) and only the half-texel ring at a tile edge with the
  // derivative-picked level, which at a wrap picks the smallest mip and draws a thin wrong-coloured line along every tile edge. The texel density
  // (0.7 per world unit) never minifies below the far-zoom map anyway.
  const mips = false;
  const key = `${S}|${opts.rock ? 1 : 0}|${mips ? 1 : 0}`;
  if (!tileSet || tileSet.key !== key) {
    // A different set (the painting arrived, or the quality level changed): the old textures are not referenced by anything live (the renderer
    // destroys the previous build first), give their GPU memory back.
    for (const t of tileSet ? [...tileSet.tiles, ...tileSet.fades] : []) t?.destroy(true);
    tileSet = { key, size: S, tiles: [null, null, null, null, null], fades: [null, null, null, null, null], pending: false };
  }
  const set = tileSet;
  const width = right - left;
  const bands: Band[] = [];

  for (let i = 0; i < 5; i++) {
    const y0 = BAND_TOP[i], y1 = i < 4 ? BAND_TOP[i + 1] : bottomY;
    if (y0 >= bottomY) break;
    const group = new Container();
    group.eventMode = 'none';
    const bh = bandHeight(i, bottomY);
    // A band's tile runs 2 units past its end and the next band's starts 2 units late: the transition piece's first pixel row then sits over the
    // upper band's own pattern instead of the lower band's rock, so a row the GPU leaves out at a quad edge cannot show as a thin foreign line.
    const lap = 2, off = i > 0 ? lap : 0, ext = i < 4 ? lap : 0;
    const tile = new TilingSprite({ texture: set.tiles[i] ?? Texture.WHITE, width, height: y1 + ext - (y0 + off) });
    tile.position.set(left, y0 + off);
    tile.tint = set.tiles[i] ? TILE_TINT[i] : BASE[i];
    tile.tileScale.set(TILE_W[i] / S, bh / S);
    tile.tilePosition.set(-left + ((i * 211) % 400), -off);
    group.addChild(tile);
    let fade: TilingSprite | null = null;
    if (i > 0) {
      // The upper band's pattern, fading out over the first BLEND_H units of this band.
      const up = bands[i - 1];
      if (up) {
        fade = new TilingSprite({ texture: set.fades[i - 1] ?? Texture.EMPTY, width, height: BLEND_H });
        fade.position.set(left, y0);
        const ub = bandHeight(i - 1, bottomY);
        fade.tileScale.set(TILE_W[i - 1] / S, ub / S);
        fade.tilePosition.set(-left + (((i - 1) * 211) % 400), 0);
        fade.tint = TILE_TINT[i - 1];
        fade.visible = !!set.fades[i - 1];
        group.addChild(fade);
      }
    }
    root.addChild(group);
    bands.push({ i, y0, y1, group, tile, fade, cols: [], featsBuilt: false, on: true });
  }

  const upgradeTextures = (): void => {
    if (root.destroyed) return;
    for (const b of bands) {
      const t = set.tiles[b.i];
      if (t && b.tile.texture !== t) { b.tile.texture = t; b.tile.tint = TILE_TINT[b.i]; }
      const f = b.i > 0 ? set.fades[b.i - 1] : null;
      if (b.fade && f && b.fade.texture !== f) { b.fade.texture = f; b.fade.tint = TILE_TINT[b.i - 1]; b.fade.visible = true; }
    }
  };
  // Paint the tiles one per timer tick after the first picture, nearest band first (never inside the render path; a rebuild reuses the cache).
  live = { upgrade: upgradeTextures, bottom: bottomY, rock: opts.rock, mips, features: wantFeatures };
  upgradeTextures();
  if ((!set.tiles.every((t, n) => t || BAND_TOP[n] >= bottomY) || (wantFeatures && !atlas)) && !set.pending) { set.pending = true; setTimeout(paintNext, 0); }

  const buildFeatures = (b: Band): void => {
    if (!wantFeatures) { b.featsBuilt = true; return; }
    if (!atlas) return; // painted on a timer tick shortly after the first picture; the next picture builds the band's features
    b.featsBuilt = true;
    const at = atlas;
    const c0 = Math.floor(left / COLUMN), c1 = Math.floor(right / COLUMN);
    for (let col = c0; col <= c1; col++) {
      const rnd = seeded(hashString(`strata|${b.i}|${col}`));
      const feats = new Container();
      for (const rule of RULES[b.i]) {
        let n = Math.floor(rule.per) + (rnd() < rule.per - Math.floor(rule.per) ? 1 : 0);
        while (n-- > 0) {
          const id = rule.id[Math.floor(rnd() * rule.id.length)];
          const x = col * COLUMN + rnd() * COLUMN;
          const y = rule.y0 + rnd() * (rule.y1 - rule.y0);
          const sc = rule.s ? rule.s[0] + rnd() * (rule.s[1] - rule.s[0]) : 1;
          const flip = rnd() < 0.5 ? -1 : 1;
          if (rule.minX !== undefined && x < rule.minX) continue;
          if (x < left - 40 || x > right + 40 || y > bottomY) continue;
          const spr = new Sprite(at.frames.get(id)!);
          spr.anchor.set(0.5, rule.anchor === 'top' ? 0 : rule.anchor === 'bottom' ? 1 : 0.5);
          const kk = K[id];
          spr.scale.set((sc * flip) / kk, sc / kk);
          spr.position.set(x, y);
          spr.tint = rule.add ? 0xffffff : FEATURE_TINT[b.i];
          spr.alpha = rule.add ? 0.7 : rule.a ?? 0.92;
          spr.eventMode = 'none';
          feats.addChild(spr);
        }
      }
      // A piece reaches at most ~330 units from its anchor (a 240-unit crack at scale 2): the column's box carries that margin.
      if (!feats.children.length) { feats.destroy(); continue; }
      feats.eventMode = 'none';
      b.group.addChild(feats);
      b.cols.push({ c: feats, x0: col * COLUMN - 330, x1: (col + 1) * COLUMN + 330, on: true });
    }
  };

  // Per picture (before the render group builds its instructions): switch bands that are off screen off, build a band's features the first
  // time it is seen, follow the live quality level. Only `visible` flips when something changes; no allocation.
  root.onRender = (): void => {
    const y0 = VIEW.y0, y1 = VIEW.y1;
    const low = gfxLevel() === 'low';
    const x0 = VIEW.x0, x1 = VIEW.x1;
    for (let n = 0; n < bands.length; n++) {
      const b = bands[n];
      const seen = b.y1 + BLEND_H > y0 && b.y0 - BLEND_H < y1;
      if (seen !== b.on) { b.on = seen; b.group.visible = seen; }
      if (!seen) continue;
      if (!b.featsBuilt) buildFeatures(b);
      for (let k = 0; k < b.cols.length; k++) {
        const col = b.cols[k];
        const show = !low && col.x1 > x0 && col.x0 < x1;
        if (show !== col.on) { col.on = show; col.c.visible = show; }
      }
    }
  };
  return root;
}

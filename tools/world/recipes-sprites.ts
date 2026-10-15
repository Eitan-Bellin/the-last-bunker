/**
 * World kit recipes, part 3: atlas sprites (doors, stairs, rubble, timber, lamps, foreground silhouettes).
 * Each sprite is drawn in WORLD UNITS (the context is scaled by ppu and offset by the padding), then finished in pixels:
 * wear, grain, and the 1.5 u outline.
 */
import type { WorldAssetDef } from '../../src/world/tokensAssets';
import { STEEL, type Baked, type Sources } from './recipes-surfaces';
import {
  css, ctx, cylH, cylV, fbm, glow, grainPass, hashStr, jag, mixHex, mk, noiseCanvas, outline, pal, plate, poly, rivet, rng, shade, smooth, stroke, wear,
  type G, type RNG,
} from './paint';

const TAU = Math.PI * 2;

interface Canvas2 { c: HTMLCanvasElement; g: G; e: HTMLCanvasElement; eg: G; P: number; w: number; h: number }

function begin(def: WorldAssetDef): Canvas2 {
  const [fw, fh] = def.px;
  const c = mk(fw, fh), e = mk(fw, fh);
  const g = ctx(c), eg = ctx(e);
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, fw, fh);
  for (const x of [g, eg]) { x.translate(def.pad, def.pad); x.scale(def.ppu, def.ppu); }
  return { c, g, e, eg, P: def.ppu, w: def.world[0], h: def.world[1] };
}
/** Pixel region of the content (without the padding) for wear passes. */
const region = (def: WorldAssetDef, x: number, y: number, w: number, h: number): [number, number, number, number] =>
  [Math.round(def.pad + x * def.ppu), Math.round(def.pad + y * def.ppu), Math.max(1, Math.round(w * def.ppu)), Math.max(1, Math.round(h * def.ppu))];

function finish(def: WorldAssetDef, k: Canvas2, seed: number, outlineK = 1): Baked {
  grainPass(k.c, seed + 99, 0.12, 0.35);
  if (outlineK > 0) outline(k.c, 1.5 * def.ppu * outlineK);
  return { albedo: k.c, emissive: def.emissive ? k.e : undefined };
}

// =================================================================================================================================
// Blast doors
// =================================================================================================================================

const ENAMEL_GREEN = 0x5d6b58;
const HAZARD = 0xc89a2a;

function hazardBand(g: G, x: number, y: number, w: number, h: number, stripe: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = css(pal(0x1c1a16));
  g.fillRect(x, y, w, h);
  g.fillStyle = css(pal(HAZARD, 0.6, 0.08));
  for (let k = -h; k < w + h; k += stripe * 2) {
    g.beginPath();
    g.moveTo(x + k, y + h); g.lineTo(x + k + stripe, y + h); g.lineTo(x + k + stripe + h, y); g.lineTo(x + k + h, y); g.closePath();
    g.fill();
  }
  g.restore();
}

function doorFrame(def: WorldAssetDef, k: Canvas2, seed: number): { ox: number; oy: number; ow: number; oh: number } {
  const { g, w, h } = k;
  const steel = pal(STEEL);
  const fT = 6, head = 10;
  // frame body
  plate(g, 0, 0, w, h, shade(steel, 0.95), 0.8);
  // jamb hazard bands
  hazardBand(g, 1.2, head + 2, fT - 2.4, h - head - 4, 2.2);
  hazardBand(g, w - fT + 1.2, head + 2, fT - 2.4, h - head - 4, 2.2);
  // header plate with the lamp housing
  plate(g, 0, 0, w, head, shade(steel, 1.05), 0.8);
  for (let x = 3; x < w; x += 6) rivet(g, x, 2, 0.55, steel);
  const ow = w - fT * 2, oh = h - head;
  wear(k.c, seed + 3, pal(0x7a4a2c), 0.16, { cells: 10, region: region(def, 0, 0, w, h) });
  return { ox: fT, oy: head, ow, oh };
}

function doorLeaf(def: WorldAssetDef, k: Canvas2, seed: number, o: { ox: number; oy: number; ow: number; oh: number }, wheel: HTMLImageElement | null): void {
  const { g } = k;
  const green = pal(ENAMEL_GREEN);
  const lx = o.ox + 0.6, ly = o.oy + 0.6, lw = o.ow - 1.2, lh = o.oh - 0.6;
  // leaf
  const gr = g.createLinearGradient(lx, ly, lx + lw, ly + lh);
  gr.addColorStop(0, css(shade(green, 1.12)));
  gr.addColorStop(1, css(shade(green, 0.82)));
  g.fillStyle = gr;
  g.fillRect(lx, ly, lw, lh);
  // reinforcing ribs
  for (const ry of [ly + lh * 0.3, ly + lh * 0.7]) {
    plate(g, lx + 2, ry - 1.6, lw - 4, 3.2, shade(green, 1.05), 0.6);
  }
  // riveted border
  for (let x = lx + 2; x < lx + lw - 1; x += 3.2) { rivet(g, x, ly + 1.8, 0.45, green); rivet(g, x, ly + lh - 1.8, 0.45, green); }
  for (let y = ly + 4; y < ly + lh - 3; y += 3.2) { rivet(g, lx + 1.8, y, 0.45, green); rivet(g, lx + lw - 1.8, y, 0.45, green); }
  // hinge lugs on the left jamb
  for (const hy of [ly + 6, ly + lh / 2, ly + lh - 8]) { cylV(g, lx - 2.2, hy - 3, 3, 6, pal(0x6e6a62)); }
  // wear: paint worn to steel at the edges and the handle, rust in the lowest third
  const reg = region(def, lx, ly, lw, lh);
  wear(k.c, seed + 1, pal(0x6e6a62), 0.22, { cells: 9, region: reg, bias: (x, y) => (Math.min(x, 1 - x) < 0.08 ? 0.15 : 0) + (y > 0.85 ? 0.12 : 0) });
  wear(k.c, seed + 2, pal(0x7a4a2c), 0.12, { cells: 14, region: reg, bias: (_x, y) => (y > 0.6 ? 0.1 : -0.05) });
  // hand wheel
  const cx = lx + lw / 2, cy = ly + lh * 0.5, R = 9;
  if (wheel) {
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 1.5 * k.P;
    g.shadowOffsetX = 0.8 * k.P;
    g.shadowOffsetY = 1 * k.P;
    g.drawImage(wheel, cx - R, cy - R, R * 2, R * 2);
    g.restore();
  } else {
    g.strokeStyle = css(pal(0x6e6a62));
    g.lineWidth = 1.8;
    g.beginPath(); g.arc(cx, cy, R - 1, 0, TAU); g.stroke();
    for (let a = 0; a < 4; a++) stroke(g, [cx, cy, cx + Math.cos(a * Math.PI / 2 + 0.4) * (R - 1), cy + Math.sin(a * Math.PI / 2 + 0.4) * (R - 1)], 1.2, css(pal(0x6e6a62)));
    rivet(g, cx, cy, 1.6, pal(0x6e6a62));
  }
  // grime from the floor
  const gm = g.createLinearGradient(0, ly + lh * 0.7, 0, ly + lh);
  gm.addColorStop(0, 'rgba(20,14,10,0)');
  gm.addColorStop(1, 'rgba(20,14,10,0.45)');
  g.fillStyle = gm;
  g.fillRect(lx, ly + lh * 0.7, lw, lh * 0.3);
}

function statusLamp(k: Canvas2, def: WorldAssetDef, col: number | null): void {
  const { g, eg } = k;
  const L = def.lamps?.[0];
  const lx = (L?.x ?? 0) + k.w / 2, ly = (L?.y ?? -68) + k.h;
  plate(g, lx - 3, ly - 2.4, 6, 4.8, pal(0x2a2a28), 0.5);
  const glass = col == null ? pal(0x3a2a24) : mixHex(col, 0xffffff, 0.35);
  const gr = g.createRadialGradient(lx - 0.6, ly - 0.6, 0.2, lx, ly, 2);
  gr.addColorStop(0, css(col == null ? shade(glass, 1.4) : 0xffffff));
  gr.addColorStop(1, css(glass));
  g.fillStyle = gr;
  g.beginPath(); g.arc(lx, ly, 1.8, 0, TAU); g.fill();
  stroke(g, [lx - 2, ly, lx + 2, ly], 0.3, 'rgba(10,10,10,0.8)');
  if (col != null) glow(eg, lx, ly, 3.4, col, 1, 0.3);
}

export function door(def: WorldAssetDef, src: Sources, state: 'closed' | 'open' | 'welded'): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const o = doorFrame(def, k, seed);
  const { g } = k;
  if (state === 'open') {
    // the passage beyond
    const pg = g.createLinearGradient(0, o.oy, 0, o.oy + o.oh);
    pg.addColorStop(0, css(0x0e0b0c));
    pg.addColorStop(0.75, css(0x15110f));
    pg.addColorStop(1, css(0x221a14));
    g.fillStyle = pg;
    g.fillRect(o.ox, o.oy, o.ow, o.oh);
    // far floor line and a faint far doorway
    g.fillStyle = css(0x2a2018, 0.8);
    g.fillRect(o.ox, o.oy + o.oh * 0.8, o.ow, 0.8);
    g.fillStyle = css(0x1e1712);
    g.fillRect(o.ox + o.ow * 0.4, o.oy + o.oh * 0.42, o.ow * 0.22, o.oh * 0.38);
    // inner reveal (lit on the right)
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(o.ox, o.oy, 3, o.oh);
    g.fillStyle = css(shade(pal(STEEL), 1.2), 0.7);
    g.fillRect(o.ox + o.ow - 2, o.oy, 2, o.oh);
    // the leaf swung back, seen nearly edge-on against the left jamb
    const green = pal(ENAMEL_GREEN);
    const lx = o.ox + 0.5, lt = o.oy + 0.5, lb = o.oy + o.oh;
    poly(g, [lx, lt, lx + 9, lt + 3, lx + 9, lb - 1, lx, lb], css(shade(green, 0.75)));
    poly(g, [lx + 9, lt + 3, lx + 11.5, lt + 3.6, lx + 11.5, lb - 1, lx + 9, lb - 1], css(shade(pal(0x6e6a62), 1.15)));
    for (let y = lt + 6; y < lb - 4; y += 4) { g.fillStyle = css(shade(green, 1.25)); g.fillRect(lx + 2, y, 6, 0.6); }
    wear(k.c, seed + 2, pal(0x6e6a62), 0.2, { cells: 8, region: region(def, lx, lt, 12, o.oh) });
    statusLamp(k, def, 0x40e0c0);
  } else {
    doorLeaf(def, k, seed, o, src.wheel);
    if (state === 'welded') {
      // crossed straps welded across leaf and frame
      const steel = pal(0x5a5650);
      for (const [x0, y0, x1, y1] of [[o.ox - 2, o.oy + 3, o.ox + o.ow + 2, o.oy + o.oh - 4], [o.ox + o.ow + 2, o.oy + 3, o.ox - 2, o.oy + o.oh - 4]]) {
        g.save();
        const a = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0);
        g.translate(x0, y0); g.rotate(a);
        g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 1.2 * k.P; g.shadowOffsetY = 0.8 * k.P;
        plate(g, 0, -2.4, len, 4.8, steel, 0.6);
        g.shadowColor = 'transparent';
        for (let t = 3; t < len; t += 6) rivet(g, t, 0, 0.6, steel);
        g.restore();
      }
      // weld beads along the leaf gap, heat tint and scorch
      const r = rng(seed + 5);
      const seam = [[o.ox + 0.5, o.oy + 1, o.ox + 0.5, o.oy + o.oh], [o.ox + o.ow - 0.5, o.oy + 1, o.ox + o.ow - 0.5, o.oy + o.oh], [o.ox + 1, o.oy + 0.6, o.ox + o.ow - 1, o.oy + 0.6]];
      for (const [x0, y0, x1, y1] of seam) {
        const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 1.1);
        for (let i = 0; i < n; i++) {
          const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
          const hg = g.createRadialGradient(x, y, 0, x, y, 3.2);
          hg.addColorStop(0, 'rgba(60,70,110,0.18)'); hg.addColorStop(0.5, 'rgba(110,70,40,0.12)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = hg; g.fillRect(x - 3.2, y - 3.2, 6.4, 6.4);
          g.fillStyle = css(shade(pal(0x8a8478), 0.8 + r() * 0.6));
          g.beginPath(); g.arc(x, y, 0.75 + r() * 0.25, 0, TAU); g.fill();
        }
      }
      for (let i = 0; i < 4; i++) {
        const x = o.ox + r() * o.ow, y = o.oy + r() * o.oh;
        const sg = g.createRadialGradient(x, y, 0, x, y, 6 + r() * 6);
        sg.addColorStop(0, 'rgba(10,8,6,0.45)'); sg.addColorStop(1, 'rgba(10,8,6,0)');
        g.fillStyle = sg; g.fillRect(x - 12, y - 12, 24, 24);
      }
      statusLamp(k, def, null);
    } else {
      statusLamp(k, def, 0xff3a2a);
    }
  }
  return finish(def, k, seed);
}

// =================================================================================================================================
// Stair flight
// =================================================================================================================================

export function stairFlight(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const { g, w, h } = k; // 38 x 36
  const steel = pal(STEEL);
  const n = 6, run = w / n, rise = h / n;
  // stringer: a channel under the nosing line (0,h)-(w,0), cut by the floor at the bottom and square at the top, so chained
  // flights continue one channel
  const top = 1.2, th = 6.5, slope = w / h;
  const A = [top * slope, h], B = [w, top], C = [w, th], D = [th * slope, h];
  poly(g, [...A, ...B, ...C, ...D], css(shade(steel, 0.92)));
  // web shading, top flange highlight and bottom flange shadow
  const sg = g.createLinearGradient(w * 0.5, h * 0.5 - 3, w * 0.5 + 3, h * 0.5 + 3);
  sg.addColorStop(0, 'rgba(255,240,220,0.12)');
  sg.addColorStop(1, 'rgba(0,0,0,0.25)');
  poly(g, [...A, ...B, ...C, ...D], sg);
  stroke(g, [...A, ...B], 0.9, css(shade(steel, 1.55)));
  stroke(g, [...D, ...C], 0.9, css(shade(steel, 0.5)));
  for (let t = 0.12; t < 1; t += 0.22) rivet(g, A[0] + (B[0] - A[0]) * t + 1.2, A[1] + (B[1] - A[1]) * t + 2.4, 0.5, steel);
  // treads (sawtooth): grated plates with lit nosings, open risers
  for (let i = 0; i < n; i++) {
    const x = i * run, y = h - (i + 1) * rise;
    // bracket down to the stringer
    poly(g, [x + run - 1.2, y + 1, x + run, y + 1, x + run, y + rise * 0.9, x + run - 1.2, y + rise * 0.9], css(shade(steel, 0.7)));
    // tread plate (grating) on a small angle bracket
    plate(g, x, y, run + 0.4, 2.1, shade(steel, 1.05), 0.35);
    for (let gx = x + 0.6; gx < x + run; gx += 1.1) { g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(gx, y + 0.5, 0.45, 1.2); }
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(x, y + 2.1, run, 0.8);
    // nosing (worn bright)
    g.fillStyle = css(pal(0xb0aa98));
    g.fillRect(x, y - 0.15, 1.6, 0.6);
    g.fillStyle = css(pal(HAZARD, 0.55, 0.1), 0.85);
    g.fillRect(x + 1.6, y - 0.1, run * 0.35, 0.45);
  }
  wear(k.c, seed, pal(0x7a4a2c), 0.1, { cells: 8 });
  return finish(def, k, seed, 0.8);
}

// =================================================================================================================================
// Rubble
// =================================================================================================================================

function chunk(g: G, r: RNG, cx: number, cy: number, s: number, col: number, lum: HTMLCanvasElement | null): void {
  const n = 5 + Math.floor(r() * 3);
  const pts: number[] = [];
  const rot = r() * TAU;
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU + (r() - 0.5) * 0.5;
    const rr = s * (0.65 + r() * 0.45);
    pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7);
  }
  // shadow
  g.save();
  g.translate(s * 0.15, s * 0.22);
  poly(g, pts, 'rgba(0,0,0,0.42)');
  g.restore();
  // body, lit from the upper left
  const gr = g.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
  gr.addColorStop(0, css(shade(col, 1.35)));
  gr.addColorStop(0.45, css(col));
  gr.addColorStop(1, css(shade(col, 0.55)));
  poly(g, pts, gr);
  if (lum) {
    g.save();
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
    g.clip();
    g.globalCompositeOperation = 'soft-light';
    g.globalAlpha = 0.7;
    g.drawImage(lum, cx - s * 2 + r() * s, cy - s * 2 + r() * s, s * 4, s * 4);
    g.restore();
  }
  // top facet highlight (a broken face catching the light)
  const m = 2 * Math.floor(r() * n);
  g.beginPath();
  g.moveTo(pts[m], pts[m + 1]);
  g.lineTo(cx - s * 0.1, cy - s * 0.15);
  g.lineTo(pts[(m + 2) % pts.length], pts[(m + 3) % pts.length]);
  g.closePath();
  g.fillStyle = css(shade(col, 1.45), 0.5);
  g.fill();
  // edge line
  g.strokeStyle = 'rgba(10,8,6,0.5)';
  g.lineWidth = 0.35;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.stroke();
}

export function rubble(def: WorldAssetDef, src: Sources, size: 'a' | 'b' | 'c'): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const r = rng(seed);
  const { g, w, h } = k;
  const lum = src.wall ? noiseFromImage(src.wall, 128) : noiseCanvas(128, 128, seed, 8, 8);
  const concrete = [pal(0x8a857c), pal(0x6e6860), pal(0x9a948a), pal(0x5a5650)];
  const brick = pal(0x7a4a3a);
  // dust skirt
  const dg = g.createRadialGradient(w / 2, h, 0, w / 2, h, w * 0.55);
  dg.addColorStop(0, css(pal(0x5a5044), 0.55));
  dg.addColorStop(1, css(pal(0x4a4238), 0));
  g.save();
  g.translate(w / 2, h);
  g.scale(1, 0.22);
  g.translate(-w / 2, -h);
  g.fillStyle = dg;
  g.fillRect(0, 0, w, h * 2);
  g.restore();
  // mound profile and chunks back to front
  const N = size === 'a' ? 16 : size === 'b' ? 26 : 40;
  const items: { x: number; y: number; s: number; col: number }[] = [];
  for (let i = 0; i < N; i++) {
    const t = r();
    const x = w * (0.08 + 0.84 * t);
    const peak = h * (1 - 0.9 * Math.pow(Math.sin(Math.PI * t), 0.8));
    const y = peak + (h - peak) * Math.pow(r(), 0.7);
    const s = (h * 0.12 + r() * h * 0.2) * (0.6 + 0.4 * (y / h));
    items.push({ x, y: Math.min(h - s * 0.4, y), s, col: r() < 0.15 ? brick : concrete[Math.floor(r() * concrete.length)] });
  }
  if (size === 'c') {
    // a broken slab leaning across the pile
    g.save();
    g.translate(w * 0.42, h * 0.38);
    g.rotate(-0.32);
    plate(g, -w * 0.3, -3, w * 0.55, 6, pal(0x7a756c), 0.8);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(-w * 0.3, 1.8, w * 0.55, 1.2);
    for (let x = -w * 0.28; x < w * 0.24; x += 5) { g.fillStyle = css(pal(0x6a3a22)); g.fillRect(x, 3, 0.6, 3 + (x % 3)); }
    g.restore();
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) chunk(g, r, it.x, it.y, it.s, it.col, lum);
  // rebar poking out
  const nb = size === 'a' ? 1 : size === 'b' ? 3 : 6;
  for (let i = 0; i < nb; i++) {
    const x = w * (0.2 + r() * 0.6), y = h * (0.35 + r() * 0.3);
    const pts = jag(x, y, x + (r() - 0.5) * w * 0.16, y - h * (0.14 + r() * 0.22), r, 0.8, 4);
    stroke(g, pts, 0.9, css(pal(0x3a2214)));
    stroke(g, pts.map((v, j) => (j % 2 ? v - 0.3 : v - 0.2)), 0.45, css(pal(0x9a5a34), 0.8));
  }
  if (size !== 'a') {
    // plank ends
    for (let i = 0; i < (size === 'c' ? 3 : 1); i++) {
      g.save();
      g.translate(w * (0.25 + r() * 0.5), h * (0.55 + r() * 0.25));
      g.rotate((r() - 0.5) * 0.8);
      plate(g, -10, -1.5, 20, 3, pal(0x6b4c2e), 0.5);
      g.restore();
    }
  }
  // fine debris
  for (let i = 0; i < N * 4; i++) { g.fillStyle = css(shade(concrete[i % 4], 0.6 + r() * 0.8)); const x = w * (0.05 + r() * 0.9); g.fillRect(x, h - r() * h * 0.2 - 0.5, 0.4 + r() * 0.9, 0.4 + r() * 0.6); }
  return finish(def, k, seed);
}

function noiseFromImage(img: HTMLImageElement, s: number): HTMLCanvasElement {
  const c = mk(s, s);
  const g = ctx(c);
  g.drawImage(img, 0, 0, img.width / 2, img.height / 2, 0, 0, s, s);
  const d = g.getImageData(0, 0, s, s);
  let mean = 0;
  for (let i = 0; i < d.data.length; i += 4) mean += d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11;
  mean /= d.data.length / 4;
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.max(0, Math.min(255, 128 + ((d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11) / mean - 1) * 200));
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  return c;
}

// =================================================================================================================================
// Timber
// =================================================================================================================================

const WOOD = 0x6b4c2e;

/** A rough timber: shaded across its width, grain along its length, a few cracks and knots. */
function timber(g: G, x: number, y: number, len: number, th: number, vertical: boolean, seed: number, col = pal(WOOD)): void {
  const grain = vertical ? noiseCanvas(32, 256, seed, 2, 28, 3) : noiseCanvas(256, 32, seed, 28, 2, 3);
  g.save();
  if (vertical) cylV(g, x, y, th, len, col, 1.3, 0.55); else cylH(g, x, y, len, th, col, 1.3, 0.55);
  g.beginPath();
  g.rect(x, y, vertical ? th : len, vertical ? len : th);
  g.clip();
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = 0.85;
  g.drawImage(grain, x, y, vertical ? th : len, vertical ? len : th);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  const r = rng(seed);
  for (let i = 0; i < 3; i++) {
    const t = 0.1 + r() * 0.8;
    const px = vertical ? x + th * (0.2 + r() * 0.6) : x + len * t, py = vertical ? y + len * t : y + th * (0.2 + r() * 0.6);
    const ex = vertical ? px + (r() - 0.5) * 0.6 : px + len * (0.08 + r() * 0.12), ey = vertical ? py + len * (0.08 + r() * 0.12) : py + (r() - 0.5) * 0.6;
    stroke(g, [px, py, ex, ey], 0.35, 'rgba(14,8,4,0.7)');
  }
  // a knot
  const kx = vertical ? x + th * 0.5 : x + len * (0.3 + r() * 0.4), ky = vertical ? y + len * (0.3 + r() * 0.4) : y + th * 0.5;
  g.fillStyle = 'rgba(30,18,10,0.6)';
  g.beginPath(); g.ellipse(kx, ky, vertical ? th * 0.16 : th * 0.3, vertical ? th * 0.3 : th * 0.16, 0, 0, TAU); g.fill();
  g.restore();
}

function strap(g: G, x: number, y: number, w: number, h: number): void {
  plate(g, x, y, w, h, pal(0x3a3632), 0.35);
  for (let t = x + 1.2; t < x + w; t += 3) rivet(g, t, y + h / 2, 0.5, pal(0x5a5650));
}

export function timberSet(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const { g, w, h } = k; // 64 x 72
  const post = 10, cap = 10;
  timber(g, 6, cap - 1, h - cap + 1, post, true, seed + 1);
  timber(g, w - 6 - post, cap - 1, h - cap + 1, post, true, seed + 2);
  timber(g, 0, 0, w, cap, false, seed + 3);
  // end grain on the cap
  for (const ex of [0.6, w - 0.6]) { g.fillStyle = css(shade(pal(WOOD), 1.25)); g.beginPath(); g.ellipse(ex, cap / 2, 0.6, cap / 2 - 0.4, 0, 0, TAU); g.fill(); }
  // wedges
  for (const wx of [6 + post / 2, w - 6 - post / 2]) poly(g, [wx - 4, cap, wx + 4, cap, wx + 2.5, cap + 2.6, wx - 2.5, cap + 2.6], css(shade(pal(WOOD), 1.2)));
  // iron straps at the joints
  strap(g, 4, cap - 2.6, post + 4, 2.4);
  strap(g, w - 8 - post, cap - 2.6, post + 4, 2.4);
  // foot blocks
  plate(g, 3, h - 3, post + 6, 3, shade(pal(WOOD), 0.8), 0.4);
  plate(g, w - 9 - post, h - 3, post + 6, 3, shade(pal(WOOD), 0.8), 0.4);
  // shadow under the cap between the posts
  const sg = g.createLinearGradient(0, cap, 0, cap + 8);
  sg.addColorStop(0, 'rgba(0,0,0,0.35)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = sg;
  g.fillRect(0, cap, w, 8);
  g.restore();
  return finish(def, k, seed);
}

export function timberPlanks(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const r = rng(seed);
  const { g, w, h } = k; // 56 x 16
  const rows = 4, ph = h / rows;
  for (let i = 0; i < rows; i++) {
    const y = h - (i + 1) * ph;
    const inset = i * 2 + r() * 3;
    const len = w - inset - r() * 4;
    const x = inset * (r() < 0.5 ? 0.3 : 1);
    timber(g, x, y + 0.2, len, ph - 0.4, false, seed + i, pal(shade(WOOD, 0.85 + r() * 0.3)));
    g.fillStyle = css(shade(pal(WOOD), 1.3));
    g.fillRect(x + len - 0.8, y + 0.4, 0.8, ph - 0.8);
  }
  return finish(def, k, seed);
}

export function timberBeam(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const r = rng(seed);
  const { g, w, h } = k; // 96 x 20
  g.save();
  g.translate(2, h - 2);
  g.rotate(-0.12);
  const th = 9, len = w - 12;
  timber(g, 0, -th, len, th, false, seed + 1);
  // splintered end: fresh pale fibres
  const ex = len;
  const spl: number[] = [ex - 1, -th];
  for (let i = 0; i <= 8; i++) spl.push(ex + (i % 2 ? 6 + r() * 6 : r() * 3), -th + (th * i) / 8);
  spl.push(ex - 1, 0);
  poly(g, spl, css(pal(0xa88a62)));
  for (let i = 0; i < 6; i++) stroke(g, [ex, -th + 1 + i * 1.4, ex + 4 + r() * 8, -th + 1 + i * 1.4 + (r() - 0.5)], 0.35, 'rgba(60,40,20,0.7)');
  // the clean end with a strap
  strap(g, 4, -th - 0.4, 3, th + 0.8);
  g.restore();
  return finish(def, k, seed);
}

// =================================================================================================================================
// Lamps (albedo + emissive)
// =================================================================================================================================

function bulb(g: G, eg: G, x: number, y: number, r: number, col: number, glowR: number): void {
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  gr.addColorStop(0, css(0xffffff));
  gr.addColorStop(0.5, css(mixHex(col, 0xffffff, 0.55)));
  gr.addColorStop(1, css(mixHex(col, 0x806040, 0.35)));
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  glow(eg, x, y, glowR, col, 1, 0.25);
  eg.fillStyle = css(mixHex(col, 0xffffff, 0.7));
  eg.beginPath(); eg.arc(x, y, r * 0.8, 0, TAU); eg.fill();
}

export function lampTube(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const { g, eg, w } = k; // 48 x 8, anchor top centre
  const steel = pal(0x8a8a84);
  plate(g, 0, 0, w, 2.6, steel, 0.4);
  plate(g, 1, 2.4, 1.6, 4.6, shade(steel, 0.8), 0.3);
  plate(g, w - 2.6, 2.4, 1.6, 4.6, shade(steel, 0.8), 0.3);
  for (const ty of [3.2, 5.4]) {
    const gr = g.createLinearGradient(0, ty, 0, ty + 1.6);
    gr.addColorStop(0, css(0xf4fffa));
    gr.addColorStop(1, css(0xa8c8bc));
    g.fillStyle = gr;
    g.fillRect(2.6, ty, w - 5.2, 1.6);
    eg.fillStyle = css(0xe8fff6);
    eg.fillRect(2.6, ty, w - 5.2, 1.6);
  }
  const eg2 = eg.createLinearGradient(0, 2, 0, 8);
  eg2.addColorStop(0, css(0xc8f0e0, 0.6));
  eg2.addColorStop(1, css(0xc8f0e0, 0));
  eg.fillStyle = eg2;
  eg.fillRect(1, 2.6, w - 2, 5.4);
  // cage wires
  for (let x = 4; x < w - 3; x += 4) stroke(g, [x, 2.6, x, 7.6], 0.3, css(shade(steel, 0.5)));
  stroke(g, [2, 7.6, w - 2, 7.6], 0.4, css(shade(steel, 0.6)));
  return finish(def, k, seed, 0.6);
}

export function lampChandelier(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const { g, eg, w } = k; // 100 x 84, anchor top centre (hook)
  const cx = w / 2;
  const brass = pal(0xb08a4a, 0.5, 0.08);
  // hook and chain
  g.strokeStyle = css(shade(brass, 0.9));
  g.lineWidth = 1;
  g.beginPath(); g.arc(cx, 1.6, 1.3, 0, TAU); g.stroke();
  for (let y = 3; y < 30; y += 2.6) {
    g.strokeStyle = css(shade(brass, (y / 2.6) % 2 < 1 ? 1.2 : 0.75));
    g.lineWidth = 0.55;
    g.beginPath(); g.ellipse(cx, y + 1.3, (y / 2.6) % 2 < 1 ? 0.9 : 0.4, 1.4, 0, 0, TAU); g.stroke();
  }
  // crown
  poly(g, [cx - 4, 30, cx + 4, 30, cx + 2.5, 34, cx - 2.5, 34], css(brass));
  const ringY = 64, rx = 46, ry = 8;
  // suspension rods to the ring
  for (const a of [Math.PI * 0.05, Math.PI * 0.5, Math.PI * 0.95, Math.PI * 1.25, Math.PI * 1.75]) {
    stroke(g, [cx, 33, cx + Math.cos(a) * rx, ringY + Math.sin(a) * ry], 0.45, css(shade(brass, 0.85)));
  }
  // back half of the ring (darker)
  g.strokeStyle = css(shade(brass, 0.55));
  g.lineWidth = 2.6;
  g.beginPath(); g.ellipse(cx, ringY, rx, ry, 0, Math.PI, TAU); g.stroke();
  // central stem and finial
  cylV(g, cx - 1.2, 33, 2.4, ringY - 33 + 6, brass);
  g.fillStyle = css(brass);
  g.beginPath(); g.ellipse(cx, ringY + 7, 3, 2.2, 0, 0, TAU); g.fill();
  poly(g, [cx - 1.5, ringY + 8.5, cx + 1.5, ringY + 8.5, cx, ringY + 13], css(shade(brass, 0.8)));
  // front half of the ring (lit), a second thin ring for richness
  const rg = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
  rg.addColorStop(0, css(shade(brass, 1.3)));
  rg.addColorStop(0.35, css(shade(brass, 1.55)));
  rg.addColorStop(0.7, css(brass));
  rg.addColorStop(1, css(shade(brass, 0.6)));
  g.strokeStyle = rg;
  g.lineWidth = 2.8;
  g.beginPath(); g.ellipse(cx, ringY, rx, ry, 0, 0, Math.PI); g.stroke();
  g.lineWidth = 0.7;
  g.strokeStyle = css(shade(brass, 1.7));
  g.beginPath(); g.ellipse(cx, ringY - 0.9, rx, ry, 0, 0.1, Math.PI - 0.1); g.stroke();
  // bulbs in cups on the front of the ring (the table's glow spots)
  for (const gs of def.glows ?? []) {
    const bx = cx + gs.x, by = gs.y;
    poly(g, [bx - 1.8, by + 1.2, bx + 1.8, by + 1.2, bx + 1.1, by + 3, bx - 1.1, by + 3], css(shade(brass, 1.1)));
    bulb(g, eg, bx, by - 0.8, 1.9, 0xffc27a, gs.r);
  }
  // a soft warm wash in the emissive under the ring (the lamp's own glow; the pool is the lighting system's)
  glow(eg, cx, ringY + 2, 40, 0xffc27a, 0.18, 0.4);
  return finish(def, k, seed, 0.7);
}

export function lampBulb(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const { g, eg, w } = k; // 6 x 10
  const cx = w / 2;
  stroke(g, [cx, 0, cx, 2], 0.5, css(0x14110e));
  plate(g, cx - 1.1, 1.6, 2.2, 2.4, pal(0x2a2622), 0.3);
  const L = def.lamps?.[0];
  bulb(g, eg, cx, (L?.y ?? 6.5), 2.4, 0xffd090, 3);
  return finish(def, k, seed, 0.5);
}

export function lampWork(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const { g, eg, w, h } = k; // 30 x 80, anchor bottom centre
  const cx = w / 2;
  const steel = pal(0x3a3a38), yel = pal(HAZARD, 0.55, 0.08);
  // tripod
  for (const dx of [-13, 13, -4]) stroke(g, [cx, h - 24, cx + dx, h - 0.6], dx === -4 ? 0.9 : 1.2, css(dx === -4 ? shade(steel, 0.7) : steel));
  plate(g, cx - 2, h - 26, 4, 3, shade(steel, 1.2), 0.3);
  // pole (yellow paint, chipped)
  cylV(g, cx - 1, 10, 2, h - 34, yel);
  // cable down the pole
  const cab: number[] = [];
  for (let y = 12; y < h - 2; y += 2) cab.push(cx + 1.6 + Math.sin(y * 0.4) * 0.6, y);
  cab.push(cx + 8, h - 0.5);
  stroke(g, cab, 0.6, css(0x14110e));
  // flood head, tilted toward -x (the cone direction of the table)
  const L = def.lamps?.[0];
  const hx = cx + (L?.x ?? 4), hy = h + (L?.y ?? -72);
  g.save();
  g.translate(hx, hy);
  g.rotate(-0.5);
  plate(g, -6, -4, 12, 7, steel, 0.6);
  for (let x = -5; x < 6; x += 1.6) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, -4, 0.6, 3); }
  const lg = g.createLinearGradient(-5, 3, 5, 3);
  lg.addColorStop(0, css(0xfff8e8)); lg.addColorStop(1, css(0xe8d8b0));
  g.fillStyle = lg;
  g.fillRect(-5, 2.4, 10, 1.6);
  g.restore();
  eg.save();
  eg.translate(hx, hy);
  eg.rotate(-0.5);
  eg.fillStyle = css(0xfff0d0);
  eg.fillRect(-5, 2.4, 10, 1.6);
  eg.restore();
  glow(eg, hx + 1, hy + 3, 9, 0xfff0d0, 0.6, 0.3);
  // yoke
  stroke(g, [cx, 10, hx - 2, hy + 1], 0.9, css(steel));
  wear(k.c, seed, pal(0x6a6258), 0.15, { cells: 10 });
  return finish(def, k, seed, 0.7);
}

export function lampCage(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const { g, eg, h } = k; // 12 x 16, anchor left middle
  const steel = pal(0x4a4a46);
  plate(g, 0, h / 2 - 5, 2.2, 10, steel, 0.4);
  stroke(g, [2, h / 2, 5, h / 2], 1.2, css(steel));
  const L = def.lamps?.[0];
  const bx = L?.x ?? 7, by = h / 2 + (L?.y ?? 2);
  plate(g, bx - 2.6, by - 5.5, 5.2, 2, shade(steel, 1.1), 0.3);
  bulb(g, eg, bx, by, 2.5, 0xffd8a0, 6);
  for (const dx of [-2.8, -1, 1, 2.8]) stroke(g, [bx + dx * 0.9, by - 3.5, bx + dx, by + 3], 0.35, css(shade(steel, 0.7)));
  stroke(g, [bx - 3, by + 3.2, bx + 3, by + 3.2], 0.45, css(shade(steel, 0.8)));
  return finish(def, k, seed, 0.6);
}

export function lampWall(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const { g, eg, w, h } = k; // 14 x 14, anchor centre
  const brass = pal(0xb08a4a, 0.5, 0.08);
  const cx = w / 2, cy = h / 2;
  g.fillStyle = css(brass);
  g.beginPath(); g.ellipse(cx, cy - 4, 2.6, 3.4, 0, 0, TAU); g.fill();
  stroke(g, [cx, cy - 3, cx, cy - 1], 0.8, css(shade(brass, 0.8)));
  // glass bell
  const L = def.lamps?.[0];
  const by = cy + (L?.y ?? 1);
  const gg = g.createRadialGradient(cx, by, 0.3, cx, by, 5);
  gg.addColorStop(0, css(0xfff4e0));
  gg.addColorStop(0.6, css(0xf0c890));
  gg.addColorStop(1, css(0xa07850));
  g.fillStyle = gg;
  g.beginPath(); g.moveTo(cx - 2, cy - 1.5); g.quadraticCurveTo(cx - 6, by + 3, cx - 5.4, by + 4); g.lineTo(cx + 5.4, by + 4); g.quadraticCurveTo(cx + 6, by + 3, cx + 2, cy - 1.5); g.closePath(); g.fill();
  g.fillStyle = css(shade(brass, 1.3));
  g.fillRect(cx - 5.4, by + 3.6, 10.8, 0.8);
  glow(eg, cx, by + 1, 7, 0xffc27a, 0.9, 0.3);
  return finish(def, k, seed, 0.6);
}

export function lampBeacon(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const { g, eg, w, h } = k; // 10 x 10, anchor bottom centre
  const cx = w / 2;
  plate(g, cx - 3.5, h - 3, 7, 3, pal(0x2a2826), 0.4);
  const L = def.lamps?.[0];
  const by = h + (L?.y ?? -6);
  const rg = g.createRadialGradient(cx - 1, by - 1, 0.2, cx, by, 3.4);
  rg.addColorStop(0, css(0xffd0c0));
  rg.addColorStop(0.4, css(0xe04030));
  rg.addColorStop(1, css(0x6a1410));
  g.fillStyle = rg;
  g.beginPath(); g.arc(cx, by, 3.2, Math.PI, 0); g.lineTo(cx + 3.2, h - 3); g.lineTo(cx - 3.2, h - 3); g.closePath(); g.fill();
  for (const dx of [-1.6, 0, 1.6]) stroke(g, [cx + dx, by - 3.1, cx + dx * 1.2, h - 3], 0.35, 'rgba(20,10,10,0.8)');
  glow(eg, cx, by, 5, 0xff3a2a, 1, 0.3);
  return finish(def, k, seed, 0.6);
}

export function lampLantern(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const { g, eg, w } = k; // 10 x 16, anchor top centre
  const cx = w / 2;
  const iron = pal(0x3a3632);
  g.strokeStyle = css(iron);
  g.lineWidth = 0.6;
  g.beginPath(); g.arc(cx, 4, 3.6, Math.PI, 0); g.stroke();
  poly(g, [cx - 3, 4, cx + 3, 4, cx + 2, 5.6, cx - 2, 5.6], css(iron));
  // globe
  const L = def.lamps?.[0];
  const fy = L?.y ?? 10;
  const gg = g.createRadialGradient(cx, fy, 0.2, cx, fy, 3.6);
  gg.addColorStop(0, css(0xfff0c0));
  gg.addColorStop(0.5, css(0xe8a050));
  gg.addColorStop(1, css(0x7a5030));
  g.fillStyle = gg;
  g.beginPath(); g.ellipse(cx, fy, 3.2, 4, 0, 0, TAU); g.fill();
  for (const dx of [-3.4, 3.4]) stroke(g, [cx + dx * 0.8, 5.6, cx + dx, fy, cx + dx * 0.8, 14], 0.45, css(iron));
  plate(g, cx - 3.4, 13.6, 6.8, 2.4, iron, 0.3);
  // flame
  g.fillStyle = css(0xfff4d0);
  g.beginPath(); g.ellipse(cx, fy + 0.4, 0.7, 1.5, 0, 0, TAU); g.fill();
  glow(eg, cx, fy, 6, 0xffcc80, 1, 0.3);
  return finish(def, k, seed, 0.6);
}

// =================================================================================================================================
// Foreground silhouettes (near-black with a faint warm rim on the upper-left edges; drawn untinted)
// =================================================================================================================================

const FORE_BODY = 0x0b0a0a;
const FORE_RIM = 0x4a3a2e;

/** Adds the rim: the silhouette minus itself shifted down-right, painted in the rim colour. */
function foreRim(def: WorldAssetDef, c: HTMLCanvasElement, px = 2.5): void {
  const s = mk(c.width, c.height);
  const sg = ctx(s);
  sg.drawImage(c, 0, 0);
  sg.globalCompositeOperation = 'destination-out';
  sg.drawImage(c, px, px);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = css(FORE_RIM, 0.9);
  sg.fillRect(0, 0, s.width, s.height);
  const g = ctx(c);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(s, 0, 0);
  g.restore();
  void def;
}

function foreNoise(def: WorldAssetDef, c: HTMLCanvasElement, seed: number): void {
  const g = ctx(c);
  const n = noiseCanvas(Math.round(c.width / 3), Math.round(c.height / 3), seed, 6, 6, 4);
  const t = mk(c.width, c.height);
  const tg = ctx(t);
  tg.drawImage(n, 0, 0, c.width, c.height);
  tg.globalCompositeOperation = 'destination-in';
  tg.drawImage(c, 0, 0);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 0.12;
  g.globalCompositeOperation = 'screen';
  g.drawImage(t, 0, 0);
  g.restore();
  void def;
}

export function foreOutcrop(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const r = rng(seed);
  const { g, w, h } = k;
  const pts: number[] = [0, h];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.03)), 0.55);
    // two peaks, ridged detail and sharp chips: rock, not a hill
    const peaks = 0.55 + 0.45 * Math.max(Math.exp(-Math.pow((t - 0.38) / 0.16, 2)), 0.7 * Math.exp(-Math.pow((t - 0.7) / 0.12, 2)));
    const ridg = fbm(t, 0.5, { seed, cx: 9, cy: 1, oct: 4, periodic: false, ridged: true });
    const y = h - h * env * peaks * (0.7 + 0.3 * ridg) + (r() - 0.5) * 7 + (i % 7 === 3 ? 6 : 0);
    pts.push(w * t, Math.min(h, y));
  }
  pts.push(w, h);
  poly(g, pts, css(FORE_BODY));
  // a few inner ledges
  for (let i = 0; i < 4; i++) {
    const x = w * (0.2 + r() * 0.6), y = h * (0.45 + r() * 0.4);
    stroke(g, jag(x, y, x + 30 + r() * 40, y + (r() - 0.5) * 10, r, 3, 6), 1.2, css(0x1a1614));
  }
  foreNoise(def, k.c, seed);
  foreRim(def, k.c);
  return { albedo: k.c };
}

export function forePipes(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const { g, w, h } = k; // 60 x 380, hang from the top
  const body = FORE_BODY;
  for (const [x, d] of [[6, 22], [34, 16]] as const) {
    cylV(g, x, 0, d, h, shade(body, 1.8), 1.6, 0.6);
    for (let y = 60; y < h; y += 140) cylV(g, x - 2, y, d + 4, 6, shade(body, 2.2), 1.5, 0.6);
  }
  // clamp across both
  g.fillStyle = css(shade(body, 2));
  g.fillRect(2, 200, w - 4, 7);
  foreRim(def, k.c);
  return { albedo: k.c };
}

export function foreCable(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const r = rng(seed);
  const { g, w, h } = k; // 480 x 70
  for (let i = 0; i < 3; i++) {
    const sag = h * (0.62 + i * 0.12);
    const pts: number[] = [];
    for (let x = 0; x <= w; x += 6) { const t = x / w; pts.push(x, 3 + i * 2 + sag * (1 - Math.pow(2 * t - 1, 2))); }
    stroke(g, pts, 2.6 + r() * 1.6, css(shade(FORE_BODY, 1.2)));
  }
  // ties
  for (let t = 0.2; t < 0.9; t += 0.2) {
    const x = w * t, y = 3 + h * 0.7 * (1 - Math.pow(2 * t - 1, 2));
    g.fillStyle = css(shade(FORE_BODY, 2.2));
    g.fillRect(x - 1.5, y - 2, 3, h * 0.12);
  }
  foreRim(def, k.c, 1.5);
  return { albedo: k.c };
}

export function forePipeH(def: WorldAssetDef): Baked {
  const k = begin(def);
  const seed = hashStr(def.id);
  const { g, w, h } = k; // 480 x 50
  cylH(g, 0, h * 0.18, w, h * 0.38, shade(FORE_BODY, 1.8), 1.6, 0.6);
  cylH(g, 0, h * 0.62, w, h * 0.24, shade(FORE_BODY, 1.6), 1.6, 0.6);
  for (let x = 40; x < w; x += 160) {
    cylH(g, x, h * 0.12, 6, h * 0.5, shade(FORE_BODY, 2.2), 1.5, 0.6);
    g.fillStyle = css(shade(FORE_BODY, 1.6));
    g.fillRect(x + 1, 0, 2, h * 0.18);
  }
  foreRim(def, k.c);
  void seed;
  return { albedo: k.c };
}

export { smooth };

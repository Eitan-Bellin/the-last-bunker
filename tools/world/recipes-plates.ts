/**
 * World kit recipes, part 2: the depth plates (far, back) and the foreground lip. Plates tile sideways; their windows and fires are
 * painted twice, dim in the albedo and bright in the emissive mask.
 */
import type { WorldAssetDef } from '../../src/world/tokensAssets';
import { blackUnder, type Baked } from './recipes-surfaces';
import { css, ctx, cylH, fbm, glow, grainPass, hashStr, jag, mixHex, mk, pal, poly, rng, scaled, shade, smooth, stroke, type G, type RNG } from './paint';

const TAU = Math.PI * 2;

/** Draws `fn` three times (x - W, x, x + W) so whatever it paints tiles sideways. */
function wrapX(g: G, W: number, fn: () => void): void {
  for (const ox of [-W, 0, W]) { g.save(); g.translate(ox, 0); fn(); g.restore(); }
}

/** A periodic ridge line: y at x (0..W) from periodic fbm. */
function ridge(W: number, seed: number, base: number, amp: number, cells: number, step = 4): number[] {
  const pts: number[] = [];
  for (let x = 0; x <= W; x += step) pts.push(x, base - (fbm(x / W, 0.5, { seed, cx: cells, cy: 1, oct: 5 }) - 0.5) * 2 * amp);
  return pts;
}
/** Terraced (stepped) version of a ridge: flat ledges with vertical risers. */
function terrace(W: number, seed: number, base: number, amp: number, cells: number, ledge: number): number[] {
  const pts: number[] = [];
  for (let x = 0; x <= W; x += ledge) {
    const y = base - Math.round((fbm(x / W, 0.5, { seed, cx: cells, cy: 1, oct: 3 }) - 0.5) * 2 * amp / 8) * 8;
    pts.push(x, y, Math.min(W, x + ledge), y);
  }
  return pts;
}
function fillBelow(g: G, pts: number[], Hh: number, fill: string | CanvasGradient): void {
  poly(g, [...pts, pts[pts.length - 2], Hh + 2, pts[0], Hh + 2], fill);
}

interface Window { x: number; y: number; w: number; h: number; lit: number; col: number }

/** A row of small dwellings standing on a terrace line. Windows are collected for the emissive pass. */
function dwellings(g: G, r: RNG, line: number[], body: number, wins: Window[], scale: number, density: number, warm: boolean): void {
  for (let i = 0; i < line.length - 2; i += 4) {
    const x0 = line[i], y = line[i + 1], x1 = line[i + 2];
    let x = x0 + r() * 6 * scale;
    while (x < x1 - 10 * scale) {
      if (r() > density) { x += (8 + r() * 14) * scale; continue; }
      const w = (12 + r() * 26) * scale, h = (10 + r() * 22) * scale;
      const bx = x, by = y - h;
      const tone = 0.85 + r() * 0.3;
      g.fillStyle = css(shade(body, tone));
      g.fillRect(bx, by, w, h);
      // lit roof edge and a parapet
      g.fillStyle = css(shade(body, tone * 1.45));
      g.fillRect(bx, by, w, Math.max(1, scale));
      if (r() < 0.4) { g.fillStyle = css(shade(body, tone * 0.8)); g.fillRect(bx + w * 0.6, by - 3 * scale, 2 * scale, 3 * scale); }
      // shaded side
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(bx + w - 2 * scale, by, 2 * scale, h);
      const nW = Math.max(1, Math.floor(w / (7 * scale)));
      const rows = Math.max(1, Math.floor(h / (9 * scale)));
      for (let ry = 0; ry < rows; ry++) for (let k = 0; k < nW; k++) {
        if (r() < 0.35) continue;
        const wx = bx + (k + 0.5) * (w / nW) - 1.2 * scale, wy = by + (ry + 0.45) * (h / rows) - 1.5 * scale;
        const col = warm ? [0xffd8a0, 0xffc27a, 0xffb066, 0xffcc80][Math.floor(r() * 4)] : 0xffffff;
        wins.push({ x: wx, y: wy, w: 2.4 * scale, h: 3 * scale, lit: 0.35 + r() * 0.65, col });
      }
      if (r() < 0.5) wins.push({ x: bx + w * 0.2, y: y - 6 * scale, w: 3 * scale, h: 6 * scale, lit: 0.3 + r() * 0.5, col: warm ? 0xffc27a : 0xffffff });
      x += w + (2 + r() * 10) * scale;
    }
  }
}

function paintWindows(g: G, e: G, wins: Window[], W: number, dim: number): void {
  for (const wn of wins) {
    wrapX(g, W, () => { g.fillStyle = css(mixHex(0x1a1410, wn.col, 0.18 * wn.lit * dim)); g.fillRect(wn.x, wn.y, wn.w, wn.h); });
    wrapX(e, W, () => {
      const big = Math.max(wn.w, wn.h) > 8;
      glow(e, wn.x + wn.w / 2, wn.y + wn.h / 2, Math.min(14, Math.max(wn.w, wn.h) * 2.4), wn.col, (big ? 0.12 : 0.22) * wn.lit);
      e.fillStyle = css(wn.col, (big ? 0.55 : 0.95) * wn.lit);
      e.fillRect(wn.x, wn.y, wn.w, wn.h);
    });
  }
}

/** Fades the top of a plate into transparency (the plate dissolves into the cavern dark above). */
function fadeTop(c: HTMLCanvasElement, y0: number, y1: number): void {
  const g = ctx(c);
  g.save();
  g.globalCompositeOperation = 'destination-in';
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gr;
  g.fillRect(0, 0, c.width, c.height);
  g.restore();
}

function haze(g: G, W: number, y: number, h: number, col: number, a: number): void {
  const gr = g.createLinearGradient(0, y - h, 0, y + h);
  gr.addColorStop(0, css(col, 0));
  gr.addColorStop(0.5, css(col, a));
  gr.addColorStop(1, css(col, 0));
  g.fillStyle = gr;
  g.fillRect(0, y - h, W, h * 2);
}

/** Far plate: three cliff layers, a colossal pillar, terraced dwellings with windows. `warm` = Upper Shelter, else neutral (tinted). */
export function farPlate(def: WorldAssetDef, warm: boolean): Baked {
  const [W, Hh] = def.px;
  const seed = hashStr(def.id);
  const r = rng(seed);
  const c = mk(W, Hh);
  const g = ctx(c);
  const em = mk(W, Hh);
  const e = ctx(em);
  const fog = warm ? pal(0x4a4036) : pal(0x8a8a88, 0, 0);
  const back = warm ? pal(0x342c25) : pal(0x6a6a6a, 0, 0);
  const mid = warm ? pal(0x221c17) : pal(0x555555, 0, 0);
  const front = warm ? pal(0x17130f) : pal(0x404040, 0, 0);
  // cavern air
  const air = g.createLinearGradient(0, 0, 0, Hh);
  air.addColorStop(0, css(shade(fog, 0.6)));
  air.addColorStop(0.7, css(fog));
  air.addColorStop(1, css(shade(fog, 0.85)));
  g.fillStyle = air;
  g.fillRect(0, 0, W, Hh);
  // layer A: far cliffs
  const wins: Window[] = [];
  const la = ridge(W, seed + 1, Hh * 0.38, Hh * 0.14, 3);
  fillBelow(g, la, Hh, css(back));
  stroke(g, la, 1.2, css(shade(back, 1.5), 0.6));
  // colossal pillar(s)
  for (const px of [W * 0.28, W * 0.78]) {
    const pw = 54 + r() * 30;
    const gr = g.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0);
    gr.addColorStop(0, css(shade(mid, 1.35)));
    gr.addColorStop(0.35, css(shade(mid, 1.1)));
    gr.addColorStop(1, css(shade(mid, 0.6)));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(px - pw / 2, 0);
    g.bezierCurveTo(px - pw * 0.42, Hh * 0.3, px - pw * 0.4, Hh * 0.6, px - pw * 0.9, Hh);
    g.lineTo(px + pw * 0.9, Hh);
    g.bezierCurveTo(px + pw * 0.4, Hh * 0.6, px + pw * 0.42, Hh * 0.3, px + pw / 2, 0);
    g.closePath();
    g.fill();
    // ribs of strata on the pillar
    for (let k = 0; k < 8; k++) { const y = (k + r()) * Hh / 9; g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(px - pw / 2, y, pw, 1.5); }
    // a far lift cage on its face with a lamp
    if (warm || r() < 0.5) {
      const ly = Hh * (0.3 + r() * 0.3);
      g.fillStyle = css(shade(mid, 0.7));
      g.fillRect(px - 1, 0, 2, Hh);
      g.fillStyle = css(shade(mid, 1.6));
      g.fillRect(px - 4, ly, 8, 6);
      wins.push({ x: px - 3, y: ly + 1.5, w: 6, h: 3, lit: 0.9, col: warm ? 0xffd8a0 : 0xffffff });
    }
  }
  haze(g, W, Hh * 0.45, Hh * 0.1, fog, 0.55);
  // layer B: terraced districts
  const tb = terrace(W, seed + 2, Hh * 0.62, Hh * 0.12, 4, 64);
  fillBelow(g, tb, Hh, css(mid));
  dwellings(g, r, tb, shade(mid, 1.25), wins, 1, 0.85, warm);
  const tb2 = terrace(W, seed + 4, Hh * 0.5, Hh * 0.1, 3, 96);
  dwellings(g, r, tb2, shade(back, 1.15), wins, 0.75, 0.5, warm);
  haze(g, W, Hh * 0.72, Hh * 0.08, fog, 0.4);
  // layer C: near cliff foot with a few houses
  const lc = terrace(W, seed + 3, Hh * 0.86, Hh * 0.06, 5, 128);
  fillBelow(g, lc, Hh, css(front));
  dwellings(g, r, lc, shade(front, 1.4), wins, 1.3, 0.55, warm);
  paintWindows(g, e, wins, W, 1);
  fadeTop(c, 0, Hh * 0.18);
  grainPass(c, seed + 9, 0.1, 0.4);
  const es = def.emissive && def.emissive !== true ? def.emissive.scale : 0.5;
  return { albedo: c, emissive: scaled(blackUnder(em), W * es, Hh * es) };
}

/** Back plate: tiers of galleries with arches, railings, doorways and pipe runs. */
export function backGalleries(def: WorldAssetDef): Baked {
  const [W, Hh] = def.px; // 1024 x 512, 1536 u
  const seed = hashStr(def.id);
  const r = rng(seed);
  const c = mk(W, Hh);
  const g = ctx(c);
  const em = mk(W, Hh);
  const e = ctx(em);
  const conc = pal(0x3e3832), dark = pal(0x1c1815), green = pal(0x34402f), steel = pal(0x2e2e2c);
  const wins: Window[] = [];
  g.fillStyle = css(shade(dark, 0.9));
  g.fillRect(0, 0, W, Hh);
  const tiers = [Hh * 0.2, Hh * 0.47, Hh * 0.74];
  const bayW = 128;
  for (let t = 0; t < tiers.length; t++) {
    const y = tiers[t], tierH = Hh * 0.27;
    // back wall of the tier
    const wg = g.createLinearGradient(0, y - tierH, 0, y);
    wg.addColorStop(0, css(shade(conc, 0.7)));
    wg.addColorStop(1, css(shade(conc, 1.0)));
    g.fillStyle = wg;
    g.fillRect(0, y - tierH, W, tierH);
    g.fillStyle = css(green);
    g.fillRect(0, y - tierH * 0.32, W, tierH * 0.32);
    // arcade: bays of varied width (summing to the tile width, so it still tiles); arches, bricked-up arches and square doorways
    const bays: number[] = [];
    let sum = 0;
    while (sum < W) { const bw = [96, 128, 128, 160][Math.floor(r() * 4)]; bays.push(bw); sum += bw; }
    bays[bays.length - 1] -= sum - W;
    let bx0 = (t * 48) % 64;
    for (const bayW of bays) {
      const kind = r();
      const bx = bx0 + 16, bw = bayW - 32, top = y - tierH * (0.8 + r() * 0.08), rad = bw / 2;
      wrapX(g, W, () => {
        if (kind < 0.18) {
          // bricked-up arch: a lighter infill with courses
          g.fillStyle = css(shade(conc, 0.85));
          g.beginPath(); g.moveTo(bx, y); g.lineTo(bx, top + rad); g.arc(bx + rad, top + rad, rad, Math.PI, 0); g.lineTo(bx + bw, y); g.closePath(); g.fill();
          for (let cy = y - 4; cy > top; cy -= 4) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(bx, cy, bw, 0.8); }
        } else if (kind < 0.36) {
          // square doorway with an awning
          const dw = bw * 0.55, dx = bx + (bw - dw) / 2, dh = tierH * 0.55;
          g.fillStyle = css(shade(dark, 0.75));
          g.fillRect(dx, y - dh, dw, dh);
          g.fillStyle = css(pal(0x5a3a2a));
          g.fillRect(dx - 4, y - dh - 4, dw + 8, 4);
          wins.push({ x: dx + 2, y: y - dh + 2, w: dw - 4, h: dh - 2, lit: 0.3 + r() * 0.6, col: 0xffc27a });
        } else {
          g.fillStyle = css(shade(dark, 0.7));
          g.beginPath(); g.moveTo(bx, y); g.lineTo(bx, top + rad); g.arc(bx + rad, top + rad, rad, Math.PI, 0); g.lineTo(bx + bw, y); g.closePath(); g.fill();
          g.fillStyle = css(shade(conc, 1.35), 0.8);
          g.fillRect(bx + bw - 3, top + rad, 3, y - top - rad);
        }
        // pier
        g.fillStyle = css(shade(conc, 1.1 + r() * 0.1));
        g.fillRect(bx0, y - tierH, 16, tierH);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(bx0 + 13, y - tierH, 3, tierH);
      });
      if (kind >= 0.36 && r() < 0.6) {
        const dw = 10 + r() * 10, dh = 20 + r() * 12, dx = bx + rad - dw / 2 + (r() - 0.5) * bw * 0.3;
        wrapX(g, W, () => {
          g.fillStyle = css(pal(0x3a2a1c));
          g.fillRect(dx, y - dh, dw, dh);
          const sp = g.createRadialGradient(dx + dw / 2, y, 0, dx + dw / 2, y, 30);
          sp.addColorStop(0, 'rgba(255,190,120,0.18)');
          sp.addColorStop(1, 'rgba(255,190,120,0)');
          g.fillStyle = sp;
          g.fillRect(dx - 30, y - 30, dw + 60, 30);
        });
        wins.push({ x: dx + 1, y: y - dh + 1, w: dw - 2, h: dh - 2, lit: 0.5 + r() * 0.5, col: [0xffd8a0, 0xffc27a, 0xffb066][Math.floor(r() * 3)] });
      }
      // laundry line or a hanging lamp across some bays
      if (r() < 0.25) {
        const ly = top + rad * 0.9;
        const pts: number[] = [];
        for (let k2 = 0; k2 <= 10; k2++) { const q = k2 / 10; pts.push(bx + bw * q, ly + Math.sin(q * Math.PI) * 6); }
        wrapX(g, W, () => {
          stroke(g, pts, 0.8, 'rgba(10,8,6,0.9)');
          for (let k2 = 1; k2 < 9; k2 += 2) { g.fillStyle = css(pal([0x8a7d5e, 0x5d6b58, 0x7a5a48][k2 % 3])); g.fillRect(pts[k2 * 2], pts[k2 * 2 + 1], 5, 7 + r() * 4); }
        });
      }
      bx0 += bayW;
    }
    // slab, railing, pipe run under the slab
    g.fillStyle = css(shade(conc, 1.25));
    g.fillRect(0, y, W, 6);
    g.fillStyle = css(shade(conc, 0.55));
    g.fillRect(0, y + 6, W, 5);
    for (let x = 0; x < W; x += 16) { g.fillStyle = css(steel); g.fillRect(x, y - 14, 1.5, 14); }
    g.fillStyle = css(shade(steel, 1.6));
    g.fillRect(0, y - 14, W, 1.6);
    g.fillRect(0, y - 7, W, 1);
    cylH(g, 0, y + 12, W, 5, pal(0x4a463e));
    cylH(g, 0, y + 19, W, 3, pal(0x5a3a2a));
    // slab lamps (small warm points under the slab)
    for (let x = 64; x < W; x += 128) wins.push({ x: x - 1.5, y: y + 11, w: 3, h: 2, lit: 0.8, col: 0xffc27a });
  }
  // a stair between tiers
  for (let t = 0; t < tiers.length - 1; t++) {
    const sx = (t * 2 + 1) * bayW * 1.5 + 30;
    const y0 = tiers[t + 1], y1 = tiers[t];
    stroke(g, [sx, y0, sx + 90, y1], 4, css(shade(steel, 1.3)));
    for (let k = 0; k < 9; k++) { const tt = k / 9; g.fillStyle = css(shade(steel, 1.6)); g.fillRect(sx + 90 * tt, y0 + (y1 - y0) * tt - 2, 9, 1.4); }
  }
  paintWindows(g, e, wins, W, 1.2);
  fadeTop(c, 0, Hh * 0.08);
  grainPass(c, seed + 9, 0.1, 0.4);
  const es = def.emissive && def.emissive !== true ? def.emissive.scale : 0.5;
  return { albedo: c, emissive: scaled(blackUnder(em), W * es, Hh * es) };
}

/** Back plate: a pipe rack (transparent around it). */
export function backPipes(def: WorldAssetDef): Baked {
  const [W, Hh] = def.px; // 1024 x 256
  const seed = hashStr(def.id);
  const r = rng(seed);
  const c = mk(W, Hh);
  const g = ctx(c);
  const steel = pal(0x55524a), red = pal(0x8a3a2a, 0.55, 0.1), ins = pal(0x8a8270);
  // supports every 256 px (I-beams)
  for (let x = 96; x < W; x += 256) {
    g.fillStyle = css(shade(steel, 0.8));
    g.fillRect(x, 20, 12, Hh - 20);
    g.fillStyle = css(shade(steel, 1.3));
    g.fillRect(x, 20, 3, Hh - 20);
    g.fillStyle = css(shade(steel, 0.5));
    g.fillRect(x + 10, 20, 2, Hh - 20);
    g.fillStyle = css(shade(steel, 1.1));
    g.fillRect(x - 6, 20, 24, 4);
  }
  // cable tray on top with sagging cables
  g.fillStyle = css(shade(steel, 0.9));
  g.fillRect(0, 20, W, 5);
  for (let k = 0; k < 3; k++) {
    const pts: number[] = [];
    for (let x = 0; x <= W; x += 8) pts.push(x, 26 + k * 3 + Math.abs(Math.sin((x / 256) * Math.PI)) * (6 + k * 3));
    stroke(g, pts, 2.2, css(pal(0x1a1816)));
  }
  // pipes
  const runs = [{ y: 52, d: 26, col: ins, lag: true }, { y: 92, d: 18, col: steel, lag: false }, { y: 124, d: 12, col: red, lag: false }, { y: 150, d: 30, col: pal(0x4a4a44), lag: false }, { y: 196, d: 14, col: steel, lag: false }];
  for (const p of runs) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, p.y + p.d, W, 3);
    cylH(g, 0, p.y, W, p.d, p.col);
    if (p.lag) for (let x = 0; x < W; x += 32) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, p.y, 1.5, p.d); }
    // flanges
    for (let x = (r() * 128) | 0; x < W; x += 128 + ((r() * 2) | 0) * 128) {
      cylH(g, x, p.y - 3, 7, p.d + 6, shade(p.col, 1.1));
      for (let k = 0; k < 3; k++) { g.fillStyle = css(shade(p.col, 1.6)); g.fillRect(x + 2, p.y - 2 + k * (p.d + 4) / 2, 3, 2); }
    }
  }
  // valve wheels on the red line
  for (let x = 180; x < W; x += 340) {
    g.strokeStyle = css(red);
    g.lineWidth = 3;
    g.beginPath(); g.arc(x, 112, 9, 0, TAU); g.stroke();
    g.strokeStyle = css(shade(red, 1.5));
    g.lineWidth = 1;
    g.beginPath(); g.arc(x - 0.6, 111.4, 9, Math.PI, Math.PI * 1.6); g.stroke();
    stroke(g, [x - 9, 112, x + 9, 112], 1.5, css(shade(red, 0.8)));
    stroke(g, [x, 103, x, 121], 1.5, css(shade(red, 0.8)));
    g.fillStyle = css(shade(steel, 0.8));
    g.fillRect(x - 2, 112, 4, 12);
  }
  // gauges
  for (let x = 400; x < W; x += 512) {
    g.fillStyle = css(shade(steel, 0.6)); g.fillRect(x - 1, 70, 2, 22);
    g.fillStyle = css(pal(0xd8d0b8)); g.beginPath(); g.arc(x, 66, 6, 0, TAU); g.fill();
    g.strokeStyle = css(shade(steel, 0.6)); g.lineWidth = 1.5; g.stroke();
    stroke(g, [x, 66, x + 3, 62], 1, 'rgba(20,10,10,0.9)');
  }
  grainPass(c, seed + 9, 0.12, 0.3);
  fadeEdgesV(c, 16, 0);
  return { albedo: c };
}

function fadeEdgesV(c: HTMLCanvasElement, top: number, bottom: number): void {
  const g = ctx(c);
  g.save();
  g.globalCompositeOperation = 'destination-in';
  const gr = g.createLinearGradient(0, 0, 0, c.height);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(Math.min(0.49, top / c.height), 'rgba(0,0,0,1)');
  gr.addColorStop(1 - Math.min(0.49, bottom / c.height), 'rgba(0,0,0,1)');
  gr.addColorStop(1, bottom ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
  g.fillStyle = gr;
  g.fillRect(0, 0, c.width, c.height);
  g.restore();
}

/** Back plate, surface: the ruined skyline with the radio mast (beacon at the glow spot of the table). */
export function backSurface(def: WorldAssetDef): Baked {
  const [W, Hh] = def.px; // 1024 x 256 at 0.5 px/u
  const P = def.ppu;
  const seed = hashStr(def.id);
  const r = rng(seed);
  const c = mk(W, Hh);
  const g = ctx(c);
  const em = mk(W, Hh);
  const e = ctx(em);
  const body = pal(0x2a201a), lit = pal(0xb8784a, 0.5, 0.1), far = pal(0x4a3a30);
  const wins: Window[] = [];
  // far row of blocks (lighter, hazy)
  let x = 0;
  while (x < W) {
    const w = 30 + r() * 70, h = 40 + r() * 90;
    g.fillStyle = css(far);
    g.fillRect(x, Hh - h - 20, w, h + 20);
    x += w + r() * 20;
  }
  // near ruins with broken tops and see-through window holes
  x = 0;
  const blocks: { x: number; w: number; h: number }[] = [];
  while (x < W - 20) {
    const w = 40 + r() * 90, h = 50 + r() * 120;
    blocks.push({ x, w, h });
    x += w + 6 + r() * 30;
  }
  for (const b of blocks) {
    const top: number[] = [];
    const steps = Math.max(3, Math.round(b.w / 10));
    for (let k = 0; k <= steps; k++) top.push(b.x + (b.w * k) / steps, Hh - b.h + (k === 0 || k === steps ? 0 : r() * 26 * (r() < 0.5 ? 1 : 0.3)));
    poly(g, [...top, b.x + b.w, Hh, b.x, Hh], css(body));
    stroke(g, top, 1.4, css(lit, 0.5));
    // floors and window holes
    for (let fy = Hh - b.h + 18; fy < Hh - 10; fy += 16) {
      for (let wx = b.x + 6; wx < b.x + b.w - 8; wx += 12) {
        const v = r();
        if (v < 0.35) { g.clearRect(wx, fy, 5, 7); }
        else if (v < 0.42) wins.push({ x: wx, y: fy, w: 5, h: 7, lit: 0.6 + r() * 0.4, col: 0xff7a2a });
        else { g.fillStyle = css(shade(body, 0.6)); g.fillRect(wx, fy, 5, 7); }
      }
    }
  }
  // rubble mound along the base
  const base = jag(-10, Hh - 14, W + 10, Hh - 12, r, 6, 60);
  poly(g, [...base, W + 10, Hh, -10, Hh], css(shade(body, 0.9)));
  // radio mast with the beacon (glow spot of the table: x 1556 u, y -398 u from the bottom)
  const gs = def.glows?.[0] ?? { x: 1556, y: -398, r: 30 };
  const mx = gs.x * P, my = Hh + gs.y * P;
  g.strokeStyle = css(shade(body, 1.4));
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(mx - 10, Hh - 30); g.lineTo(mx, my); g.lineTo(mx + 10, Hh - 30);
  for (let y = Hh - 30; y > my + 6; y -= 12) { const k = (y - my) / (Hh - 30 - my) * 10; g.moveTo(mx - k, y); g.lineTo(mx + k * 0.8, y - 12); }
  g.stroke();
  g.fillStyle = css(pal(0x6a1a14));
  g.beginPath(); g.arc(mx, my, 2.6, 0, TAU); g.fill();
  glow(e, mx, my, 10, 0xff3a2a, 0.9);
  // a sagging power line
  const pl: number[] = [];
  for (let k = 0; k <= 40; k++) { const t = k / 40; pl.push(t * W, Hh - 90 + Math.sin(t * Math.PI * 4) ** 2 * 18); }
  stroke(g, pl, 1, css(0x0e0b0a, 0.8));
  paintWindows(g, e, wins, W, 1.4);
  grainPass(c, seed + 9, 0.1, 0.4);
  const es = def.emissive && def.emissive !== true ? def.emissive.scale : 0.5;
  return { albedo: c, emissive: scaled(blackUnder(em), W * es, Hh * es) };
}

/** Foreground rock lip: near-black ragged band hanging from the top, a faint warm rim on its lower edge. */
export function foreLip(def: WorldAssetDef): Baked {
  const [W, Hh] = def.px;
  const seed = hashStr(def.id);
  const c = mk(W, Hh);
  const g = ctx(c);
  const img = g.createImageData(W, Hh);
  for (let x = 0; x < W; x++) {
    const u = x / W;
    const edge = Hh * (0.42 + (fbm(u, 0.5, { seed, cx: 5, cy: 1, oct: 6 }) - 0.5) * 0.7 + smooth(0.6, 0.8, fbm(u, 0.3, { seed: seed + 1, cx: 12, cy: 1, oct: 3 })) * 0.25);
    for (let y = 0; y < Hh; y++) {
      const i = (y * W + x) * 4;
      const d = edge - y;
      if (d < -0.8) continue;
      const a = smooth(-0.8, 0.8, d);
      const rim = Math.exp(-Math.max(0, d) / 2.2) * 0.9;
      const n = fbm(u, y / Hh, { seed: seed + 2, cx: 16, cy: 2, oct: 4 });
      const base = 8 + n * 10;
      img.data[i] = base + rim * 58;
      img.data[i + 1] = base * 0.92 + rim * 44;
      img.data[i + 2] = base * 0.9 + rim * 32;
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { albedo: c };
}

export { smooth };

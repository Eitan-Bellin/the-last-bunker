import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { T } from './tokens';
import { DISTRICT, HUB, ROOM_H, catenary, dwellings, holes, strings, type Hole } from './scene';
import { R, mix, noise1, pick, rng, rr, scale } from './util';
import { noise2 } from './textures';

const P = T.palette;
const W = T.world.width, H = T.world.height, G = T.world.groundY;

export const groundNoise = noise1(41);
export const groundY = (x: number) => G + (groundNoise(x / 90) - 0.5) * 14;

function holePath(ctx: CanvasRenderingContext2D, pts: number[], k: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0] * k, pts[1] * k);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * k, pts[i + 1] * k);
  ctx.closePath();
}

// ------------------------------------------------------------------ rock

/** Paints the cut face of the earth (strata, pebbles, roots, cracks) with the cavities punched out. */
export function paintRock(): Texture {
  const k = T.world.rockRes;
  const w = Math.round(W * k), h = Math.round(H * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const n2 = noise2(5);
  const n3 = noise2(9);
  const wav = noise1(17);

  const bands = [
    { y: G, c: P.soilDark },
    { y: G + 40, c: P.soil },
    { y: G + 180, c: P.clay },
    { y: G + 300, c: P.gravel },
    { y: G + 350, c: P.sandstone },
    { y: 860, c: P.slate },
    { y: 1180, c: P.slateDeep },
  ];
  const rgb = (v: number) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const bandRGB = bands.map(b => rgb(b.c));

  for (let py = 0; py < h; py++) {
    const wy = py / k;
    for (let px = 0; px < w; px++) {
      const wx = px / k;
      const i = (py * w + px) * 4;
      // wavy band index
      let bi = 0;
      for (let b = 1; b < bands.length; b++) {
        const off = (wav(wx / 260 + b * 13.1) - 0.5) * 46 + (wav(wx / 70 + b * 7.7) - 0.5) * 10;
        if (wy > bands[b].y + off) bi = b;
      }
      const base = bandRGB[bi];
      const n = n2(wx / 85, wy / 85, 5);
      const fine = n3(wx / 14, wy / 9, 2);
      // layered sediment streaks
      const streak = Math.sin(wy * 0.21 + n * 9 + wx * 0.002) * 0.05;
      // cracks: ridged noise
      const rd = 1 - Math.abs(n3(wx / 120, wy / 120, 3) * 2 - 1);
      const crack = rd > 0.965 ? -0.38 * ((rd - 0.965) / 0.035) : 0;
      let m = 1.05 + (n - 0.5) * 0.55 + (fine - 0.5) * 0.18 + streak + crack;
      // slight depth falloff
      m *= 1 - Math.min(0.25, Math.max(0, (wy - G) / 5200));
      img.data[i] = Math.max(0, Math.min(255, base[0] * m));
      img.data[i + 1] = Math.max(0, Math.min(255, base[1] * m));
      img.data[i + 2] = Math.max(0, Math.min(255, base[2] * m));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const r = rng(77);
  // gravel band pebbles
  for (let i = 0; i < 900; i++) {
    const x = r() * W;
    const y = G + 300 + (wav(x / 260 + 4 * 13.1) - 0.5) * 46 + r() * 50;
    const rad = 3 + r() * 7;
    const g = 70 + r() * 50;
    ctx.fillStyle = `rgba(${g},${g * 0.98},${g * 0.94},0.9)`;
    ctx.beginPath(); ctx.ellipse(x * k, y * k, rad * k * 1.3, rad * k, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,240,0.18)';
    ctx.beginPath(); ctx.ellipse((x - rad * 0.3) * k, (y - rad * 0.35) * k, rad * k * 0.6, rad * k * 0.4, 0, 0, 7); ctx.fill();
  }
  // roots in the topsoil
  ctx.strokeStyle = 'rgba(30,20,12,0.7)';
  for (let i = 0; i < 70; i++) {
    let x = r() * W, y = groundY(x) + 2;
    ctx.lineWidth = (1.6 + r() * 2) * k;
    ctx.beginPath(); ctx.moveTo(x * k, y * k);
    for (let s = 0; s < 6; s++) {
      x += (r() - 0.5) * 30; y += 8 + r() * 14;
      ctx.lineTo(x * k, y * k);
    }
    ctx.stroke();
  }
  // boulders in sandstone / slate
  for (let i = 0; i < 70; i++) {
    const x = r() * W, y = 700 + r() * 760, rad = 10 + r() * 30;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse((x + 3) * k, (y + 4) * k, rad * k * 1.2, rad * k * 0.8, 0, 0, 7); ctx.fill();
    const g = 60 + r() * 40;
    ctx.fillStyle = `rgb(${g},${g * 0.97},${g * 0.92})`;
    ctx.beginPath(); ctx.ellipse(x * k, y * k, rad * k * 1.2, rad * k * 0.8, r(), 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,220,0.12)';
    ctx.beginPath(); ctx.ellipse((x - rad * 0.3) * k, (y - rad * 0.3) * k, rad * k * 0.6, rad * k * 0.35, 0, 0, 7); ctx.fill();
  }
  // old buried pipes
  for (const [x0, y0, x1] of [[60, 690, 820], [2900, 860, 3380], [1500, 1480, 2400], [3000, 600, 3390]]) {
    ctx.fillStyle = 'rgba(80,45,28,0.9)';
    ctx.fillRect(x0 * k, y0 * k, (x1 - x0) * k, 12 * k);
    ctx.fillStyle = 'rgba(160,100,60,0.35)';
    ctx.fillRect(x0 * k, y0 * k, (x1 - x0) * k, 3 * k);
    for (let x = x0 + 40; x < x1; x += 120) {
      ctx.fillStyle = 'rgba(60,34,20,1)';
      ctx.fillRect(x * k, (y0 - 3) * k, 10 * k, 18 * k);
    }
  }
  // fossils (little spirals)
  ctx.strokeStyle = 'rgba(220,200,160,0.28)';
  ctx.lineWidth = 1.2 * k;
  for (let i = 0; i < 14; i++) {
    const cx = r() * W, cy = G + 380 + r() * 420;
    ctx.beginPath();
    for (let a = 0; a < 14; a += 0.3) {
      const rad = a * 0.9;
      ctx.lineTo((cx + Math.cos(a) * rad) * k, (cy + Math.sin(a) * rad) * k);
    }
    ctx.stroke();
  }

  // ambient occlusion around every cavity, then punch the cavities out
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 46 * k;
  ctx.fillStyle = '#000';
  for (const hh of holes) { holePath(ctx, hh.pts, k); ctx.fill(); }
  ctx.restore();
  ctx.globalCompositeOperation = 'destination-out';
  for (const hh of holes) { holePath(ctx, hh.pts, k); ctx.fill(); }
  // the sky
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let x = 0; x <= W; x += 10) ctx.lineTo(x * k, groundY(x) * k);
  ctx.lineTo(w, 0); ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // grassless burnt crust along the surface
  ctx.strokeStyle = 'rgba(20,14,10,0.95)';
  ctx.lineWidth = 6 * k;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 10) ctx.lineTo(x * k, (groundY(x) + 3) * k);
  ctx.stroke();
  return Texture.from(c);
}

/** dark rock continuing past the world edges so a zoomed-out view never shows a seam to nothing */
export function outerRock(): Graphics {
  const g = new Graphics();
  const E = 4000;
  const strata = [
    [G, P.soil], [G + 180, P.clay], [G + 350, P.sandstone], [860, P.slate], [1180, P.slateDeep], [H, P.slateDeep],
  ] as const;
  for (let i = 0; i < strata.length; i++) {
    const y0 = strata[i][0], y1 = i + 1 < strata.length ? strata[i + 1][0] : H + E;
    const c = scale(strata[i][1], 0.6);
    g.rect(-E, y0, E, y1 - y0).fill(c);
    g.rect(W, y0, E, y1 - y0).fill(c);
  }
  g.rect(-E, H, W + 2 * E, E).fill(scale(P.slateDeep, 0.5));
  return g;
}

// ------------------------------------------------------------------ back walls

export function backWalls(): Graphics {
  const g = new Graphics();
  for (const h of holes) {
    switch (h.back) {
      case 'concrete': concreteBack(g, h); break;
      case 'hub': hubBack(g); break;
      case 'tile': tileBack(g, h); break;
      case 'rock': rockBack(g, h); break;
      case 'brick': brickBack(g, h); break;
      case 'none': break;
    }
  }
  return g;
}

function bbox(pts: number[]) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return { x0, y0, x1, y1 };
}

function concreteBack(g: Graphics, h: Hole) {
  g.poly(h.pts).fill(P.concreteDark);
  const b = bbox(h.pts);
  for (let x = b.x0; x < b.x1; x += 64) g.rect(x, b.y0, 2, b.y1 - b.y0).fill({ color: 0x000000, alpha: 0.25 });
  for (let y = b.y0 + 40; y < b.y1; y += 52) g.rect(b.x0, y, b.x1 - b.x0, 2).fill({ color: 0x000000, alpha: 0.2 });
  if (h.id === 'ramp') {
    // hazard band following the ramp
    for (let i = 0; i < 14; i++) {
      const t = i / 14;
      const x = 3020 - 360 * t, y = 330 + 222 * t;
      g.poly([x, y - 26, x + 14, y - 26, x - 4, y - 8, x - 18, y - 8]).fill({ color: P.hazard, alpha: 0.5 });
    }
    // rust streaks
    for (let i = 0; i < 16; i++) {
      const x = rr(2620, 2980), y = rr(380, 470);
      g.rect(x, y, 3, rr(20, 60)).fill({ color: P.rust, alpha: 0.35 });
    }
  }
  if (h.id === 'storeroom') {
    for (let i = 0; i < 7; i++) {
      const x = 2690 + i * 28 + rr(-4, 4), s = rr(20, 30);
      crate(g, x, 760 - s, s);
      if (R() < 0.6) crate(g, x + 4, 760 - s - s * 0.8, s * 0.8);
    }
  }
}

function hubBack(g: Graphics) {
  const hub = holes.find(h => h.id === 'hub')!;
  const win = [2170, 690, 2450, 690, ...archPts(2450, 2170, 520, 92)];
  g.poly(hub.pts).fill(P.concrete);
  g.poly(win).cut();
  // lower levels are darker (dirt, soot)
  g.rect(HUB.x0, HUB.l2, HUB.x1 - HUB.x0, HUB.l3 - HUB.l2).fill({ color: 0x000000, alpha: 0.18 });
  // panel seams (skip the window)
  for (let x = HUB.x0 + 35; x < HUB.x1; x += 70) {
    const inWin = x > 2160 && x < 2460;
    g.rect(x, inWin ? 700 : 400, 2, inWin ? 260 : 560).fill({ color: 0x000000, alpha: 0.22 });
  }
  for (const y of [HUB.l1 - 90, HUB.l2 - 100, HUB.l3 - 100]) {
    g.rect(HUB.x0, y, 200, 2).fill({ color: 0x000000, alpha: 0.2 });
    g.rect(2460, y, 200, 2).fill({ color: 0x000000, alpha: 0.2 });
  }
  // dado bands and brass trim under each storey
  for (const y of [HUB.l1, HUB.l2, HUB.l3]) {
    g.rect(HUB.x0, y - 34, HUB.x1 - HUB.x0, 34).fill({ color: P.concreteDark, alpha: 0.8 });
    g.rect(HUB.x0, y - 36, HUB.x1 - HUB.x0, 3).fill({ color: P.brass, alpha: 0.55 });
  }
  // pilasters
  for (const x of [2100, 2520]) {
    g.rect(x, 440, 26, 520).fill(P.concreteLight);
    g.rect(x, 440, 4, 520).fill({ color: 0xffffff, alpha: 0.12 });
    g.rect(x + 22, 440, 4, 520).fill({ color: 0x000000, alpha: 0.25 });
  }
  // window frame + mullions
  g.poly(win).stroke({ width: 14, color: P.steelDark });
  g.poly(win).stroke({ width: 4, color: P.brass, alpha: 0.7 });
  for (let x = 2170 + 56; x < 2450; x += 56) {
    const top = 520 - 92 * Math.sin(Math.PI * (x - 2170) / 280) - 2;
    g.rect(x - 2, top, 4, 690 - top).fill({ color: P.steelDark, alpha: 0.95 });
  }
  for (const y of [560, 625]) g.rect(2170, y, 280, 4).fill({ color: P.steelDark, alpha: 0.95 });
  g.poly(win).fill({ color: 0x9ec8ff, alpha: 0.04 });
  // big painted mural circle (the bell emblem)
  g.circle(2310, 820, 52).stroke({ width: 6, color: P.brass, alpha: 0.35 });
  g.circle(2310, 820, 40).fill({ color: P.rust, alpha: 0.25 });
  g.poly([2290, 840, 2330, 840, 2322, 800, 2310, 792, 2298, 800]).fill({ color: P.brass, alpha: 0.4 });
  // doors on each side
  door(g, 1975, HUB.l3, 34, 62, true);
  door(g, 2620, HUB.l1, 34, 62, false);
  door(g, 2626, HUB.l2, 34, 64, false);
  // grime at floor level
  for (const y of [HUB.l1, HUB.l2, HUB.l3])
    g.rect(HUB.x0, y - 8, HUB.x1 - HUB.x0, 8).fill({ color: 0x000000, alpha: 0.3 });
}

function archPts(x0: number, x1: number, yBase: number, rise: number, n = 16) {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(x0 + (x1 - x0) * t, yBase - rise * Math.sin(Math.PI * t));
  }
  return out;
}

function door(g: Graphics, x: number, floor: number, w: number, h: number, open: boolean) {
  g.rect(x - 4, floor - h - 4, w + 8, h + 4).fill(P.steelDark);
  g.rect(x, floor - h, w, h).fill(open ? 0x0a0b0d : P.steel);
  if (!open) {
    g.rect(x + 4, floor - h + 6, w - 8, 3).fill({ color: 0x000000, alpha: 0.4 });
    g.circle(x + w - 7, floor - h / 2, 2.5).fill(P.brass);
  }
}

function tileBack(g: Graphics, h: Hole) {
  g.poly(h.pts).fill(P.tileCream);
  // green lower tiles
  g.rect(1300, 925, 670, 40).fill(P.tileGreen);
  g.poly([1290, 990, 1410, 930, 1410, 960, 1290, 1020]).fill(P.tileGreen);
  for (let x = 1296; x < 1966; x += 14) g.rect(x, 880, 1, 85).fill({ color: 0x000000, alpha: 0.12 });
  for (let y = 890; y < 960; y += 12) g.rect(1290, y, 676, 1).fill({ color: 0x000000, alpha: 0.12 });
  // missing tiles & grime
  for (let i = 0; i < 40; i++) g.rect(rr(1300, 1950), rr(890, 955), 13, 11).fill({ color: 0x2a2a26, alpha: rr(0.4, 0.8) });
  g.rect(1290, 952, 676, 8).fill({ color: 0x000000, alpha: 0.35 });
  // ceiling pipes
  g.rect(1290, 884, 676, 7).fill(P.steel);
  g.rect(1290, 884, 676, 2).fill({ color: 0xffffff, alpha: 0.15 });
  g.rect(1290, 893, 676, 4).fill(P.rust);
  for (let x = 1320; x < 1966; x += 90) g.rect(x, 882, 6, 16).fill(P.steelDark);
  // a sign
  g.roundRect(1580, 905, 60, 18, 3).fill(0x2d4a3a);
  g.rect(1586, 912, 48, 3).fill({ color: 0xe8f0d0, alpha: 0.7 });
}

function rockBack(g: Graphics, h: Hole) {
  g.poly(h.pts).fill(0x1a1c20);
  for (let i = 0; i < 30; i++) {
    const x = rr(40, 380), y = rr(890, 1015);
    g.ellipse(x, y, rr(8, 26), rr(5, 12)).fill({ color: pick([0x24262b, 0x15171a, 0x2c2c2e]), alpha: 0.9 });
  }
}

function brickBack(g: Graphics, h: Hole) {
  g.poly(h.pts).fill(0x4a2e24);
  for (let y = 404, row = 0; y < 524; y += 10, row++)
    for (let x = 392 + (row % 2) * 12; x < 772; x += 24)
      g.rect(x, y, 22, 8).fill({ color: mix(0x6a3a2a, 0x3a2018, R()), alpha: 0.9 });
  // shelf + barrels
  g.rect(420, 470, 120, 4).fill(P.wood);
  for (let x = 425; x < 535; x += 18) g.rect(x, 455, 12, 15).fill(mix(P.wood, 0x8a6a40, R()));
  for (const x of [640, 680]) {
    g.roundRect(x, 486, 30, 38, 4).fill(0x4a3424);
    g.rect(x, 494, 30, 3).fill(0x2a1a10);
    g.rect(x, 512, 30, 3).fill(0x2a1a10);
  }
  // collapsed corner
  g.poly([700, 404, 772, 404, 772, 524, 730, 524, 712, 470]).fill(0x2e221a);
}

export function crate(g: Graphics, x: number, y: number, s: number) {
  const c = mix(P.wood, 0x8a6a42, R());
  g.rect(x, y, s, s).fill(c);
  g.rect(x, y, s, 2).fill({ color: 0xffffff, alpha: 0.15 });
  g.rect(x, y + s - 3, s, 3).fill({ color: 0x000000, alpha: 0.35 });
  g.moveTo(x + 2, y + 2).lineTo(x + s - 2, y + s - 2).stroke({ width: 2, color: scale(c, 0.6) });
}

// ------------------------------------------------------------------ rim on the cut face

export function rims(): Graphics {
  const g = new Graphics();
  for (const h of holes) {
    g.poly(h.pts).stroke({ width: 5, color: 0x000000, alpha: 0.55, alignment: 0 });
    g.poly(h.pts).stroke({ width: 2, color: P.rockRim, alpha: 0.38, alignment: 0 });
  }
  // surface crust highlight
  g.moveTo(0, groundY(0));
  for (let x = 10; x <= W; x += 10) g.lineTo(x, groundY(x));
  g.stroke({ width: 2, color: 0xc08050, alpha: 0.4 });
  return g;
}

// ------------------------------------------------------------------ structures

function slab(g: Graphics, x0: number, x1: number, y: number, t = 14, c: number = P.concrete) {
  g.rect(x0, y, x1 - x0, t).fill(c);
  g.rect(x0, y, x1 - x0, 2).fill({ color: 0xffffff, alpha: 0.22 });
  g.rect(x0, y + t - 3, x1 - x0, 3).fill({ color: 0x000000, alpha: 0.45 });
}

function stairs(g: Graphics, front: Graphics, x0: number, y0: number, x1: number, y1: number, c: number = P.steel) {
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.round(Math.abs(dy) / 12);
  // stringer
  g.poly([x0, y0, x1, y1, x1, y1 + 14, x0, y0 + 14]).fill(scale(c, 0.7));
  // treads
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + dx * t, y = y0 + dy * t;
    const sx = Math.sign(dx) * Math.abs(dx / n);
    g.rect(Math.min(x - sx / 2, x + sx / 2), y - 1, Math.abs(sx), 3).fill(scale(c, 1.15));
  }
  // rail in front of walkers
  front.moveTo(x0, y0 - 30).lineTo(x1, y1 - 30).stroke({ width: 2.5, color: P.steelDark });
  front.moveTo(x0, y0 - 16).lineTo(x1, y1 - 16).stroke({ width: 1.2, color: P.steelDark, alpha: 0.8 });
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const x = x0 + dx * t, y = y0 + dy * t;
    front.rect(x - 1.2, y - 30, 2.4, 30).fill(P.steelDark);
  }
}

function railing(front: Graphics, x0: number, x1: number, y: number) {
  front.rect(x0, y - 30, x1 - x0, 3).fill(P.steelDark);
  front.rect(x0, y - 30, x1 - x0, 1).fill({ color: P.brass, alpha: 0.5 });
  front.rect(x0, y - 15, x1 - x0, 1.5).fill({ color: P.steelDark, alpha: 0.8 });
  for (let x = x0; x <= x1; x += 22) front.rect(x - 1, y - 30, 2, 30).fill(P.steelDark);
}

export interface Built {
  structures: Graphics;
  front: Graphics;
  rooms: Container;
  labels: Container;
  fireBarrel: { x: number; y: number };
}

export async function buildStructures(): Promise<Built> {
  const g = new Graphics();
  const front = new Graphics();

  // ---- surface
  // sandbags + broken hatch + rubble on the surface
  for (let i = 0; i < 9; i++) g.ellipse(3080 + i * 14, 314 - (i % 2) * 6, 10, 6).fill(mix(0x6a5a42, 0x4a3e2e, R()));
  g.poly([2880, 318, 2930, 318, 2918, 262, 2902, 258]).fill(P.steelDark);        // hatch frame post
  g.poly([2905, 300, 2990, 250, 2996, 260, 2912, 312]).fill(P.steel);            // broken hatch leaf, propped open
  g.poly([2905, 300, 2990, 250, 2992, 254, 2908, 304]).fill({ color: 0xffd0a0, alpha: 0.3 });
  for (let i = 0; i < 26; i++) {
    const x = rr(2600, 3400), y = groundY(x);
    const s = rr(4, 16);
    g.poly([x - s, y + 2, x - s * 0.4, y - s * rr(0.4, 1), x + s * 0.6, y - s * 0.5, x + s, y + 2]).fill(mix(0x2a2420, 0x4a3a30, R()));
  }
  // rebar & a dead tree
  for (let i = 0; i < 6; i++) {
    const x = rr(3150, 3380);
    g.moveTo(x, groundY(x)).lineTo(x + rr(-14, 14), groundY(x) - rr(20, 50)).stroke({ width: 2, color: 0x3a2a20 });
  }
  const tx = 3280;
  g.moveTo(tx, G).lineTo(tx - 6, G - 70).lineTo(tx - 30, G - 110).stroke({ width: 6, color: 0x1e1612, cap: 'round' });
  g.moveTo(tx - 6, G - 70).lineTo(tx + 26, G - 104).stroke({ width: 4, color: 0x1e1612, cap: 'round' });
  g.moveTo(tx - 18, G - 92).lineTo(tx - 40, G - 96).stroke({ width: 2, color: 0x1e1612, cap: 'round' });

  // ---- ramp
  g.poly([3040, 320, 2660, 560, 2660, 576, 3040, 336]).fill(P.concreteDark);
  g.moveTo(3040, 320).lineTo(2660, 560).stroke({ width: 2, color: 0xffffff, alpha: 0.2 });
  for (let i = 1; i < 20; i++) {
    const t = i / 20;
    g.rect(3040 - 380 * t, 320 + 240 * t - 1, 6, 3).fill({ color: 0x000000, alpha: 0.4 });
  }
  for (let i = 0; i <= 6; i++) {
    const t = i / 6, x = 3030 - 360 * t, y = 326 + 228 * t;
    front.rect(x - 1.5, y - 32, 3, 32).fill(P.steelDark);
  }
  front.moveTo(3030, 294).lineTo(2670, 522).stroke({ width: 3, color: P.steelDark });

  // ---- hub floors
  slab(g, HUB.x0, 2150, HUB.l1, 16);
  slab(g, 2470, HUB.x1, HUB.l1, 16);
  // bridge truss across the void
  g.rect(2140, HUB.l1, 340, 6).fill(P.steel);
  g.rect(2140, HUB.l1 + 18, 340, 4).fill(P.steelDark);
  for (let x = 2140; x < 2480; x += 34) {
    g.moveTo(x, HUB.l1 + 6).lineTo(x + 17, HUB.l1 + 18).lineTo(x + 34, HUB.l1 + 6).stroke({ width: 2, color: P.steelDark });
  }
  // the chandelier on its chain
  g.moveTo(2310, 384).lineTo(2310, 496).stroke({ width: 2, color: 0x22201c });
  g.poly([2286, 496, 2334, 496, 2326, 512, 2294, 512]).fill(P.brass);
  g.rect(2296, 512, 28, 4).fill(0x3a2a1a);
  slab(g, HUB.x0, 2250, HUB.l2, 14);
  slab(g, 2430, HUB.x1, HUB.l2, 14);
  slab(g, HUB.x0 - 10, HUB.x1 + 10, HUB.l3, 22);
  // balcony brackets
  for (const [x, y, d] of [[2150, HUB.l1, -1], [2470, HUB.l1, 1], [2250, HUB.l2, -1], [2430, HUB.l2, 1]] as const) {
    g.moveTo(x, y + 16).lineTo(x + d * 70, y + 70).stroke({ width: 4, color: P.steelDark });
  }
  railing(front, 2150, 2470, HUB.l1);
  railing(front, 2150, 2150, HUB.l1);
  railing(front, 2240, 2250, HUB.l2);
  railing(front, 2430, 2440, HUB.l2);
  stairs(g, front, 2400, HUB.l1, 2200, HUB.l2);
  stairs(g, front, 2020, HUB.l2, 2220, HUB.l3);
  stairs(g, front, 2440, HUB.l3, 2640, HUB.l2);
  // benches, planters and a fountain on the hub floor
  for (const x of [2120, 2470]) {
    g.rect(x, HUB.l3 - 14, 46, 5).fill(P.wood);
    g.rect(x + 4, HUB.l3 - 9, 4, 9).fill(P.steelDark);
    g.rect(x + 38, HUB.l3 - 9, 4, 9).fill(P.steelDark);
  }
  g.ellipse(2310, HUB.l3 - 6, 48, 8).fill(P.concreteLight);
  g.rect(2262, HUB.l3 - 6, 96, 6).fill(P.concrete);
  g.rect(2306, HUB.l3 - 38, 8, 32).fill(P.concreteLight);
  g.ellipse(2310, HUB.l3 - 38, 16, 4).fill(P.concreteLight);
  for (const [x, y] of [[1995, HUB.l1], [2600, HUB.l1], [2570, HUB.l2], [2560, HUB.l3], [2070, HUB.l3]]) {
    g.rect(x - 9, y - 18, 18, 18).fill(0x5a3a28);
    for (let i = 0; i < 6; i++) g.circle(x + rr(-10, 10), y - 22 - rr(0, 16), rr(5, 9)).fill(mix(0x3a5a2a, 0x5a7a3a, R()));
  }
  // wall lamps (fixtures)
  for (const [x, y] of [[1988, 512], [2632, 512], [1988, 712], [2632, 712], [1988, 912], [2632, 912]]) {
    g.rect(x - 2, y - 12, 4, 10).fill(P.steelDark);
    g.poly([x - 7, y - 2, x + 7, y - 2, x + 5, y + 4, x - 5, y + 4]).fill(P.brass);
  }
  // storeroom door (heavy, ajar)
  g.rect(2655, 690, 12, 70).fill(P.steelDark);
  g.poly([2667, 692, 2690, 698, 2690, 756, 2667, 760]).fill(P.steel);
  g.rect(2672, 720, 14, 6).fill({ color: P.hazard, alpha: 0.6 });
  // hanging cables in the atrium
  for (const [x0, x1, y, sag] of [[1975, 2640, 440, 40], [2040, 2580, 470, 26]] as const) {
    const pts = catenary(x0, y, x1, y, sag, 20);
    g.moveTo(x0, y);
    for (const [x, yy] of pts) g.lineTo(x, yy);
    g.lineTo(x1, y).stroke({ width: 1.5, color: 0x141210, alpha: 0.9 });
  }

  // ---- corridor
  slab(g, 1410, 1966, 960, 16, P.concreteDark);
  g.poly([1410, 960, 1290, 1020, 1290, 1036, 1410, 976]).fill(P.concreteDark);
  for (let x = 1420; x < 1960; x += 20) g.rect(x, 961, 10, 2).fill({ color: 0x000000, alpha: 0.35 });
  for (const x of [1880, 1680, 1480]) {
    g.rect(x - 26, 882, 52, 5).fill(P.steelDark);
    g.rect(x - 24, 887, 48, 3).fill(0xdff8ee);
  }

  // ---- district
  // street (packed earth + cobbles)
  g.rect(DISTRICT.x0 - 30, DISTRICT.street, 960, 20).fill(0x2e2a24);
  for (let x = 372; x < 1300; x += 11) {
    g.roundRect(x, DISTRICT.street + 1, 9, 5, 2).fill(mix(0x5a524a, 0x3a342e, R()));
  }
  g.rect(DISTRICT.x0 - 30, DISTRICT.street, 960, 1.5).fill({ color: 0xffd8b0, alpha: 0.22 });
  // terrace on steel columns
  slab(g, 430, 1082, DISTRICT.terrace, 14, P.concreteDark);
  for (const x of [436, 676, 846, 1072]) {
    g.rect(x - 5, DISTRICT.terrace + 14, 10, DISTRICT.street - DISTRICT.terrace - 14).fill(P.steelDark);
    g.rect(x - 5, DISTRICT.terrace + 14, 2, DISTRICT.street - DISTRICT.terrace - 14).fill({ color: 0xffffff, alpha: 0.12 });
    g.rect(x - 8, DISTRICT.street - 6, 16, 6).fill(P.steelDark);
  }
  // pipe bundle under the terrace
  for (let i = 0; i < 3; i++) g.rect(430, DISTRICT.terrace + 18 + i * 7, 650, 5).fill(mix(P.rust, P.steel, i / 2));
  railing(front, 1060, 1082, DISTRICT.terrace);
  railing(front, 430, 440, DISTRICT.terrace);
  stairs(g, front, 1268, DISTRICT.street, 1070, DISTRICT.terrace, 0x6a5848);
  // fire barrel
  const fb = { x: 960, y: DISTRICT.street };
  g.roundRect(fb.x - 14, fb.y - 34, 28, 34, 3).fill(0x4a2a1a);
  g.rect(fb.x - 14, fb.y - 26, 28, 3).fill(0x2a160c);
  g.rect(fb.x - 14, fb.y - 12, 28, 3).fill(0x2a160c);
  g.rect(fb.x - 14, fb.y - 34, 28, 3).fill(0x6a3a20);
  for (let i = 0; i < 4; i++) g.circle(fb.x - 8 + i * 5, fb.y - 22 + (i % 2) * 6, 1.8).fill(0xff8a3a);
  // crates + benches round the fire
  crate(g, 870, 1000, 20); crate(g, 1020, 998, 22); crate(g, 1040, 1002, 18);
  g.rect(900, 1008, 34, 4).fill(P.wood); g.rect(988, 1008, 30, 4).fill(P.wood);
  // market stall with awning
  g.rect(1110, 960, 4, 60).fill(P.wood); g.rect(1160, 960, 4, 60).fill(P.wood);
  for (let i = 0; i < 5; i++) g.poly([1104 + i * 13, 954, 1117 + i * 13, 954, 1117 + i * 13, 968, 1104 + i * 13, 972]).fill(i % 2 ? 0x8a3a2a : 0xc8b090);
  g.rect(1108, 992, 60, 6).fill(P.wood);
  for (let i = 0; i < 6; i++) g.circle(1116 + i * 9, 989, 3).fill(pick([0x8a6a2a, 0x6a8a3a, 0x9a4a2a]));
  // lamp post
  g.rect(1188, 934, 4, 86).fill(P.steelDark);
  g.poly([1180, 930, 1200, 930, 1196, 940, 1184, 940]).fill(P.brass);
  // laundry line between columns
  {
    const pts = catenary(676, 830, 846, 832, 16, 14);
    g.moveTo(676, 830); for (const [x, y] of pts) g.lineTo(x, y); g.lineTo(846, 832).stroke({ width: 1, color: 0x1a1a1a });
    for (let i = 1; i < pts.length; i += 2) {
      const [x, y] = pts[i];
      g.rect(x - 5, y, 10, rr(12, 18)).fill(pick(P.cloth));
    }
  }
  // water tank on the terrace end
  g.roundRect(1050, 754, 26, 46, 4).fill(0x4a5a5e);
  g.rect(1050, 764, 26, 2).fill(0x2a3236);
  // string-light cables
  for (const s of strings) {
    const pts = catenary(s.x0, s.y0, s.x1, s.y1, s.sag, 10);
    g.moveTo(s.x0, s.y0);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(s.x1, s.y1).stroke({ width: 1.2, color: 0x141210 });
    for (const [x, y] of catenary(s.x0, s.y0, s.x1, s.y1, s.sag, s.step)) g.circle(x, y + 5, 2.6).fill(0xffd090);
  }
  // stalactites in the cavern roof
  for (let i = 0; i < T.detail.stalactites * T.detail.density; i++) {
    const x = rr(420, 1250), top = caveCeil(x);
    const len = rr(10, 46);
    g.poly([x - rr(4, 9), top - 2, x + rr(4, 9), top - 2, x + rr(-2, 2), top + len]).fill(mix(0x2a2622, 0x4a4036, R()));
  }

  // ---- edge: rubble choke
  const rr2 = rng(31);
  for (let i = 0; i < T.detail.rubble * T.detail.density; i++) {
    const t = rr2();
    const x = 150 + t * 170;
    const peak = 1020 - Math.sin(Math.PI * t) * 105 - 8;
    const y = peak + rr2() * (1020 - peak);
    const s = 6 + rr2() * 18;
    const c = mix(0x2a2a2c, 0x5a544c, rr2());
    const pts: number[] = [];
    const k = 5 + Math.floor(rr2() * 3);
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2 + rr2() * 0.5;
      pts.push(x + Math.cos(a) * s * (0.7 + rr2() * 0.5), y + Math.sin(a) * s * 0.7 * (0.7 + rr2() * 0.5));
    }
    g.poly(pts).fill(c);
    g.poly(pts).stroke({ width: 1, color: 0xb0a090, alpha: 0.18 });
  }
  // broken beam & planks
  g.poly([170, 940, 330, 980, 326, 990, 166, 950]).fill(0x3a2a1c);
  g.poly([250, 900, 262, 898, 300, 1010, 288, 1012]).fill(0x4a3424);
  // caution tape
  g.moveTo(330, 975).lineTo(372, 968).stroke({ width: 4, color: P.hazard });
  for (let x = 334; x < 372; x += 8) g.rect(x, 970, 3, 4).fill(0x111111);
  // a support arch at the tunnel mouth
  g.rect(376, 920, 10, 100).fill(P.wood);
  g.rect(330, 914, 60, 8).fill(P.wood);

  // ---- hidden cave: pool, glowing fungus, crystals
  g.ellipse(1260, 1412, 220, 14).fill(0x061418);
  g.ellipse(1260, 1410, 200, 8).stroke({ width: 1.5, color: 0x4affc8, alpha: 0.35 });
  for (let i = 0; i < 38; i++) {
    const x = rr(920, 1660), y = caveFloor(x);
    const s = rr(3, 9);
    g.rect(x - 0.8, y - s * 1.4, 1.6, s * 1.4).fill(0x9adfc8);
    g.ellipse(x, y - s * 1.4, s, s * 0.55).fill(mix(0x2affb8, 0x8affe0, R()));
  }
  for (let i = 0; i < 10; i++) {
    const x = rr(960, 1640), y = caveFloor(x);
    g.poly([x - 5, y, x + 5, y, x + rr(-3, 3), y - rr(20, 44)]).fill({ color: 0x7ad8ff, alpha: 0.75 });
  }
  // cellar candle
  g.rect(556, 506, 6, 14).fill(0xe8e0c8);

  const rooms = await buildRooms(g);
  const labels = buildLabels();
  return { structures: g, front, rooms, labels, fireBarrel: fb };
}

const caveCeilN = noise1(55);
export function caveCeil(x: number) { return 560 + Math.abs(x - 840) * 0.06 + caveCeilN(x / 30) * 20; }
function caveFloor(x: number) { return 1406 - Math.sin(((x - 900) / 800) * Math.PI) * 18; }

async function buildRooms(g: Graphics): Promise<Container> {
  const c = new Container();
  for (const d of dwellings) {
    const tex: Texture = await Assets.load(`/art/rooms/${d.art}.webp`);
    const s = new Sprite(tex);
    s.width = d.w; s.height = ROOM_H;
    s.x = d.x; s.y = d.floor - ROOM_H;
    c.addChild(s);
    // depth: inner shadow at the top and sides of the alcove
    const sh = new Graphics();
    sh.rect(d.x, d.floor - ROOM_H, d.w, 16).fill({ color: 0x000000, alpha: 0.55 });
    sh.rect(d.x, d.floor - ROOM_H, 8, ROOM_H).fill({ color: 0x000000, alpha: 0.45 });
    sh.rect(d.x + d.w - 8, d.floor - ROOM_H, 8, ROOM_H).fill({ color: 0x000000, alpha: 0.45 });
    c.addChild(sh);
    // concrete frame / facade
    const x0 = d.x - 7, x1 = d.x + d.w + 7, top = d.floor - ROOM_H - 14;
    g.rect(x0, top, x1 - x0, 14).fill(P.concreteDark);
    g.rect(x0, top, x1 - x0, 2).fill({ color: 0xffffff, alpha: 0.2 });
    g.rect(x0, top, 7, ROOM_H + 14).fill(P.concreteDark);
    g.rect(x1 - 7, top, 7, ROOM_H + 14).fill(P.concreteDark);
    g.rect(x1 - 7, top, 2, ROOM_H + 14).fill({ color: 0x000000, alpha: 0.3 });
    // small roof clutter: antennas, vents, a chimney
    g.rect(x0 + 12, top - 10, 10, 10).fill(P.steelDark);
    g.rect(x1 - 30, top - 6, 18, 6).fill(P.rust);
    if (R() < 0.6) g.moveTo(x1 - 16, top - 6).lineTo(x1 - 16, top - 30).stroke({ width: 1.5, color: 0x222222 });
    // name plate
    g.roundRect((x0 + x1) / 2 - 24, top + 2, 48, 11, 2).fill(0x2a2620);
  }
  return c;
}

function buildLabels(): Container {
  const c = new Container();
  for (const d of dwellings) {
    const t = new Text({
      text: d.label,
      style: { fontFamily: 'Rubik, Heebo, Segoe UI, Arial', fontSize: 9, fill: 0xf0d8a8, fontWeight: '600' },
      resolution: 4,
    });
    t.anchor.set(0.5, 0);
    t.x = d.x + d.w / 2; t.y = d.floor - ROOM_H - 12;
    t.alpha = 0.9;
    c.addChild(t);
  }
  return c;
}

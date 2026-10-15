/** The depth layers that are NOT the play plane: sky, far cavern, back cavern, mid structure, foreground. */
import { Assets, Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import { T } from './tokens';
import type { Textures } from './textures';
import { vGradTex } from './textures';
import { fogged, mix, pick, rng, scale } from './util';
import { HUB, DISTRICT } from './scene';

const P = T.palette;
const G = T.world.groundY;
const W = T.world.width;

export interface Animated { update(t: number, dt: number): void }

// ------------------------------------------------------------------ sky (p .15)

export async function buildSky(): Promise<Container> {
  const p = T.layers.sky.p;
  const c = new Container();
  const grad = new Sprite(vGradTex([
    { t: 0, c: P.skyTop, a: 1 }, { t: 0.55, c: P.skyMid, a: 1 }, { t: 1, c: P.skyHorizon, a: 1 },
  ]));
  grad.width = 9000; grad.height = 1400; grad.x = -4000; grad.y = G * p - 1400;
  c.addChild(grad);
  const tex: Texture = await Assets.load('/art/backdrops/surface-0.webp');
  const s = new Sprite(tex);
  const k = 2.1;
  s.scale.set(k);
  s.x = W * p / 2 - (tex.width * k) / 2;
  s.y = G * p - tex.height * 0.77 * k;
  c.addChild(s);
  // ground below the painting so nothing shows through
  const g = new Graphics();
  g.rect(-4000, s.y + tex.height * k - 4, 9000, 4000).fill(0x0e0a08);
  c.addChild(g);
  return c;
}

// ------------------------------------------------------------------ far cavern (p .40)

export function buildFar(tx: Textures): { layer: Container; anim: Animated } {
  const p = T.layers.far.p, fog = T.layers.far.fog;
  const r = rng(201);
  const c = new Container();
  const g = new Graphics();
  // distant ruined skyline against the sky
  for (let x = -800; x < W * p + 900; x += 30 + r() * 60) {
    const h = 30 + r() * 90, w = 20 + r() * 50;
    g.rect(x, G * p - h, w, h + 4).fill(mix(0x2a1e1a, P.skyHorizon, 0.45));
    if (r() < 0.4) g.rect(x + w * 0.3, G * p - h - 30, 3, 30).fill(mix(0x2a1e1a, P.skyHorizon, 0.45));
  }
  // underground void: deep gradient
  const grad = new Sprite(vGradTex([
    { t: 0, c: mix(P.farHaze, 0x3a2a24, 0.5), a: 1 }, { t: 0.25, c: P.farHaze, a: 1 }, { t: 1, c: P.farBase, a: 1 },
  ]));
  grad.width = 9000; grad.height = 2400; grad.x = -4000; grad.y = G * p;
  c.addChild(grad);
  c.addChild(g);
  const g2 = new Graphics();
  g2.rect(-4000, G * p + 2400, 9000, 3000).fill(P.farBase);
  // colossal pillars of the cavern (stalagnates)
  const nP = Math.round(T.detail.farStructures * T.detail.density);
  for (let i = 0; i < nP; i++) {
    const x = -600 + (i / nP) * (W * p + 1300) + r() * 60;
    const w = 30 + r() * 80;
    const col = fogged(mix(0x1a1e26, 0x262a30, r()), fog * 0.6);
    const top = G * p + 40, bot = G * p + 900;
    const pinch = 0.35 + r() * 0.3;
    const mid = top + (bot - top) * (0.3 + r() * 0.4);
    g2.poly([x - w, top, x + w, top, x + w * pinch, mid, x + w * 1.1, bot, x - w * 1.1, bot, x - w * pinch, mid]).fill(col);
  }
  // terraced distant districts with lit windows
  const glow = new Container();
  const nL = Math.round(T.detail.farLights * T.detail.density);
  const farHalos = new Container();
  for (let i = 0; i < 9; i++) {
    const cx = -300 + i * ((W * p + 600) / 9) + r() * 80;
    const cy = G * p + 200 + r() * 340;
    const hs = new Sprite(tx.lightSoft);
    hs.anchor.set(0.5); hs.x = cx; hs.y = cy - 30; hs.width = 520; hs.height = 220;
    hs.tint = i % 3 === 0 ? 0x2a4a6a : 0x6a3e22; hs.alpha = 0.6; hs.blendMode = 'add';
    farHalos.addChild(hs);
    const cw = 80 + r() * 120;
    // ledge
    g2.poly([cx - cw, cy, cx + cw, cy, cx + cw * 0.8, cy + 30, cx - cw * 0.9, cy + 26]).fill(fogged(0x1e2228, fog * 0.6));
    for (let b = 0; b < 6; b++) {
      const bw = 10 + r() * 22, bh = 10 + r() * 34;
      const bx = cx - cw + r() * (cw * 2 - bw);
      g2.rect(bx, cy - bh, bw, bh).fill(fogged(0x222630, fog * 0.55));
    }
  }
  for (let i = 0; i < nL; i++) {
    const s = new Sprite(tx.lightSoft);
    s.anchor.set(0.5);
    s.x = -500 + r() * (W * p + 1000);
    s.y = G * p + 140 + r() * 700;
    const big = r() < 0.15;
    s.width = s.height = big ? 26 + r() * 30 : 6 + r() * 8;
    s.tint = pick([0xffb060, 0xffc890, 0xff9040, 0x9ad0ff]);
    s.alpha = big ? 0.25 : 0.55 + r() * 0.4;
    s.blendMode = 'add';
    glow.addChild(s);
  }
  // slow lifts climbing the far cliffs (living city)
  const lifts: { s: Sprite; x: number; y0: number; y1: number; sp: number; ph: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const x = -200 + r() * (W * p + 400);
    const y0 = G * p + 120, y1 = G * p + 640;
    g2.rect(x - 1, y0, 2, y1 - y0).fill(fogged(0x30343a, fog * 0.5));
    const s = new Sprite(tx.lightSoft);
    s.anchor.set(0.5); s.width = s.height = 16; s.tint = 0xffd8a0; s.blendMode = 'add';
    glow.addChild(s);
    lifts.push({ s, x, y0, y1, sp: 0.04 + r() * 0.05, ph: r() * 6 });
  }
  // haze bands
  for (let i = 0; i < 5; i++) {
    const s = new Sprite(tx.lightSoft);
    s.anchor.set(0.5);
    s.x = -400 + r() * (W * p + 800); s.y = G * p + 300 + r() * 600;
    s.width = 1400; s.height = 140;
    s.tint = P.farHaze; s.alpha = 0.35;
    glow.addChild(s);
  }
  c.addChild(farHalos, g2);
  c.addChild(glow);
  const twinkle = glow.children.slice(0, 40) as Sprite[];
  return {
    layer: c,
    anim: {
      update(t) {
        for (const l of lifts) {
          l.s.x = l.x;
          l.s.y = l.y0 + (l.y1 - l.y0) * (0.5 + 0.5 * Math.sin(t * l.sp * 6 + l.ph));
        }
        for (let i = 0; i < twinkle.length; i++) twinkle[i].alpha = 0.5 + 0.4 * Math.sin(t * (0.7 + (i % 5) * 0.3) + i);
      },
    },
  };
}

// ------------------------------------------------------------------ back cavern (p .68)

export function buildBack(tx: Textures): { layer: Container; anim: Animated } {
  const p = T.layers.back.p, fog = T.layers.back.fog;
  const r = rng(301);
  const c = new Container();
  const g = new Graphics();
  // surface ruins (closer, rim-lit by the orange sky)
  for (let x = -600; x < W * p + 700; x += 50 + r() * 90) {
    const h = 40 + r() * 140, w = 30 + r() * 70;
    const col = mix(0x1c1412, P.skyMid, 0.38);
    const pts = [x, G * p + 4, x, G * p - h, x + w * 0.3, G * p - h - r() * 20, x + w * 0.6, G * p - h + r() * 30, x + w, G * p - h * 0.7, x + w, G * p + 4];
    g.poly(pts).fill(col);
    g.moveTo(x, G * p - h).lineTo(x + w * 0.3, G * p - h - 10).stroke({ width: 1.5, color: 0xd88a44, alpha: 0.35 });
    for (let k = 0; k < 4; k++) if (r() < 0.5) g.rect(x + 6 + r() * (w - 14), G * p - h + 12 + r() * (h - 24), 5, 7).fill(0x0a0706);
  }
  // cavern back wall: a rock mass with an irregular top, behind everything below ground
  g.rect(-4000, G * p, 9000, 4000).fill(fogged(P.backBase, fog * 0.5));
  const wall = new Graphics();
  // rock ribs and ledges
  for (let i = 0; i < 46; i++) {
    const x = -500 + r() * (W * p + 1000), y = G * p + 120 + r() * 900;
    const w = 60 + r() * 220, h = 18 + r() * 70;
    wall.poly([x - w, y + h, x - w * 0.6, y, x + w * 0.5, y - h * 0.2, x + w, y + h]).fill(fogged(mix(0x22242a, 0x34302c, r()), fog));
    wall.moveTo(x - w * 0.6, y).lineTo(x + w * 0.5, y - h * 0.2).stroke({ width: 1.5, color: fogged(0x8a7a66, fog), alpha: 0.35 });
  }
  // houses on ledges behind the district & the hub window
  const glow = new Container();
  const winCount = Math.round(T.detail.backWindows * T.detail.density);
  const clusters = [
    { x: 840 * p, y: 980 * p, w: 360 },
    { x: 2310 * p, y: 900 * p, w: 300 },
    { x: 1640 * p, y: 860 * p, w: 260 },
    { x: 1260 * p, y: 1420 * p, w: 300 },
    { x: 300 * p, y: 1000 * p, w: 200 },
    { x: 2900 * p, y: 820 * p, w: 260 },
  ];
  let wins = 0;
  const halos = new Container();
  for (const cl of clusters) {
    const h = new Sprite(tx.lightSoft);
    h.anchor.set(0.5); h.x = cl.x; h.y = cl.y - 90;
    h.width = cl.w * 3.2; h.height = 420;
    h.tint = 0x8a5230; h.alpha = 0.55; h.blendMode = 'add';
    halos.addChild(h);
  }
  for (const cl of clusters) {
    // tiers of buildings stepping back up the cave wall
    for (let tier = 0; tier < 3; tier++) {
      const ty = cl.y - tier * 90;
      const tw = cl.w * (1 - tier * 0.18);
      wall.poly([cl.x - tw, ty, cl.x + tw, ty, cl.x + tw * 0.9, ty + 22, cl.x - tw * 0.9, ty + 22]).fill(fogged(0x2a2826, fog * 0.9));
      let x = cl.x - tw + 6;
      while (x < cl.x + tw - 20) {
        const bw = 18 + r() * 34, bh = 22 + r() * 54;
        const col = fogged(mix(0x3a3530, 0x2a2e34, r()), fog * (0.75 + tier * 0.1));
        wall.rect(x, ty - bh, bw, bh).fill(col);
        if (r() < 0.5) wall.poly([x - 3, ty - bh, x + bw + 3, ty - bh, x + bw / 2, ty - bh - 12]).fill(scale(col, 0.8));
        else wall.rect(x + bw * 0.6, ty - bh - 10, 4, 10).fill(scale(col, 0.8));
        for (let k = 0; k < 3 && wins < winCount; k++) {
          if (r() < 0.55) {
            const wx = x + 4 + r() * (bw - 10), wy = ty - bh + 6 + r() * (bh - 14);
            wall.rect(wx, wy, 4, 5).fill(pick([0xffc070, 0xffd8a0, 0xff9a50]));
            const s = new Sprite(tx.lightSoft);
            s.anchor.set(0.5); s.x = wx + 2; s.y = wy + 2.5; s.width = s.height = 22;
            s.tint = 0xffa860; s.alpha = 0.35; s.blendMode = 'add';
            glow.addChild(s);
            wins++;
          }
        }
        x += bw + 2 + r() * 8;
      }
    }
  }
  // the old metro viaduct with a passing train
  const vy = 1080 * p;
  wall.rect(-600, vy, W * p + 1200, 12).fill(fogged(0x3a3632, fog));
  for (let x = -600; x < W * p + 600; x += 110) {
    wall.rect(x, vy + 12, 14, 400).fill(fogged(0x2e2c2a, fog));
    wall.poly([x + 14, vy + 12, x + 110, vy + 12, x + 110, vy + 40, x + 62, vy + 22, x + 14, vy + 40]).fill(fogged(0x2e2c2a, fog));
  }
  const train = new Container();
  const tg = new Graphics();
  for (let k = 0; k < 4; k++) {
    tg.roundRect(k * 74, -24, 70, 22, 4).fill(fogged(0x4a4a46, fog * 0.8));
    for (let w = 0; w < 6; w++) tg.rect(k * 74 + 6 + w * 10.5, -18, 6, 6).fill(0xffd890);
  }
  train.addChild(tg);
  const tglow = new Sprite(tx.lightSoft);
  tglow.anchor.set(0.5); tglow.width = 360; tglow.height = 60; tglow.x = 150; tglow.y = -14;
  tglow.tint = 0xffc080; tglow.alpha = 0.35; tglow.blendMode = 'add';
  train.addChild(tglow);
  const head = new Sprite(tx.cone);
  head.anchor.set(0.5, 0); head.rotation = Math.PI / 2; head.x = 300; head.y = -12;
  head.width = 60; head.height = 220; head.tint = 0xfff0c0; head.alpha = 0.3; head.blendMode = 'add';
  train.addChild(head);
  train.y = vy;
  // haze in front of the back wall
  for (let i = 0; i < 6; i++) {
    const s = new Sprite(tx.lightSoft);
    s.anchor.set(0.5);
    s.x = -300 + r() * (W * p + 600); s.y = G * p + 300 + r() * 700;
    s.width = 1000 + r() * 600; s.height = 120 + r() * 80;
    s.tint = P.backHaze; s.alpha = 0.22;
    glow.addChild(s);
  }
  c.addChild(g, halos, wall, train, glow);
  const span = W * p + 1600;
  const flick = glow.children.slice(0, 30) as Sprite[];
  return {
    layer: c,
    anim: {
      update(t) {
        train.x = -800 + ((t * 70) % (span + 1400));
        for (let i = 0; i < flick.length; i++) flick[i].alpha = 0.28 + 0.1 * Math.sin(t * 2.3 + i * 1.7);
      },
    },
  };
}

// ------------------------------------------------------------------ mid structure (p .88), lit by the lightmap

export function buildMid(): Container {
  const p = T.layers.mid.p, fog = T.layers.mid.fog;
  const r = rng(401);
  const c = new Container();
  const g = new Graphics();
  // behind the hub window: a ring of distant galleries + giant pipes
  const hx = ((HUB.x0 + HUB.x1) / 2) * p;
  for (let k = 0; k < 3; k++) {
    const y = (520 + k * 90) * p;
    g.rect(hx - 260, y, 520, 8).fill(fogged(P.concreteDark, fog + 0.1));
    for (let x = hx - 250; x < hx + 260; x += 26) g.rect(x, y - 18, 2, 18).fill(fogged(P.steelDark, fog));
    g.rect(hx - 260, y - 18, 520, 2).fill(fogged(P.steelDark, fog));
  }
  for (const [x0, y, th] of [[hx - 400, 470 * p, 22], [hx - 420, 610 * p, 14]] as const) {
    g.rect(x0, y, 900, th).fill(fogged(P.rust, fog));
    g.rect(x0, y, 900, 3).fill(fogged(0xc08a5a, fog));
    for (let x = x0 + 30; x < x0 + 900; x += 120) g.rect(x, y - 3, 10, th + 6).fill(fogged(0x3a2418, fog));
  }
  // behind the district: shanty shacks, scaffolds, hanging cables
  const dx = ((DISTRICT.x0 + DISTRICT.x1) / 2) * p;
  for (let i = 0; i < 9; i++) {
    const x = dx - 380 + i * 88 + r() * 20;
    const base = (DISTRICT.terrace - 60 + (i % 3) * 50) * p;
    const w = 50 + r() * 30, h = 40 + r() * 50;
    g.rect(x, base - h, w, h).fill(fogged(mix(0x3a3028, 0x2c3034, r()), fog + 0.15));
    g.poly([x - 4, base - h, x + w + 4, base - h, x + w / 2, base - h - 16]).fill(fogged(0x2a2420, fog + 0.15));
    g.rect(x + w * 0.3, base - h * 0.6, 8, 10).fill(0x0c0a08);
    g.rect(x, base, w, 6).fill(fogged(P.steelDark, fog));
    g.rect(x + 4, base + 6, 3, 120).fill(fogged(P.steelDark, fog));
    g.rect(x + w - 7, base + 6, 3, 120).fill(fogged(P.steelDark, fog));
  }
  for (let i = 0; i < 6; i++) {
    const x0 = dx - 450 + r() * 300, x1 = x0 + 300 + r() * 500, y = (600 + r() * 200) * p;
    g.moveTo(x0, y).quadraticCurveTo((x0 + x1) / 2, y + 30 + r() * 40, x1, y).stroke({ width: 1.2, color: 0x0e0d0c });
  }
  // the cave: crystal columns behind the pool
  const cx = 1290 * p;
  for (let i = 0; i < 8; i++) {
    const x = cx - 360 + i * 90 + r() * 30;
    const y = 1420 * p;
    g.poly([x - 14, y, x + 14, y, x + r() * 8, y - 80 - r() * 90]).fill(fogged(0x2a4a5a, fog + 0.2));
  }
  c.addChild(g);
  return c;
}

// ------------------------------------------------------------------ foreground silhouettes (p 1.32)

export function buildFore(tx: Textures): Container {
  const p = T.layers.fore.p;
  const r = rng(501);
  const c = new Container();
  const g = new Graphics();
  const col = P.foreground, rim = P.foreRim;
  const n = Math.round(T.detail.foreItems * T.detail.density);
  // The near plane frames the shot: a ragged rock lip along the bottom (in front of the deep rock, below the
  // walkways), a few stalactite clusters hanging into the top of the deep strata, and two big pipes at the map ends.
  const bottom: number[] = [];
  const by = 1480 * p;
  bottom.push(-2000, 4000);
  for (let x = -2000; x <= (W + 800) * p; x += 40 + r() * 50) bottom.push(x, by + (r() - 0.3) * 90 - (r() < 0.12 ? 160 : 0));
  bottom.push((W + 800) * p, 4000);
  g.poly(bottom).fill(col);
  for (let i = 2; i < bottom.length - 4; i += 2) {
    g.moveTo(bottom[i], bottom[i + 1]).lineTo(bottom[i + 2], bottom[i + 3]).stroke({ width: 2, color: rim, alpha: 0.45 });
  }
  for (let i = 0; i < n; i++) {
    const x = (-200 + (i / n) * (W + 400)) * p + r() * 80;
    const kind = r();
    if (kind < 0.7) {
      // a rock outcrop rising from the lip
      const y = by + 20, w = 50 + r() * 110, h = 70 + r() * 140;
      const pts = [x - w, y + 600, x - w * 0.8, y, x - w * 0.2, y - h, x + w * 0.4, y - h * 0.7, x + w, y + 600];
      g.poly(pts).fill(col);
      g.moveTo(x - w * 0.8, y).lineTo(x - w * 0.2, y - h).lineTo(x + w * 0.4, y - h * 0.7).stroke({ width: 2, color: rim, alpha: 0.5 });
    }
  }
  // heavy cables sagging across the lens from far above the frame
  for (const [x0, x1, low] of [[700, 1500, 780], [1900, 2500, 700], [200, 600, 900]] as const) {
    const a = x0 * p, b = x1 * p, y = low * p, top = (G + 120) * p;
    for (let k = 0; k < 2; k++) {
      g.moveTo(a + k * 14, top).bezierCurveTo(a + k * 14, y + k * 30, b - k * 10, y + k * 30, b - k * 10, top)
        .stroke({ width: 7 - k * 2, color: col });
    }
    g.moveTo(a, top).bezierCurveTo(a, y - 3, b, y - 3, b, top).stroke({ width: 1.5, color: rim, alpha: 0.5 });
  }
  for (const x of [-120 * p, (W + 60) * p]) {
    const w = 46;
    g.rect(x, -2000, w, 5000).fill(col);
    g.rect(x + w - 3, -2000, 3, 5000).fill({ color: rim, alpha: 0.4 });
    for (let y = -2000; y < 3000; y += 220) g.rect(x - 6, y, w + 12, 14).fill(col);
  }
  c.addChild(g);
  return c;
}

export function screenFx(tx: Textures): { c: Container; resize(w: number, h: number): void; update(t: number): void } {
  const c = new Container();
  const vig = new Sprite(tx.vignette);
  vig.alpha = T.atmosphere.vignette;
  const grain = new TilingSprite({ texture: tx.grain, width: 100, height: 100 });
  grain.alpha = T.atmosphere.grain;
  grain.blendMode = 'add';
  c.addChild(vig, grain);
  return {
    c,
    resize(w, h) { vig.width = w; vig.height = h; grain.width = w; grain.height = h; },
    update(t) { grain.tilePosition.set((t * 997) % 128, (t * 613) % 128); },
  };
}

import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { BuildingType } from '../core/GameState';
import { DEPTH_BOTTOM, DEPTH_TOP, DEPTH_X, ROOM_H } from './layout';
import { block, cylinder, mix, plant, shade, softGlow, vGradient } from './draw';

export type Animator = (t: number, power: number) => void;

export interface Palette {
  wall: number;
  floor: number;
  accent: number;
  light: number;
}

export const PALETTES: Record<BuildingType, Palette> & Record<string, Palette> = {
  quarters: { wall: 0x5a6b7e, floor: 0x7a5c40, accent: 0xd9a441, light: 0xffd9a0 },
  generator: { wall: 0x4c525c, floor: 0x3b4048, accent: 0xffc531, light: 0xffe08a },
  farm: { wall: 0x4e6a4a, floor: 0x5c4630, accent: 0xd86bff, light: 0xf0a0ff },
  waterPump: { wall: 0x3f5f7a, floor: 0x4a5c6a, accent: 0x47b8ff, light: 0xa8dcff },
  workshop: { wall: 0x6e5644, floor: 0x4c4642, accent: 0xff8a3d, light: 0xffc890 },
  medbay: { wall: 0xb4c2ca, floor: 0xcfd8dc, accent: 0xe84a4a, light: 0xeaf6ff },
  canteen: { wall: 0x8a6a4c, floor: 0x6e5038, accent: 0xffb347, light: 0xffd9a0 },
  storage: { wall: 0x5e5a52, floor: 0x524c45, accent: 0xc9a35a, light: 0xffe2b0 },
  elevator: { wall: 0x45484e, floor: 0x34373c, accent: 0xffd84a, light: 0xfff0b0 },
  laboratory: { wall: 0x9aa8b4, floor: 0x7a8690, accent: 0x6affd8, light: 0xd8fff4 },
  radioTower: { wall: 0x5a4a4a, floor: 0x433a38, accent: 0xff5a5a, light: 0xffd0b0 },
  armory: { wall: 0x52524a, floor: 0x3e3e38, accent: 0xb0b060, light: 0xfff0c0 },
  hydroponics: { wall: 0x3e6a5a, floor: 0x40564e, accent: 0x7affa0, light: 0xe0fff0 },
  reactor: { wall: 0x3e4a3e, floor: 0x343c34, accent: 0x7aff5a, light: 0xd0ffc0 },
  waterPurifier: { wall: 0x3d5c76, floor: 0x4a5c6a, accent: 0x47e0ff, light: 0xa8ecff },
  trainingRoom: { wall: 0x6a4a4a, floor: 0x5a4a40, accent: 0xff6a4a, light: 0xffd0b0 },
  cave: { wall: 0x3a3a34, floor: 0x3a342c, accent: 0x6affb0, light: 0xc8ffe0 },
  lake: { wall: 0x2e3a44, floor: 0x2a3440, accent: 0x5ad8ff, light: 0xc0ecff },
  metro: { wall: 0x4a4440, floor: 0x3a3632, accent: 0xffc060, light: 0xffe0b0 },
  atrium: { wall: 0x4a5a3a, floor: 0x5a4a34, accent: 0x9aff6a, light: 0xfff0c0 },
  reactorHall: { wall: 0x2e3a40, floor: 0x283034, accent: 0x5af0ff, light: 0xc8f8ff },
  // [plan4:BL-9..14,19,33]
  batteryBank: { wall: 0x3e4a5c, floor: 0x32383f, accent: 0x5ac8ff, light: 0xc8ecff },
  commons: { wall: 0x7a5c44, floor: 0x5e4430, accent: 0xffb347, light: 0xffd9a0 },
  library: { wall: 0x6e5a48, floor: 0x4e3e30, accent: 0xffd27a, light: 0xffe6b0 },
  recycler: { wall: 0x4e4a42, floor: 0x3a3732, accent: 0xff9a3d, light: 0xffc890 },
  condenser: { wall: 0x3a5a70, floor: 0x44525c, accent: 0x5ae0ff, light: 0xb0f0ff },
  mushroomFarm: { wall: 0x3a3a48, floor: 0x2e2e38, accent: 0xc8a0ff, light: 0xb8a0e8 },
  gatePost: { wall: 0x4c4c44, floor: 0x36362f, accent: 0xff7a3a, light: 0xffd8a0 },
  barracks: { wall: 0x4e5a46, floor: 0x3c4034, accent: 0xb0b060, light: 0xffe8b0 },
  // [plan4:BL-7] wave 2 types (Rooms-Data adds them to BuildingType): palettes of the live-drawn stand-in, matching their composed specs (roomSpecsB.ts).
  // The type is `& Record<string, Palette>` so these keys compile before the types exist; the merger drops any duplicate a parallel branch added.
  quarantineWard: { wall: 0x62706c, floor: 0x585a54, accent: 0xe0705a, light: 0xffe6cc },
  solarArray: { wall: 0x4a5a6a, floor: 0x4a443c, accent: 0xffd070, light: 0xffe0a8 },
  windTurbine: { wall: 0x4a5a6a, floor: 0x4a443c, accent: 0xffffff, light: 0xffe0a8 },
  watchtower: { wall: 0x4a5a6a, floor: 0x4a443c, accent: 0xffb060, light: 0xffe0a8 },
  garage: { wall: 0x5a5648, floor: 0x4a443c, accent: 0xe8943a, light: 0xffc890 },
  decon: { wall: 0x4c6058, floor: 0x465350, accent: 0x6ac890, light: 0xdcffe8 },
  aquaculture: { wall: 0x3e5660, floor: 0x3c4a4e, accent: 0x5ad8ff, light: 0xc0ecff },
  market: { wall: 0x68584a, floor: 0x54483c, accent: 0xd8a850, light: 0xffd9a0 },
  nursery: { wall: 0x8a7660, floor: 0x6c5844, accent: 0xe8c8a0, light: 0xffe6c0 },
  school: { wall: 0x625a4c, floor: 0x4c4238, accent: 0xe8e0c0, light: 0xffe6b0 },
  bathhouse: { wall: 0x748480, floor: 0x586460, accent: 0x6ad0d8, light: 0xe8fff0 },
  memorialHall: { wall: 0x4e4850, floor: 0x3e3a3e, accent: 0xe8a850, light: 0xffc880 },
};

interface Ctx {
  g: Graphics;
  /** Drawn glows (Graphics) plus a sibling layer for glow children, both additive. */
  lights: Graphics;
  lightLayer: Container;
  fx: Container;
  W: number;
  inL: number;
  inR: number;
  inT: number;
  inB: number;
  pal: Palette;
  rnd: () => number;
}

/** Floor line for objects standing near the back wall / in the middle / near the front. */
const backY = (c: Ctx) => c.inB + 3;
const midY = () => ROOM_H - 9;

function drawShell(c: Ctx, openLeft: boolean, openRight: boolean): void {
  const { g, W, inL, inR, inT, inB, pal } = c;
  // Back wall with a soft vertical gradient.
  g.rect(inL, inT, inR - inL, inB - inT).fill(vGradient([[0, shade(pal.wall, 1.12)], [1, shade(pal.wall, 0.82)]]));
  for (let x = inL + 23; x < inR - 4; x += 23) g.rect(x, inT, 1, inB - inT).fill({ color: shade(pal.wall, 0.7), alpha: 0.6 });
  const stripeY = inT + (inB - inT) * 0.56;
  g.rect(inL, stripeY, inR - inL, 3).fill({ color: pal.accent, alpha: 0.55 });
  g.rect(inL, inB - 5, inR - inL, 5).fill(shade(pal.wall, 0.55));
  // Ceiling.
  g.poly([0, 0, W, 0, inR, inT, inL, inT]).fill(shade(pal.wall, 0.48));
  g.rect(inL, inT, inR - inL, 3).fill({ color: 0x000000, alpha: 0.25 });
  // Floor with depth shading and plank seams.
  g.poly([inL, inB, inR, inB, W, ROOM_H, 0, ROOM_H]).fill(vGradient([[0, shade(pal.floor, 0.72)], [1, shade(pal.floor, 1.08)]]));
  for (const t of [0.35, 0.7]) {
    const y = inB + (ROOM_H - inB) * t;
    const xl = inL * (1 - t), xr = inR + (W - inR) * t;
    g.moveTo(xl, y).lineTo(xr, y).stroke({ color: shade(pal.floor, 0.6), width: 1, alpha: 0.6 });
  }
  // Side walls (open sides belong to a compound and are left out).
  if (!openLeft) g.poly([0, 0, inL, inT, inL, inB, 0, ROOM_H]).fill(vGradient([[0, shade(pal.wall, 0.78)], [1, shade(pal.wall, 0.58)]]));
  if (!openRight) g.poly([inR, inT, W, 0, W, ROOM_H, inR, inB]).fill(vGradient([[0, shade(pal.wall, 0.64)], [1, shade(pal.wall, 0.46)]]));
  // Ambient occlusion where the back wall meets the floor.
  g.rect(inL, inB - 12, inR - inL, 12).fill(vGradient([[0, 0x000000, 0], [1, 0x000000, 0.32]]));
}

function ceilingLamp(c: Ctx): Animator {
  const { g, lights, W, inT, pal, lightLayer: ctxLight } = c;
  const lampX = W / 2;
  g.rect(lampX - 1, 0, 2, inT + 1).fill(0x2a2a2a);
  g.roundRect(lampX - 10, inT, 20, 5, 2).fill(0x2a2a2a);
  g.roundRect(lampX - 8, inT + 4, 16, 2.5, 1).fill(pal.light);
  const light = new Graphics();
  light.poly([lampX - 8, inT + 6, lampX + 8, inT + 6, lampX + W * 0.42, ROOM_H, lampX - W * 0.42, ROOM_H])
    .fill(vGradient([[0, pal.light, 0.26], [1, pal.light, 0.03]]));
  softGlow(light, lampX, ROOM_H - 8, W * 0.42, 9, pal.light, 0.35);
  softGlow(light, lampX, inT + 6, 26, 10, pal.light, 0.55);
  ctxLight.addChild(light);
  let flickerUntil = 0;
  return (t, power) => {
    let a = 0.3 + 0.7 * power;
    if (power < 0.95) {
      if (t > flickerUntil && Math.random() < 0.02) flickerUntil = t + 0.12;
      if (t < flickerUntil) a *= 0.2;
    }
    light.alpha = a;
  };
}

function poster(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(x, y, w, h).fill(0xe8dcc0);
  g.rect(x + 2, y + 2, w - 4, h * 0.55).fill(color);
  g.rect(x + 2, y + h * 0.7, w - 4, 2).fill(0x5a4a3a);
  g.rect(x + 2, y + h * 0.82, (w - 4) * 0.6, 2).fill(0x5a4a3a);
}

function crate(g: Graphics, x: number, bottom: number, s: number, color = 0x9a7446): void {
  block(g, x, bottom, s, s * 0.8, color, 5);
  g.moveTo(x + 1, bottom - 1).lineTo(x + s - 1, bottom - s * 0.8 + 1).stroke({ color: shade(color, 0.6), width: 1 });
  g.moveTo(x + 1, bottom - s * 0.8 + 1).lineTo(x + s - 1, bottom - 1).stroke({ color: shade(color, 0.6), width: 1 });
}

const DECORATORS: Partial<Record<BuildingType, (c: Ctx) => Animator[]>> = {
  quarters: (c) => {
    const { g, inL, inR, inT, rnd } = c;
    const sheets = [0x4a7bd0, 0xc04a4a, 0x4aa06a, 0xc0904a, 0x8a5ac0];
    const beds = Math.max(1, Math.floor((inR - inL - 30) / 46));
    for (let i = 0; i < beds; i++) {
      const x = inL + 6 + i * 46;
      const yb = backY(c);
      for (const px of [x, x + 38]) g.rect(px, yb - 58, 3, 58).fill(0x6d7380);
      for (const level of [0, 26]) {
        const sheet = sheets[Math.floor(rnd() * sheets.length)];
        g.rect(x, yb - 12 - level, 41, 4).fill(0x5a606a);
        g.roundRect(x + 2, yb - 18 - level, 37, 6, 2).fill(sheet);
        g.roundRect(x + 3, yb - 21 - level, 11, 5, 2).fill(0xf2efe6);
      }
      g.rect(x + 38, yb - 46, 3, 20).fill(0x8a8f96);
    }
    const lockerX = inR - 26;
    for (let i = 0; i < 2; i++) {
      block(g, lockerX - i * 13, backY(c), 12, 48, 0x6a7f8f, 4);
      g.rect(lockerX - i * 13 + 3, backY(c) - 40, 6, 1.5).fill(0x3a4a5a);
      g.rect(lockerX - i * 13 + 3, backY(c) - 36, 6, 1.5).fill(0x3a4a5a);
    }
    poster(g, inL + (inR - inL) * 0.55, inT + 14, 14, 18, [0xc04a4a, 0x4a7bd0, 0xd9a441][Math.floor(rnd() * 3)]);
    g.ellipse((inL + inR) / 2, midY() + 2, 26, 4).fill(0xa8483c);
    g.ellipse((inL + inR) / 2, midY() + 2, 20, 3).fill(0xc8735a);
    return [];
  },

  generator: (c) => {
    const { g, fx, inL, inR, inB, pal } = c;
    const yb = backY(c);
    const ex = inL + 10;
    block(g, ex, yb, 52, 34, 0x5a6068, 7);
    g.rect(ex + 4, yb - 28, 20, 10).fill(0x3a3f46);
    for (let i = 0; i < 3; i++) g.circle(ex + 8 + i * 6, yb - 23, 1.6).fill([0x44ff66, 0xffcc33, 0xff4444][i]);
    g.rect(ex + 38, yb - 60, 7, 26).fill(0x6a6f76);
    g.rect(ex + 36, yb - 62, 11, 4).fill(0x8a8f96);
    const wheelX = ex + 66, wheelY = yb - 20;
    g.circle(wheelX, wheelY, 17).fill(0x3a3f46);
    g.circle(wheelX, wheelY, 4).fill(0x8a8f96);
    const spokes = new Graphics();
    spokes.position.set(wheelX, wheelY);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      spokes.moveTo(0, 0).lineTo(Math.cos(a) * 14, Math.sin(a) * 14).stroke({ color: 0x9aa0a8, width: 2.5 });
    }
    spokes.circle(0, 0, 15).stroke({ color: 0x9aa0a8, width: 2 });
    fx.addChild(spokes);
    for (let i = 0; i < 2; i++) cylinder(g, inR - 14 - i * 16, ROOM_H - 6, 7, 18, i ? 0x8a3a2a : 0x3f6a4a);
    for (let x = inL; x < inR; x += 14) g.poly([x, inB + 2, x + 7, inB + 2, x + 5, inB + 6, x - 2, inB + 6]).fill(pal.accent);
    const core = new Graphics();
    core.roundRect(ex + 28, yb - 30, 8, 14, 3).fill(pal.accent);
    fx.addChild(core);
    return [(t, power) => {
      spokes.rotation += 0.15 * power;
      core.alpha = (0.5 + 0.5 * Math.sin(t * 5)) * (0.3 + 0.7 * power);
    }];
  },

  farm: (c) => {
    const { g, lights, fx, inL, inR, inT, pal, rnd, lightLayer: ctxLight } = c;
    const yb = midY();
    const plants = new Graphics();
    const rows = [backY(c), yb + 1];
    for (const [ri, y] of rows.entries()) {
      block(g, inL + 6 + ri * 4, y, inR - inL - 12 - ri * 8, 10, 0x6b4a2e, 4, { top: 0x4a3420 });
      for (let x = inL + 12 + ri * 4; x < inR - 10; x += 11) {
        plant(plants, x, y - 9, 0.8 + rnd() * 0.5, [0x5fbf4a, 0x7ad35a, 0x4aa040][Math.floor(rnd() * 3)]);
      }
    }
    fx.addChild(plants);
    const growY = inT + 16;
    g.rect(inL + 8, growY, inR - inL - 16, 4).fill(0x2a2a2a);
    g.rect(inL + 10, growY + 3, inR - inL - 20, 2).fill(pal.accent);
    const glow = new Graphics();
    softGlow(glow, (inL + inR) / 2, growY + 30, (inR - inL) * 0.55, 36, pal.accent, 0.35);
    ctxLight.addChild(glow);
    g.rect(inL, inT + 30, inR - inL, 3).fill(0x4a7aa8);
    return [(t, power) => {
      plants.skew.x = Math.sin(t * 1.3) * 0.03;
      glow.alpha = (0.75 + 0.25 * Math.sin(t * 2)) * (0.3 + 0.7 * power);
    }];
  },

  waterPump: (c) => {
    const { g, fx, inL, inR, inT, pal } = c;
    const yb = backY(c);
    const tx = inL + 26;
    cylinder(g, tx, yb, 18, 56, 0x4e7fa8, 0x6a9cc4);
    g.rect(tx - 3, yb - 52, 6, 40).fill({ color: 0x0b1a2a, alpha: 0.8 });
    const level = new Graphics();
    fx.addChild(level);
    block(g, tx + 26, yb, 26, 22, 0x6a7a8a, 5);
    g.rect(tx + 18, yb - 16, 10, 5).fill(0x8a8f96);
    g.rect(tx + 46, inT, 6, yb - 22 - inT).fill(0x4a6a8a);
    const vx = tx + 39, vy = yb - 30;
    g.circle(vx, vy, 7).stroke({ color: 0xc84a3a, width: 2.5 });
    g.circle(vx, vy, 1.8).fill(0xc84a3a);
    g.ellipse((inL + inR) / 2 + 10, ROOM_H - 6, 22, 3.5).fill({ color: pal.accent, alpha: 0.3 });
    const drip = new Graphics();
    fx.addChild(drip);
    return [(t, power) => {
      const fill = 0.55 + 0.25 * Math.sin(t * 0.7) * power;
      level.clear();
      level.rect(tx - 2, yb - 13 - 38 * fill, 4, 38 * fill).fill(pal.accent);
      drip.clear();
      const ph = (t * 0.8) % 1;
      drip.circle(tx + 49, yb - 20 + ph * 26, 1.4).fill({ color: 0xbfe8ff, alpha: 1 - ph });
    }];
  },

  workshop: (c) => {
    const { g, fx, inL, inR, inT, pal } = c;
    const yb = backY(c);
    block(g, inL + 8, yb, 70, 20, 0x7a5a3a, 6, { top: 0x9a7a52 });
    g.rect(inL + 14, yb - 26, 12, 6).fill(0x5a6068);
    g.rect(inL + 40, yb - 24, 8, 4).fill(0xb04a3a);
    g.rect(inL + 10, inT + 12, 66, 26).fill(0x8a6a4a);
    for (let i = 0; i < 6; i++) g.rect(inL + 15 + i * 10, inT + 16, 2.5, 14).fill([0x9aa0a8, 0xc0a040, 0x8a8f96, 0xb04a3a, 0x9aa0a8, 0x5a6068][i]);
    crate(g, inR - 30, ROOM_H - 6, 20);
    crate(g, inR - 27, ROOM_H - 22, 15, 0x8a6a40);
    const sparks = new Graphics();
    fx.addChild(sparks);
    const ox = inL + 20, oy = yb - 26;
    return [(t, power) => {
      sparks.clear();
      if (power < 0.5) return;
      const burst = Math.floor(t * 0.6);
      const phase = (t * 0.6) % 1;
      if (phase > 0.35) return;
      for (let i = 0; i < 7; i++) {
        const ang = -Math.PI / 2 + Math.sin(burst * 13 + i * 2.1) * 1.3;
        const d = phase * 70 * (0.5 + ((i * 37 + burst) % 10) / 20);
        sparks.circle(ox + Math.cos(ang) * d, oy + Math.sin(ang) * d + phase * phase * 60, 1.3).fill({ color: pal.accent, alpha: 1 - phase / 0.35 });
      }
    }];
  },

  medbay: (c) => {
    const { g, fx, inL, inR, inT, pal } = c;
    const yb = backY(c);
    block(g, inL + 10, yb, 54, 12, 0xb8bec4, 6);
    g.roundRect(inL + 12, yb - 18, 50, 6, 2).fill(0xf4f6f8);
    g.roundRect(inL + 13, yb - 21, 13, 5, 2).fill(0xffffff);
    g.rect(inL + 70, yb - 50, 2, 50).fill(0x9aa0a8);
    g.roundRect(inL + 66, yb - 52, 10, 13, 2).fill({ color: 0xbfe8ff, alpha: 0.8 });
    const cx = (inL + inR) / 2 + 20;
    g.rect(cx - 2, inT + 12, 5, 18).fill(pal.accent);
    g.rect(cx - 8, inT + 18, 17, 5).fill(pal.accent);
    block(g, inR - 26, yb, 18, 44, 0xdfe6ea, 4);
    g.rect(inR - 24, yb - 40, 14, 1.5).fill(0x9aa0a8);
    const mx = inL + 32, my = inT + 10;
    g.roundRect(mx, my, 22, 15, 2).fill(0x1a1a22);
    const beat = new Graphics();
    fx.addChild(beat);
    return [(t) => {
      beat.clear();
      const phase = (t * 1.2) % 1;
      beat.moveTo(mx + 2, my + 8);
      for (let i = 0; i <= 18; i++) {
        const spike = Math.abs(i / 18 - phase) < 0.06 ? -6 : 0;
        beat.lineTo(mx + 2 + i, my + 8 + spike);
      }
      beat.stroke({ color: 0x5aff8a, width: 1 });
    }];
  },

  canteen: (c) => {
    const { g, fx, inL, inR } = c;
    const yb = midY();
    block(g, inL + 30, yb, inR - inL - 48, 14, 0x8a6440, 6, { top: 0xa87c52 });
    for (let x = inL + 38; x < inR - 26; x += 16) {
      g.ellipse(x, yb - 15, 4, 1.6).fill(0xeeeeee);
      g.ellipse(x, yb - 15.5, 2.5, 1).fill(0xc8823a);
    }
    block(g, inL + 30, yb + 5, inR - inL - 48, 4, 0x5a4430, 3);
    const counterX = inL + 6;
    block(g, counterX, backY(c), 22, 26, 0x9aa0a8, 5);
    const pot = { x: counterX + 11, y: backY(c) - 26 };
    g.rect(pot.x - 7, pot.y - 7, 14, 7).fill(0x3a3a3a);
    g.ellipse(pot.x, pot.y - 7, 7, 2).fill(0x5a5a5a);
    block(g, inR - 22, backY(c), 16, 46, 0xdfe6ea, 4);
    const steam = new Graphics();
    fx.addChild(steam);
    return [(t) => {
      steam.clear();
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.6 + i / 3) % 1;
        steam.circle(pot.x + Math.sin(ph * 6 + i) * 3, pot.y - 10 - ph * 26, 2 + ph * 4).fill({ color: 0xffffff, alpha: 0.25 * (1 - ph) });
      }
    }];
  },

  storage: (c) => {
    const { g, inL, inR, rnd } = c;
    const yb = backY(c);
    for (let x = inL + 6; x < inR - 30; x += 44) {
      for (const level of [0, 24, 48]) g.rect(x, yb - level - 3, 40, 3).fill(0x6a6a6a);
      g.rect(x, yb - 52, 2, 52).fill(0x5a5a5a);
      g.rect(x + 38, yb - 52, 2, 52).fill(0x5a5a5a);
      for (const level of [0, 24]) {
        crate(g, x + 3, yb - level - 3, 14, [0x9a7446, 0x7a8a5a, 0x8a6a40][Math.floor(rnd() * 3)]);
        crate(g, x + 20, yb - level - 3, 14, [0x9a7446, 0x5a7a8a][Math.floor(rnd() * 2)]);
      }
    }
    cylinder(g, inR - 16, ROOM_H - 6, 8, 20, 0x3f6a4a);
    cylinder(g, inR - 34, ROOM_H - 6, 8, 20, 0x8a3a2a);
    return [];
  },

  laboratory: (c) => {
    const { g, lights, fx, inL, inR, inT, pal, lightLayer: ctxLight } = c;
    const yb = backY(c);
    const screens: { x: number; y: number }[] = [];
    for (let i = 0; i < 2; i++) {
      const x = inL + 8 + i * 42;
      block(g, x, yb, 38, 18, 0xc8ced4, 5, { top: 0xe4e8ec });
      g.roundRect(x + 9, yb - 36, 20, 14, 1.5).fill(0x1a1e24);
      g.rect(x + 18, yb - 22, 2, 4).fill(0x3a3f46);
      screens.push({ x: x + 11, y: yb - 34 });
    }
    g.rect(inR - 40, inT + 14, 32, 3).fill(0x8a8f96);
    g.rect(inR - 40, inT + 34, 32, 3).fill(0x8a8f96);
    const flasks = [0x6affd8, 0xff6ad8, 0xffd84a, 0x6aa8ff];
    for (let i = 0; i < 4; i++) {
      g.roundRect(inR - 37 + i * 8, inT + 4, 4, 10, 1.5).fill({ color: flasks[i], alpha: 0.85 });
      g.roundRect(inR - 37 + i * 8, inT + 24, 4, 10, 1.5).fill({ color: flasks[3 - i], alpha: 0.85 });
    }
    cylinder(g, inR - 24, ROOM_H - 6, 9, 16, 0xd0d4d8, 0x8a9096);
    const display = new Graphics();
    fx.addChild(display);
    const glow = new Graphics();
    for (const s of screens) softGlow(glow, s.x + 9, s.y + 6, 24, 14, pal.accent, 0.35);
    ctxLight.addChild(glow);
    return [(t, power) => {
      display.clear();
      for (const [i, s] of screens.entries()) {
        for (let l = 0; l < 4; l++) {
          const len = 5 + (Math.sin(t * 2 + l * 1.7 + i) + 1) * 5;
          display.rect(s.x, s.y + l * 2.8, len, 1.2).fill({ color: pal.accent, alpha: 0.85 * power });
        }
      }
      glow.alpha = 0.5 + 0.5 * power;
    }];
  },

  radioTower: (c) => {
    const { g, fx, inL, inR, inT, pal } = c;
    const yb = backY(c);
    block(g, inL + 8, yb, 56, 22, 0x5a5048, 6, { top: 0x6a6058 });
    block(g, inL + 12, yb - 22, 48, 26, 0x3a3a40, 5);
    for (let i = 0; i < 4; i++) g.circle(inL + 20 + i * 10, yb - 32, 3).stroke({ color: 0xd9a441, width: 1.2 });
    g.rect(inL + 16, yb - 44, 40, 6).fill(0x2a4a2a);
    g.rect(inL + 70, yb - 22, 14, 3).fill(0x2a2a2a);
    g.rect(inL + 76, yb - 22, 2, 22).fill(0x2a2a2a);
    g.rect(inL + 30, inT, 3, yb - 48 - inT).fill(0x1a1a1a);
    poster(g, inR - 26, inT + 12, 16, 20, 0x4a7a4a);
    const led = new Graphics();
    const wave = new Graphics();
    fx.addChild(led, wave);
    return [(t, power) => {
      led.clear();
      led.circle(inL + 58, yb - 41, 2).fill({ color: pal.accent, alpha: Math.sin(t * 5) > 0 ? 1 : 0.2 });
      wave.clear();
      wave.moveTo(inL + 18, yb - 41);
      for (let i = 0; i <= 18; i++) wave.lineTo(inL + 18 + i * 2, yb - 41 + Math.sin(t * 8 + i * 0.9) * 2 * power);
      wave.stroke({ color: 0x7aff7a, width: 1 });
    }];
  },

  hydroponics: (c) => {
    const { g, lights, fx, inL, inR, pal, rnd, lightLayer: ctxLight } = c;
    const yb = backY(c);
    const plants = new Graphics();
    const bars = new Graphics();
    for (let x = inL + 6; x < inR - 50; x += 56) {
      g.rect(x, yb - 66, 2.5, 66).fill(0x8a8f96);
      g.rect(x + 50, yb - 66, 2.5, 66).fill(0x8a8f96);
      for (const level of [0, 22, 44]) {
        g.rect(x, yb - level - 4, 52, 4).fill(0x6a6f76);
        g.rect(x + 2, yb - level - 8, 48, 4).fill(0x2a4a3a);
        for (let px = x + 6; px < x + 50; px += 8) plant(plants, px, yb - level - 8, 0.55 + rnd() * 0.25, [0x6ad35a, 0x8ae86a, 0x4ab04a][Math.floor(rnd() * 3)]);
        bars.rect(x + 3, yb - level - 22, 46, 2).fill(0xe8faff);
      }
    }
    cylinder(g, inR - 24, ROOM_H - 6, 12, 30, 0x3a7a5a, 0x5a9a7a);
    fx.addChild(plants, bars);
    const glow = new Graphics();
    softGlow(glow, (inL + inR) / 2 - 20, yb - 30, (inR - inL) * 0.5, 40, pal.light, 0.3);
    ctxLight.addChild(glow);
    return [(t, power) => {
      bars.alpha = 0.4 + 0.6 * power;
      glow.alpha = 0.4 + 0.6 * power;
      plants.skew.x = Math.sin(t * 1.1) * 0.02;
    }];
  },

  waterPurifier: (c) => {
    const { g, fx, inL, inR, inT, pal } = c;
    const yb = backY(c);
    const tanks = [inL + 24, inL + 62];
    for (const x of tanks) cylinder(g, x, yb, 15, 54, 0x6a8aa8, 0x8aaac8);
    g.rect(tanks[0], yb - 44, tanks[1] - tanks[0], 5).fill(0x4a6a8a);
    g.rect(tanks[1] + 15, yb - 30, inR - tanks[1] - 20, 5).fill(0x4a6a8a);
    g.rect(tanks[0] - 2, inT, 5, yb - 56 - inT).fill(0x4a6a8a);
    const gx = (tanks[0] + tanks[1]) / 2, gy = yb - 52;
    g.circle(gx, gy, 6).fill(0xe8e8e8).stroke({ color: 0x3a3a3a, width: 1.2 });
    const needle = new Graphics();
    const bubbles = new Graphics();
    fx.addChild(needle, bubbles);
    return [(t, power) => {
      needle.clear();
      const ang = -Math.PI / 2 + Math.sin(t * 0.8) * 0.7 * power;
      needle.moveTo(gx, gy).lineTo(gx + Math.cos(ang) * 5, gy + Math.sin(ang) * 5).stroke({ color: 0xd04a3a, width: 1.2 });
      bubbles.clear();
      if (power < 0.4) return;
      for (const x of tanks) {
        for (let i = 0; i < 3; i++) {
          const ph = (t * 0.5 + i / 3 + x * 0.01) % 1;
          bubbles.circle(x - 6 + i * 6, yb - 6 - ph * 44, 1.4).fill({ color: pal.light, alpha: 0.7 * (1 - ph) });
        }
      }
    }];
  },

  trainingRoom: (c) => {
    const { g, fx, inL, inR, inT } = c;
    g.poly([inL + 6, ROOM_H - 14, inR - 6, ROOM_H - 14, inR, ROOM_H - 3, inL, ROOM_H - 3]).fill({ color: 0x3a4a6a, alpha: 0.9 });
    block(g, inR - 60, backY(c), 44, 10, 0x2a2a2a, 5);
    g.rect(inR - 64, backY(c) - 24, 52, 3).fill(0x9aa0a8);
    for (const dx of [-66, -14]) g.roundRect(inR + dx, backY(c) - 30, 6, 15, 2).fill(0x3a3a3a);
    for (let i = 0; i < 3; i++) g.roundRect(inL + 10 + i * 12, backY(c) - 8, 9, 5, 2).fill(0x5a5a5a);
    const hookX = inL + (inR - inL) * 0.4;
    g.rect(hookX - 8, inT, 16, 3).fill(0x5a5a5a);
    const bag = new Graphics();
    bag.moveTo(0, 0).lineTo(0, 18).stroke({ color: 0x1a1a1a, width: 1 });
    bag.roundRect(-7, 18, 14, 30, 6).fill(0xa04a3a);
    bag.roundRect(-7, 18, 4, 30, 3).fill({ color: 0x000000, alpha: 0.2 });
    bag.position.set(hookX, inT + 3);
    fx.addChild(bag);
    return [(t) => { bag.rotation = Math.sin(t * 2.2) * 0.12; }];
  },

  armory: (c) => {
    const { g, lights, inL, inR, inT, lightLayer: ctxLight } = c;
    const yb = backY(c);
    g.rect(inL + 6, inT + 10, 60, 50).fill(0x4a4038);
    for (let i = 0; i < 5; i++) {
      const x = inL + 12 + i * 11;
      g.rect(x, inT + 14, 3, 40).fill(0x2a2a2a);
      g.rect(x - 1, inT + 40, 5, 12).fill(0x5a3a2a);
    }
    block(g, inR - 40, yb, 30, 16, 0x4a5a3a, 5);
    block(g, inR - 36, yb - 16, 20, 10, 0x3a4a2a, 4);
    const tx = inR - 20, ty = inT + 22;
    for (const [r, col] of [[10, 0xffffff], [7, 0xd04a3a], [4, 0xffffff], [1.6, 0xd04a3a]] as const) g.circle(tx, ty, r).fill(col);
    softGlow(lights, inL + 30, inT + 30, 40, 30, 0xff5a3a, 0.16);
    return [];
  },

  reactor: (c) => {
    const { g, lights, fx, inL, inR, inB, pal, lightLayer: ctxLight } = c;
    const cx = (inL + inR) / 2;
    const yb = midY();
    for (let x = inL; x < inR; x += 12) g.poly([x, inB + 3, x + 6, inB + 3, x + 4, inB + 7, x - 2, inB + 7]).fill(0xffcc22);
    cylinder(g, cx, yb, 30, 12, 0x5a6058, 0x6a7068);
    cylinder(g, cx, yb - 12, 20, 52, 0x3a5a3a, 0x4a6a4a);
    for (const dx of [-36, 36]) g.rect(cx + dx - 2, inB - 64, 4, 70).fill(0x8a8f96);
    g.rect(cx - 38, inB - 66, 76, 4).fill(0x8a8f96);
    const core = new Graphics();
    core.roundRect(cx - 9, yb - 58, 18, 40, 8).fill(pal.accent);
    fx.addChild(core);
    const pulse = new Graphics();
    softGlow(pulse, cx, yb - 38, 80, 56, pal.accent, 0.5);
    ctxLight.addChild(pulse);
    return [(t, power) => {
      const s = 0.65 + 0.35 * Math.sin(t * 2.5);
      core.alpha = s;
      pulse.alpha = s * (0.5 + 0.5 * power);
    }];
  },

  // ---- [plan4:BL-9..14,19,33] code-drawn looks of the first eight new rooms (a richer RoomComposer look comes later) ----

  batteryBank: (c) => {
    const { g, fx, inL, inR, pal } = c;
    const yb = backY(c);
    const leds = new Graphics();
    fx.addChild(leds);
    const cells: { x: number; y: number }[] = [];
    for (const level of [0, 27]) {
      g.rect(inL + 6, yb - level - 3, inR - inL - 40, 3).fill(0x6a6f76);
      for (let x = inL + 10; x < inR - 44; x += 17) {
        block(g, x, yb - level - 3, 13, 20, 0x4a6a88, 3);
        g.rect(x + 4, yb - level - 26, 5, 3).fill(0x9aa0a8);
        cells.push({ x: x + 6.5, y: yb - level - 12 });
      }
    }
    // The load meter and the fat cables to the wall.
    block(g, inR - 30, yb, 20, 44, 0x5a6068, 4);
    g.roundRect(inR - 27, yb - 40, 14, 12, 2).fill(0x14181e);
    for (let x = inL + 8; x < inR - 24; x += 38) g.rect(x, yb - 62, 3, 14).fill(0x2a2a2a);
    g.rect(inL + 6, yb - 62, inR - inL - 40, 3).fill(0x2a2a2a);
    return [(t, power) => {
      leds.clear();
      for (const [i, cell] of cells.entries()) {
        const on = power > 0.3 && Math.sin(t * 1.6 + i * 1.9) > -0.3;
        leds.circle(cell.x, cell.y, 1.8).fill({ color: on ? pal.accent : 0x2a3a4a, alpha: on ? 1 : 0.8 });
      }
      const fill = 0.35 + 0.3 * Math.sin(t * 0.3);
      leds.rect(inR - 25, yb - 38, 10 * fill, 8).fill({ color: 0x5aff8a, alpha: 0.85 });
    }];
  },

  commons: (c) => {
    const { g, fx, inL, inR, inT, rnd } = c;
    const yb = midY();
    const w = inR - inL;
    // A rug, a low table with cards, two couches and an old radio on a shelf.
    g.ellipse(inL + w * 0.5, yb + 3, w * 0.34, 5).fill(0x8a3a3a);
    g.ellipse(inL + w * 0.5, yb + 3, w * 0.26, 3.4).fill(0xb8584a);
    block(g, inL + w * 0.5 - 16, yb, 32, 8, 0x6a4a30, 4, { top: 0x8a6a48 });
    for (let i = 0; i < 3; i++) g.rect(inL + w * 0.5 - 10 + i * 8, yb - 12, 6, 4).fill([0xf2efe6, 0xc04a4a, 0xf2efe6][i]);
    const couch = (x: number, flip: number) => {
      block(g, x, backY(c), 40, 14, [0x6a7a5a, 0x7a5a5a][Math.floor(rnd() * 2)], 5);
      g.roundRect(x, backY(c) - 32, 40, 18, 4).fill(0x55604a);
      g.rect(flip > 0 ? x + 36 : x - 2, backY(c) - 24, 6, 14).fill(0x4a5440);
    };
    couch(inL + 8, 1);
    if (w > 110) couch(inR - 52, -1);
    g.rect(inL + w * 0.55, inT + 18, 30, 3).fill(0x5a4430);
    g.roundRect(inL + w * 0.55 + 4, inT + 6, 22, 12, 2).fill(0x3a3a40);
    g.circle(inL + w * 0.55 + 10, inT + 12, 3).stroke({ color: 0xd9a441, width: 1 });
    const waves = new Graphics();
    fx.addChild(waves);
    return [(t, power) => {
      waves.clear();
      if (power < 0.3) return;
      for (let i = 0; i < 2; i++) {
        const ph = (t * 0.7 + i / 2) % 1;
        waves.arc(inL + w * 0.55 + 15, inT + 12, 6 + ph * 10, -2.6, -0.5).stroke({ color: 0xffd9a0, width: 1, alpha: 0.6 * (1 - ph) });
      }
    }];
  },

  library: (c) => {
    const { g, inL, inR, inT, pal, rnd, lightLayer: ctxLight } = c;
    const yb = backY(c);
    const w = inR - inL;
    // Tall shelves of book spines.
    const spines = [0x8a3a3a, 0x3a5a8a, 0x5a7a3a, 0xc09a3a, 0x6a4a7a, 0x9a6a3a];
    const shelves = Math.max(1, Math.floor((w - 50) / 46));
    for (let s = 0; s < shelves; s++) {
      const x = inL + 6 + s * 46;
      g.rect(x, yb - 66, 42, 66).fill(0x4a3828);
      for (const level of [0, 21, 42]) {
        g.rect(x + 2, yb - level - 3, 38, 3).fill(0x6a5238);
        for (let bx = x + 3; bx < x + 38; bx += 4 + Math.floor(rnd() * 3)) {
          const h = 11 + Math.floor(rnd() * 7);
          g.rect(bx, yb - level - 3 - h, 3 + Math.floor(rnd() * 2), h).fill(spines[Math.floor(rnd() * spines.length)]);
        }
      }
    }
    // A reading table with a lamp.
    const tx = inR - 54;
    block(g, tx, ROOM_H - 9, 44, 10, 0x6a4a30, 5, { top: 0x8a6a48 });
    g.rect(tx + 8, ROOM_H - 24, 14, 3).fill(0xe8dcc0);
    g.rect(tx + 28, ROOM_H - 40, 2, 20).fill(0x2a2a2a);
    g.poly([tx + 22, ROOM_H - 40, tx + 36, ROOM_H - 40, tx + 33, ROOM_H - 46, tx + 25, ROOM_H - 46]).fill(0x4a6a3a);
    const glow = new Graphics();
    softGlow(glow, tx + 29, ROOM_H - 30, 40, 26, pal.accent, 0.35);
    ctxLight.addChild(glow);
    g.rect(inL, inT + 4, w, 2).fill({ color: 0x000000, alpha: 0.15 });
    return [(t, power) => { glow.alpha = (0.7 + 0.2 * Math.sin(t * 1.4)) * (0.3 + 0.7 * power); }];
  },

  recycler: (c) => {
    const { g, fx, inL, inR, inT, pal } = c;
    const w = inR - inL;
    const yb = midY();
    // A conveyor along the room, a shredder box at one end, bins and a magnet crane overhead.
    block(g, inL + 8, yb, w - 54, 8, 0x3a3a3a, 4, { top: 0x55555a });
    for (let x = inL + 14; x < inL + w - 52; x += 10) g.rect(x, yb - 7, 2, 6).fill({ color: 0x000000, alpha: 0.35 });
    block(g, inR - 44, backY(c), 34, 36, 0x6a4a3a, 5);
    g.rect(inR - 38, backY(c) - 30, 22, 8).fill(0x2a2a2a);
    for (let i = 0; i < 3; i++) g.poly([inR - 37 + i * 7, backY(c) - 30, inR - 33 + i * 7, backY(c) - 30, inR - 35 + i * 7, backY(c) - 24]).fill(0xb0b4b8);
    for (const [i, col] of [0x3f6a4a, 0x4a6a8a, 0x8a3a2a].entries()) cylinder(g, inL + 14 + i * 16, backY(c), 7, 22, col);
    g.rect(inL + 6, inT + 10, w - 12, 3).fill(0x5a5a5a);
    const crane = new Graphics();
    const items = new Graphics();
    fx.addChild(crane, items);
    return [(t, power) => {
      const cx = inL + 30 + (0.5 + 0.5 * Math.sin(t * 0.5)) * (w - 100);
      crane.clear();
      crane.rect(cx - 5, inT + 9, 10, 5).fill(0x8a8f96);
      crane.moveTo(cx, inT + 14).lineTo(cx, inT + 34).stroke({ color: 0x2a2a2a, width: 1 });
      crane.circle(cx, inT + 37, 4.5).fill(pal.accent);
      items.clear();
      if (power < 0.3) return;
      const off = (t * 8) % 10;
      for (let x = inL + 16; x < inL + w - 56; x += 20) items.roundRect(x + off, yb - 13, 8, 6, 1.5).fill(0x9a8a6a);
    }];
  },

  condenser: (c) => {
    const { g, fx, inL, inR, inT, pal } = c;
    const yb = backY(c);
    const w = inR - inL;
    // A wall of cooling coils, a big fan and a drip tray with a water tank.
    g.rect(inL + 6, inT + 10, w * 0.52, 48).fill(0x2a4a5e);
    for (let y = inT + 16; y < inT + 56; y += 7) g.moveTo(inL + 10, y).lineTo(inL + 6 + w * 0.52 - 4, y).stroke({ color: 0x9ad8f0, width: 1.6, alpha: 0.8 });
    const fanX = inL + 6 + w * 0.52 + 26, fanY = yb - 30;
    g.circle(fanX, fanY, 20).fill(0x2a2e34);
    g.circle(fanX, fanY, 18).stroke({ color: 0x8a8f96, width: 2 });
    const blades = new Graphics();
    blades.position.set(fanX, fanY);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      blades.ellipse(Math.cos(a) * 8, Math.sin(a) * 8, 8, 3.2).fill(0x9aa0a8);
    }
    blades.circle(0, 0, 3.2).fill(0x5a6068);
    fx.addChild(blades);
    cylinder(g, inR - 18, ROOM_H - 6, 9, 30, 0x4e7fa8, 0x6a9cc4);
    g.ellipse(inL + 6 + w * 0.26, yb + 2, w * 0.24, 3).fill({ color: pal.accent, alpha: 0.35 });
    const drops = new Graphics();
    fx.addChild(drops);
    return [(t, power) => {
      blades.rotation += 0.22 * power;
      drops.clear();
      if (power < 0.3) return;
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.7 + i / 3) % 1;
        drops.circle(inL + 20 + i * (w * 0.2), inT + 58 + ph * (yb - inT - 62), 1.5).fill({ color: 0xbfe8ff, alpha: 1 - ph });
      }
    }];
  },

  mushroomFarm: (c) => {
    const { g, fx, inL, inR, pal, rnd, lightLayer: ctxLight } = c;
    const yb = backY(c);
    const caps = new Graphics();
    const glow = new Graphics();
    // Damp racks of pale mushrooms; the caps glow faintly.
    for (let x = inL + 6; x < inR - 50; x += 52) {
      g.rect(x, yb - 62, 2.5, 62).fill(0x5a5e66);
      g.rect(x + 46, yb - 62, 2.5, 62).fill(0x5a5e66);
      for (const level of [0, 21, 42]) {
        g.rect(x, yb - level - 4, 49, 4).fill(0x4a4e56);
        g.rect(x + 2, yb - level - 9, 45, 5).fill(0x3a2e24);
        for (let px = x + 6; px < x + 44; px += 8) {
          const s = 0.7 + rnd() * 0.6;
          const col = [0xd8c8f0, 0xf0e0c0, 0xc8d8f0][Math.floor(rnd() * 3)];
          g.rect(px - 0.8, yb - level - 15 * s, 1.6, 6 * s).fill(0xe8e0d0);
          caps.ellipse(px, yb - level - 15 * s, 4 * s, 2.6 * s).fill(col);
        }
        softGlow(glow, x + 24, yb - level - 14, 28, 9, pal.accent, 0.25);
      }
    }
    cylinder(g, inR - 20, ROOM_H - 6, 8, 20, 0x5a5e66);
    fx.addChild(caps);
    ctxLight.addChild(glow);
    const spores = new Graphics();
    fx.addChild(spores);
    return [(t, power) => {
      glow.alpha = 0.55 + 0.35 * Math.sin(t * 0.9);
      spores.clear();
      for (let i = 0; i < 5; i++) {
        const ph = (t * 0.12 + i / 5) % 1;
        spores.circle(inL + 14 + ((i * 53) % Math.max(20, inR - inL - 28)), yb - 10 - ph * 50, 1).fill({ color: pal.light, alpha: 0.5 * (1 - ph) * (0.3 + 0.7 * power) });
      }
    }];
  },

  gatePost: (c) => {
    const { g, fx, inL, inR, inT, pal } = c;
    const yb = backY(c);
    const w = inR - inL;
    // A blast door with a hazard frame, a floodlight, a sign and a sandbag barrier up front.
    const dx = inL + 12, dw = Math.min(56, w * 0.5);
    g.rect(dx - 4, inT + 6, dw + 8, yb - inT - 6).fill(0x2a2a2a);
    g.rect(dx, inT + 10, dw, yb - inT - 10).fill(0x5a5e62);
    for (let y = inT + 20; y < yb - 6; y += 16) g.rect(dx + 3, y, dw - 6, 2).fill(0x44484c);
    g.circle(dx + dw - 9, (inT + yb) / 2, 5).stroke({ color: 0xc84a3a, width: 2 });
    for (let x = dx - 4; x < dx + dw + 4; x += 10) g.poly([x, inT + 6, x + 5, inT + 6, x + 3, inT + 10, x - 2, inT + 10]).fill(0xffcc22);
    g.rect(inR - 38, inT + 14, 28, 18).fill(0x3a3a3a);
    g.rect(inR - 36, inT + 16, 24, 14).fill(0xe0d8c0);
    g.rect(inR - 33, inT + 20, 18, 2).fill(0x5a4a3a);
    g.rect(inR - 33, inT + 25, 12, 2).fill(0x5a4a3a);
    for (let i = 0; i < 4; i++) g.ellipse(inL + w * 0.45 + i * 14, ROOM_H - 8 - (i % 2) * 6, 9, 5).fill(i % 2 ? 0x8a7a52 : 0x9a8a60);
    const beam = new Graphics();
    fx.addChild(beam);
    return [(t, power) => {
      beam.clear();
      const a = (0.25 + 0.2 * Math.sin(t * 1.1)) * (0.3 + 0.7 * power);
      beam.poly([dx + dw + 8, inT + 12, dx + dw + 14, inT + 12, inR - 4, ROOM_H - 4, dx + dw + 30, ROOM_H - 4]).fill({ color: pal.light, alpha: a * 0.5 });
      beam.circle(dx + dw + 11, inT + 12, 3).fill({ color: pal.light, alpha: 0.4 + a });
    }];
  },

  barracks: (c) => {
    const { g, fx, inL, inR, inT, rnd } = c;
    const w = inR - inL;
    // Bunks with olive blankets, a weapon rack and a duty roster.
    const sheets = [0x5a6a4a, 0x6a6a4a, 0x4a5a3a];
    const beds = Math.max(1, Math.floor((w - 60) / 46));
    for (let i = 0; i < beds; i++) {
      const x = inL + 6 + i * 46;
      const yb = backY(c);
      for (const px of [x, x + 38]) g.rect(px, yb - 58, 3, 58).fill(0x6d7380);
      for (const level of [0, 26]) {
        g.rect(x, yb - 12 - level, 41, 4).fill(0x5a606a);
        g.roundRect(x + 2, yb - 18 - level, 37, 6, 2).fill(sheets[Math.floor(rnd() * sheets.length)]);
        g.roundRect(x + 3, yb - 21 - level, 11, 5, 2).fill(0xe2dccb);
      }
    }
    const rx = inR - 44;
    g.rect(rx, inT + 12, 36, 44).fill(0x3a3a34);
    for (let i = 0; i < 4; i++) {
      g.rect(rx + 5 + i * 8, inT + 16, 2.5, 34).fill(0x1e1e1e);
      g.rect(rx + 4 + i * 8, inT + 38, 5, 9).fill(0x5a3a2a);
    }
    g.rect(inL + w * 0.4, inT + 14, 20, 26).fill(0xe8dcc0);
    for (let i = 0; i < 4; i++) g.rect(inL + w * 0.4 + 3, inT + 19 + i * 6, 14, 2).fill(0x5a4a3a);
    const lamp = new Graphics();
    fx.addChild(lamp);
    return [(t) => {
      lamp.clear();
      lamp.circle(inL + w * 0.4 + 10, inT + 10, 2).fill({ color: 0xff4a3a, alpha: Math.sin(t * 2) > 0 ? 1 : 0.25 });
    }];
  },
};

export interface RoomVisual {
  container: Container;
  animate: Animator;
}

/** A finished room: shell, furniture, light and animated details. Local origin = top-left of the opening. */
export function buildRoomVisual(type: BuildingType, W: number, openLeft: boolean, openRight: boolean, rnd: () => number): RoomVisual {
  const pal = PALETTES[type] ?? PALETTES.storage;
  const container = new Container();
  const g = new Graphics();
  const lightLayer = new Container();
  lightLayer.blendMode = 'add';
  const lights = new Graphics();
  lightLayer.addChild(lights);
  const fx = new Container();
  const ctx: Ctx = {
    g, lights, lightLayer, fx, W, pal, rnd,
    inL: openLeft ? 0 : DEPTH_X,
    inR: openRight ? W : W - DEPTH_X,
    inT: DEPTH_TOP,
    inB: ROOM_H - DEPTH_BOTTOM,
  };
  drawShell(ctx, openLeft, openRight);
  const animators: Animator[] = [ceilingLamp(ctx)];
  const deco = DECORATORS[type];
  if (deco) animators.push(...deco(ctx));
  container.addChild(g, fx, lightLayer);
  return {
    container,
    animate: (t, power) => {
      for (const a of animators) a(t, power);
    },
  };
}

/** Scaffold poles, planks and a hazard edge drawn over a room under construction or upgrade. */
export function buildScaffold(W: number): RoomVisual {
  const container = new Container();
  const g = new Graphics();
  const wood = 0xb08a52;
  for (const x of [6, W - 10, W / 2 - 2]) {
    g.rect(x, 6, 4, ROOM_H - 10).fill(wood);
    g.rect(x + 3, 6, 1, ROOM_H - 10).fill({ color: 0x000000, alpha: 0.3 });
  }
  for (const y of [ROOM_H * 0.38, ROOM_H * 0.68]) {
    g.rect(4, y, W - 8, 4).fill(shade(wood, 0.85));
    g.rect(4, y + 3, W - 8, 1).fill({ color: 0x000000, alpha: 0.35 });
  }
  g.moveTo(8, ROOM_H * 0.38).lineTo(W / 2, ROOM_H * 0.68).stroke({ color: shade(wood, 0.7), width: 2 });
  g.moveTo(W - 8, ROOM_H * 0.38).lineTo(W / 2, ROOM_H * 0.68).stroke({ color: shade(wood, 0.7), width: 2 });
  for (let x = 0; x < W; x += 16) g.poly([x, ROOM_H - 4, x + 8, ROOM_H - 4, x + 6, ROOM_H, x - 2, ROOM_H]).fill(0xffcc22);
  const sparks = new Graphics();
  sparks.blendMode = 'add';
  container.addChild(g, sparks);
  const pts: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
  let last = -1;
  return {
    container,
    animate: (t) => {
      const dt = last < 0 ? 0 : Math.min(0.1, t - last);
      last = t;
      // Welding: bursts of sparks from a point that wanders along the top plank.
      if (Math.sin(t * 2.3) > 0.4 && pts.length < 40) {
        const sx = W * (0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.7)));
        for (let i = 0; i < 2; i++) pts.push({ x: sx, y: ROOM_H * 0.38, vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 30, life: 0 });
      }
      sparks.clear();
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        p.life += dt;
        p.vy += 140 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.life > 0.6 || p.y > ROOM_H) {
          pts.splice(i, 1);
          continue;
        }
        sparks.circle(p.x, p.y, 1.1).fill({ color: 0xffd27a, alpha: 1 - p.life / 0.6 });
      }
      if (Math.sin(t * 2.3) > 0.4) sparks.circle(W * (0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.7))), ROOM_H * 0.38, 6).fill({ color: 0xbfe6ff, alpha: 0.5 + 0.5 * Math.random() });
    },
  };
}

/** The room's own painting as a cool blueprint ghost, behind scaffolding, while it is first built. */
export function buildPaintedConstruction(texture: Texture, W: number, H: number = ROOM_H): RoomVisual {
  const container = new Container();
  const bg = new Graphics();
  bg.rect(0, 0, W, H).fill(0x0e1822);
  const ghost = new Sprite(texture);
  ghost.width = W;
  ghost.height = H;
  ghost.tint = 0x7fb6dc;
  ghost.alpha = 0.42;
  const grid = new Graphics();
  for (let x = 8; x < W; x += 12) grid.rect(x, 0, 1, H).fill({ color: 0x5ad8ff, alpha: 0.12 });
  for (let y = 8; y < H; y += 12) grid.rect(0, y, W, 1).fill({ color: 0x5ad8ff, alpha: 0.12 });
  grid.rect(2, 2, W - 4, H - 4).stroke({ color: 0x5ad8ff, width: 1, alpha: 0.6 });
  const scaffold = buildScaffold(W);
  container.addChild(bg, ghost, grid, scaffold.container);
  return {
    container,
    animate: (t, power) => {
      ghost.alpha = 0.36 + 0.08 * Math.sin(t * 2.4);
      scaffold.animate(t, power);
    },
  };
}

/** Blueprint hologram and scaffolding while a room is first being built. */
export function buildConstructionVisual(type: BuildingType, W: number): RoomVisual {
  const pal = PALETTES[type] ?? PALETTES.storage;
  const container = new Container();
  const g = new Graphics();
  const inL = DEPTH_X, inR = W - DEPTH_X, inT = DEPTH_TOP, inB = ROOM_H - DEPTH_BOTTOM;
  g.rect(inL, inT, inR - inL, inB - inT).fill(0x2a2a32);
  g.poly([0, 0, W, 0, inR, inT, inL, inT]).fill(0x1e1e24);
  g.poly([inL, inB, inR, inB, W, ROOM_H, 0, ROOM_H]).fill(0x3a3a44);
  g.poly([0, 0, inL, inT, inL, inB, 0, ROOM_H]).fill(0x26262e);
  g.poly([inR, inT, W, 0, W, ROOM_H, inR, inB]).fill(0x222228);
  const holo = 0x5ad8ff;
  g.rect(inL + 6, inT + 6, inR - inL - 12, inB - inT - 6).stroke({ color: holo, width: 1, alpha: 0.6 });
  for (let x = inL + 18; x < inR - 6; x += 18) g.moveTo(x, inT + 6).lineTo(x, inB).stroke({ color: holo, width: 0.6, alpha: 0.3 });
  const scaffold = 0xd9a441;
  for (const x of [inL + 4, inR - 7, (inL + inR) / 2]) g.rect(x, inT + 4, 3, ROOM_H - inT - 8).fill(scaffold);
  for (const y of [inT + 26, inT + 54]) g.rect(inL + 4, y, inR - inL - 8, 3).fill(shade(scaffold, 0.8));
  crate(g, (inL + inR) / 2 + 8, ROOM_H - 6, 18, mix(pal.accent, 0x9a7446, 0.6));
  for (let x = 0; x < W; x += 16) g.poly([x, ROOM_H - 4, x + 8, ROOM_H - 4, x + 6, ROOM_H, x - 2, ROOM_H]).fill(0xffcc22);
  const lights = new Graphics();
  lights.blendMode = 'add';
  softGlow(lights, W / 2, ROOM_H / 2, W * 0.5, ROOM_H * 0.45, holo, 0.18);
  container.addChild(g, lights);
  return {
    container,
    animate: (t) => { lights.alpha = 0.6 + 0.4 * Math.sin(t * 3); },
  };
}

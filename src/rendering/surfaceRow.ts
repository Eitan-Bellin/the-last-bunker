import { Container, Graphics, Sprite } from 'pixi.js';
import { ArtLibrary, glowTexture, moteTexture } from '../art/ArtLibrary';
import { bus } from '../core/EventBus';
import type { BuildingType, GameState, Ruin } from '../core/GameState';
import { windAt } from '../data/dayCycle';
import { reducedMotion } from '../utils/a11y';
import { ROOM_H, SLOT_W, slotX } from './geom';
import { hGradient, mix, seeded, shade, vGradient } from './draw';
import type { RoomVisual } from './roomArt';
import type { RuinVisual } from './ruinArt';

/**
 * [plan4:ST-16] The surface (gate-house) row, floor -1: rooms that stand on the open ground west of the entrance hill.
 *
 * A room on this row is an ordinary building (placed, staffed, upgraded, wrecked like any other); only its look differs: instead of a room
 * cut open in the rock it is a structure standing on a concrete apron, lit by the sky (the clock tint, the weather and the wind of
 * surface2.ts) and not by the lamps of a floor. RoomViews asks `buildSurfaceBlock` for it, BunkerRenderer asks `buildSurfaceRuin` for a wreck.
 * Everything here is drawn with code (no new paintings): gradients and soft shapes, a handful of objects per room.
 *
 * Local coordinates match a room's: origin = top-left of the room's 100-tall box, the ground line at y = ROOM_H.
 */

/** West and east edge (world x) of the row's slots -11..-4, and of the concrete apron it stands on. */
export const ROW_X0 = slotX(-11);
export const ROW_X1 = slotX(-4) + SLOT_W;

/** What the sky is doing, written by surface2.animate every picture and read by every block (module state: one surface at a time). */
export const surfaceLive = { light: 0xffffff, night: 0, wind: 0.6, rain: 0, play: 0 };

const G = ROOM_H;

/** What a look's animator is told each picture. */
interface Env {
  t: number;
  dt: number;
  /** 0 night .. 1 midday. */
  day: number;
  /** 0..1 how dark the lamps want it (starts at dusk). */
  dark: number;
  /** 0..1 the gust of the game clock (the same curve the turbines' output follows). */
  gust: number;
  power: number;
  calm: boolean;
}
type Animator = (e: Env) => void;
interface Look {
  /** Drawn with the sky's tint. */
  body: Container;
  /** Lamps, glints and beams: additive, never darkened by the tint (their own alpha follows the night). */
  glows: Container;
  animate: Animator | null;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function glowSprite(x: number, y: number, size: number, color: number): Sprite {
  const s = new Sprite(glowTexture());
  s.anchor.set(0.5);
  s.position.set(x, y);
  s.width = s.height = size;
  s.tint = color;
  s.blendMode = 'add';
  s.alpha = 0;
  return s;
}

/** Gate openings and wheel kicks: the gate post's barrier lifts when a team leaves or comes home. */
let gateKicks = 0;
let busHooked = false;
function hookBus(): void {
  if (busHooked) return;
  busHooked = true;
  const kick = () => { gateKicks = Math.min(gateKicks + 1, 3); };
  bus.on('mission:start', kick);
  bus.on('mission:complete', kick);
  bus.on('mission:recall', kick);
}

/** The concrete footing every block stands on: a lit lip, joints at the slot lines, and a shadow on the apron. */
function plinth(W: number): Graphics {
  const g = new Graphics();
  g.rect(-3, G - 7, W + 6, 8).fill(vGradient([[0, 0xb8b2a4], [0.45, 0x8d887d], [1, 0x57534b]]));
  g.rect(-3, G - 7, W + 6, 1.6).fill({ color: 0xe6e0d0, alpha: 0.55 });
  for (let x = SLOT_W; x < W - 1; x += SLOT_W) g.rect(x - 0.6, G - 6.4, 1.2, 6.4).fill({ color: 0x24221e, alpha: 0.4 });
  g.rect(-3, G + 1, W + 6, 5).fill({ color: 0x000000, alpha: 0.26 });
  // A few bolts and a stain or two: poured a long time ago.
  for (const x of [4, W - 5]) g.circle(x, G - 3.4, 1).fill({ color: 0x2c2a26, alpha: 0.7 });
  g.ellipse(W * 0.3, G - 2.6, W * 0.12, 1.6).fill({ color: 0x3a3228, alpha: 0.28 });
  return g;
}

// ---------- Solar array ----------

function solarLook(W: number, rnd: () => number): Look {
  const body = new Container();
  const glows = new Container();
  const n = Math.max(2, Math.round(W / 30));
  const step = (W - 6) / n;
  const sheens: Graphics[] = [];
  // Back row first (smaller, dimmer, a little higher), then the front row.
  for (const row of [0, 1]) {
    const k = row === 0 ? 0.78 : 1;
    const count = row === 0 ? Math.max(1, n - 1) : n;
    const off = row === 0 ? step * 0.5 : 0;
    for (let i = 0; i < count; i++) {
      const w = (step - 3) * k, h = 30 * k;
      const x = 3 + off + i * step + (step - 3 - w) / 2;
      const yb = G - (row === 0 ? 24 : 15) + (rnd() - 0.5) * 0.6;
      const top = 0.84;
      const quad = [x, yb, x + w, yb, x + w * (0.5 + top / 2), yb - h, x + w * (0.5 - top / 2), yb - h];
      const g = new Graphics();
      // Legs and the frame's rear brace.
      g.rect(x + w * 0.2, yb - 1, 2, G - 6 - yb + 1).fill(0x4a4d52);
      g.rect(x + w * 0.76, yb - 1, 2, G - 6 - yb + 1).fill(0x3c3f44);
      g.poly(quad).fill(vGradient([[0, row ? 0x2c4e7c : 0x24406a], [0.55, row ? 0x1c3358 : 0x172a48], [1, row ? 0x122240 : 0x0e1a30]]));
      // Cells: three rows, four columns, thin and quiet.
      for (let r = 1; r < 3; r++) {
        const f = r / 3, y = yb - h * f, half = w * (0.5 + (1 - (1 - top) * f) / 2) - w * 0.5;
        g.rect(x + w * 0.5 - half, y - 0.4, half * 2, 0.8).fill({ color: 0x9ab4d8, alpha: 0.22 });
      }
      for (let c = 1; c < 4; c++) {
        const f = c / 4;
        g.poly([x + w * f, yb, x + w * f + 0.9, yb, x + w * (0.5 + top * (f - 0.5)) + 0.9, yb - h, x + w * (0.5 + top * (f - 0.5)), yb - h]).fill({ color: 0x9ab4d8, alpha: 0.2 });
      }
      g.poly(quad).stroke({ color: row ? 0xb8bcc2 : 0xd4d8dc, width: 1.4, alpha: 0.9 });
      g.poly([x + w * (0.5 - top / 2), yb - h, x + w * (0.5 + top / 2), yb - h, x + w * (0.5 + top / 2) - 2, yb - h + 2.4, x + w * (0.5 - top / 2) + 2, yb - h + 2.4]).fill({ color: 0xffffff, alpha: 0.28 });
      body.addChild(g);
      // The sky in the glass: a pale veil that grows with the sun.
      const veil = new Graphics();
      veil.poly(quad).fill(vGradient([[0, 0xbfe0ff, 0.9], [1, 0x6a9ad0, 0.2]]));
      veil.blendMode = 'add';
      veil.alpha = 0;
      glows.addChild(veil);
      sheens.push(veil);
    }
  }
  // A grey inverter cabinet at the east end with a status lamp, and the cable that runs to it.
  const cab = new Graphics();
  cab.roundRect(W - 14, G - 22, 11, 15, 1.4).fill(vGradient([[0, 0x8a8f94], [1, 0x50555a]]));
  cab.rect(W - 12, G - 19, 7, 5).fill({ color: 0x14181c, alpha: 0.7 });
  body.addChild(cab);
  const led = glowSprite(W - 8.5, G - 13, 7, 0x6aff8a);
  glows.addChild(led);
  const animate: Animator = e => {
    for (let i = 0; i < sheens.length; i++) sheens[i].alpha = e.day * (0.1 + 0.16 * (0.5 + 0.5 * Math.sin(e.t * 0.7 + i * 1.9))) * (1 - surfaceLive.rain * 0.7) + (1 - e.day) * 0.035;
    led.alpha = e.day > 0.12 ? 0.55 + 0.35 * Math.sin(e.t * 2.4) : 0.1;
  };
  return { body, glows, animate };
}

// ---------- Wind turbine ----------

function windLook(W: number, rnd: () => number): Look {
  const body = new Container();
  const glows = new Container();
  const cx = W / 2, hubY = 27;
  const tower = new Graphics();
  tower.poly([cx - 4.4, G - 6, cx + 4.4, G - 6, cx + 1.9, hubY + 3, cx - 1.9, hubY + 3]).fill(hGradient([[0, 0x8e969c], [0.45, 0xe8ecee], [1, 0x66707a]]));
  for (const y of [G - 30, G - 52]) tower.rect(cx - 3.2 + (G - 6 - y) * 0.012, y, 6.4 - (G - 6 - y) * 0.03, 1.2).fill({ color: 0x3a4248, alpha: 0.35 });
  // A hatch, a service ladder's shadow, and the little transformer box the cable runs to.
  tower.rect(cx - 1.5, G - 20, 3, 12).fill({ color: 0x20262a, alpha: 0.5 });
  tower.roundRect(cx + 9, G - 17, 9, 11, 1.2).fill(vGradient([[0, 0x7a8086], [1, 0x484d52]]));
  tower.rect(cx + 11, G - 14, 5, 1.2).fill({ color: 0xffd36a, alpha: 0.6 });
  body.addChild(tower);
  const nacelle = new Graphics();
  nacelle.roundRect(cx - 4, hubY - 4.2, 15, 8.4, 3.4).fill(vGradient([[0, 0xf0f2f2], [1, 0x8a9298]]));
  nacelle.rect(cx + 7, hubY - 3.8, 1, 7.6).fill({ color: 0x20262a, alpha: 0.25 });
  body.addChild(nacelle);
  // The rotor: three tapered blades turning on a hub, with a faint disc that shows when it spins fast.
  const L = Math.min(34, Math.max(26, W * 0.74));
  const rotor = new Container();
  rotor.position.set(cx, hubY);
  const disc = new Graphics();
  disc.circle(0, 0, L).fill({ color: 0xdfe8ee, alpha: 1 });
  disc.alpha = 0;
  rotor.addChild(disc);
  for (let i = 0; i < 3; i++) {
    const blade = new Graphics();
    blade.poly([0, -2.4, L * 0.3, -3.1, L * 0.62, -2.1, L, -0.5, L, 0.5, L * 0.6, 1.6, L * 0.28, 2.3, 0, 2.4]).fill(hGradient([[0, 0xe6eaec], [0.6, 0xf6f8f8], [1, 0xc4ccd0]]));
    blade.poly([0, -2.4, L * 0.3, -3.1, L * 0.62, -2.1, L, -0.5, L * 0.6, -0.4, L * 0.28, -0.6, 0, -0.4]).fill({ color: 0xffffff, alpha: 0.45 });
    blade.rotation = (i * Math.PI * 2) / 3 + rnd() * 0.2;
    rotor.addChild(blade);
  }
  const hub = new Graphics();
  hub.circle(0, 0, 3.4).fill(vGradient([[0, 0xfafafa], [1, 0x8a9298]]));
  hub.circle(0, 0, 1.2).fill(0x3a4248);
  rotor.addChild(hub);
  body.addChild(rotor);
  // Aviation lamp on the nacelle: blinks red in the dark.
  const lamp = glowSprite(cx + 1, hubY - 5.4, 12, 0xff3a3a);
  glows.addChild(lamp);
  let spin = rnd() * 6;
  const animate: Animator = e => {
    // The blades follow the game's wind (windAt of the play clock): a calm hour barely turns them, a gust spins them up.
    const omega = e.calm ? 0 : 0.35 + 3.4 * e.gust;
    spin += omega * e.dt;
    rotor.rotation = spin;
    disc.alpha = clamp01((omega - 1.6) / 2.4) * 0.1;
    lamp.alpha = Math.sin(e.t * 2.6) > 0.55 ? 0.35 + 0.65 * e.dark : 0.06;
  };
  return { body, glows, animate };
}

// ---------- Watchtower ----------

function towerLook(W: number, rnd: () => number): Look {
  const body = new Container();
  const glows = new Container();
  const cx = W / 2;
  const yPlat = 44;
  const g = new Graphics();
  // Four legs (two in front, two behind), braces between them, and a ladder up the front.
  for (const [dx, back] of [[-9, 1], [9, 1], [-10, 0], [10, 0]] as [number, number][]) {
    const x0 = cx + dx, x1 = cx + dx * 0.62;
    g.poly([x0 - 1.1, G - 6, x0 + 1.1, G - 6, x1 + 0.9, yPlat, x1 - 0.9, yPlat]).fill(back ? 0x4a4e52 : 0x6a6f74);
  }
  for (let i = 0; i < 4; i++) {
    const y0 = G - 8 - i * 12, y1 = y0 - 12;
    const w0 = 10 - (G - 8 - y0) * 0.0625 * 1.0, w1 = 10 - (G - 8 - y1) * 0.0625 * 1.0;
    g.moveTo(cx - w0, y0).lineTo(cx + w1, y1).moveTo(cx + w0, y0).lineTo(cx - w1, y1).stroke({ color: 0x5a5f64, width: 1.1, alpha: 0.85 });
  }
  g.rect(cx - 2.2, yPlat, 4.4, G - 6 - yPlat).fill({ color: 0x20252a, alpha: 0.35 });
  for (let y = yPlat + 4; y < G - 8; y += 5) g.rect(cx - 2.2, y, 4.4, 0.8).fill({ color: 0x9aa0a6, alpha: 0.6 });
  // Platform with a railing, the cabin, its roof and the mast.
  g.rect(cx - 14, yPlat, 28, 3.4).fill(vGradient([[0, 0x8a8f94], [1, 0x484c50]]));
  g.rect(cx - 14, yPlat - 8, 1.2, 8).fill(0x7a7f84).rect(cx + 12.8, yPlat - 8, 1.2, 8).fill(0x7a7f84).rect(cx - 14, yPlat - 8.4, 28, 1.1).fill(0x9a9fa4);
  g.roundRect(cx - 10, yPlat - 25, 20, 24, 1.4).fill(vGradient([[0, 0x8a8678], [1, 0x57544a]]));
  g.rect(cx - 10, yPlat - 25, 20, 1.6).fill({ color: 0xf0e8d0, alpha: 0.3 });
  g.poly([cx - 13, yPlat - 25, cx, yPlat - 34, cx + 13, yPlat - 25, cx + 11.6, yPlat - 23.6, cx - 11.6, yPlat - 23.6]).fill(vGradient([[0, 0x6a6e72], [1, 0x34383c]]));
  g.rect(cx + 5.6, yPlat - 46, 1.2, 14).fill(0x6a6f74);
  g.rect(cx + 3, yPlat - 42, 6.4, 0.9).fill(0x6a6f74);
  // Window band (dark by day, lit at night through the glows below) and a door.
  g.rect(cx - 8, yPlat - 20, 16, 6.4).fill(0x1c2228);
  g.rect(cx - 0.4, yPlat - 20, 0.8, 6.4).fill(0x4a5258);
  body.addChild(g);
  const warm = glowSprite(cx, yPlat - 17, 30, 0xffd890);
  const warm2 = new Graphics();
  warm2.rect(cx - 8, yPlat - 20, 16, 6.4).fill({ color: 0xffe0a0, alpha: 1 });
  warm2.alpha = 0;
  glows.addChild(warm2, warm);
  const blink = glowSprite(cx + 6.2, yPlat - 47, 12, 0xff3a3a);
  glows.addChild(blink);
  // The searchlight: a long soft cone that sweeps the yard at night.
  const beam = new Sprite(glowTexture());
  beam.anchor.set(0, 0.5);
  beam.position.set(cx - 10, yPlat - 3);
  beam.width = 150;
  beam.height = 26;
  beam.tint = 0xfff0d0;
  beam.blendMode = 'add';
  beam.alpha = 0;
  glows.addChild(beam);
  const ph = rnd() * 6;
  const animate: Animator = e => {
    const sweep = e.calm ? 0 : Math.sin(e.t * 0.5 + ph);
    beam.rotation = Math.PI * (0.62 + 0.13 * sweep); // west and down: toward the yard in front of the row
    beam.alpha = 0.34 * e.dark * clamp01(e.power);
    warm.alpha = 0.55 * e.dark * clamp01(e.power);
    warm2.alpha = 0.8 * e.dark * clamp01(e.power) + 0.08;
    blink.alpha = Math.sin(e.t * 3 + ph) > 0.4 ? 0.3 + 0.7 * e.dark : 0.06;
  };
  return { body, glows, animate };
}

// ---------- Gate post (the surface version) ----------

function gateLook(W: number, rnd: () => number): Look {
  const body = new Container();
  const glows = new Container();
  const g = new Graphics();
  // Sandbags piled against the west end: three courses of rounded bags.
  for (let c = 0; c < 3; c++) {
    const n = 4 - c;
    for (let i = 0; i < n; i++) {
      const x = 3 + c * 4 + i * 9.4 + (rnd() - 0.5) * 1.2, y = G - 6 - c * 5.2;
      g.roundRect(x, y - 5.4, 10, 5.6, 2.6).fill(vGradient([[0, shade(0xa89a78, 1 + (rnd() - 0.5) * 0.18)], [1, 0x6a5e46]]));
      g.rect(x + 2, y - 4.6, 6, 0.8).fill({ color: 0xffffff, alpha: 0.18 });
    }
  }
  // The booth: a concrete box with a flat slab roof, a window and a plate.
  const bx = Math.round(W * 0.42), bw = 28, by = G - 6 - 33;
  g.roundRect(bx, by, bw, 33, 1.4).fill(vGradient([[0, 0x8c887c], [1, 0x575349]]));
  g.rect(bx - 3, by - 3.4, bw + 6, 3.8).fill(vGradient([[0, 0xa8a496], [1, 0x6a665a]]));
  g.rect(bx + 3, by + 8, 14, 9).fill(0x1c2228);
  g.rect(bx + 10, by + 8, 0.9, 9).fill(0x4a5258);
  g.rect(bx + 20, by + 12, 5.4, 19).fill(0x2a2e2c);
  g.rect(bx + 3, by + 22, 14, 3).fill({ color: 0xd9a441, alpha: 0.8 });
  g.rect(bx, by + 30, bw, 3).fill({ color: 0x000000, alpha: 0.18 });
  body.addChild(g);
  const lit = new Graphics();
  lit.rect(bx + 3, by + 8, 14, 9).fill(0xffe0a0);
  lit.alpha = 0;
  const bwGlow = glowSprite(bx + 10, by + 12.5, 34, 0xffd890);
  glows.addChild(lit, bwGlow);
  // The barrier: a post and a striped boom that lifts when a team goes out or comes home.
  const px = bx + bw + 8, py = G - 6 - 11;
  const post = new Graphics();
  post.roundRect(px - 3, py - 3, 6, 14, 1).fill(vGradient([[0, 0x8a8f94], [1, 0x50555a]]));
  body.addChild(post);
  const boom = new Container();
  boom.position.set(px, py);
  const BL = Math.min(26, W - px - 6);
  for (let i = 0; i < 6; i++) boom.addChild(new Graphics().rect((BL / 6) * i, -1.4, BL / 6 + 0.4, 2.8).fill(i % 2 ? 0xf2f0ea : 0xd8402a));
  boom.addChild(new Graphics().circle(0, 0, 2.2).fill(0x30343a));
  body.addChild(boom);
  const beaconGlow = glowSprite(px, py - 5.6, 11, 0xff7a3a);
  glows.addChild(beaconGlow);
  // A floodlight pole by the road: a cone at night.
  const fx = W - 6;
  const pole = new Graphics();
  pole.rect(fx - 1, G - 6 - 54, 2, 54).fill(vGradient([[0, 0x7a7f84], [1, 0x42464a]]));
  pole.roundRect(fx - 7, G - 6 - 58, 9, 3.4, 1.2).fill(0x3a3e42);
  body.addChild(pole);
  const flood = glowSprite(fx - 3, G - 6 - 55, 26, 0xfff0d0);
  const cone = new Sprite(glowTexture());
  cone.anchor.set(0.5, 0.1);
  cone.position.set(fx - 3, G - 6 - 55);
  cone.width = 44;
  cone.height = 62;
  cone.rotation = 0.18;
  cone.tint = 0xfff0d0;
  cone.blendMode = 'add';
  cone.alpha = 0;
  glows.addChild(flood, cone);
  let open = 0, hold = 0;
  const animate: Animator = e => {
    if (gateKicks > 0 && hold <= 0) { gateKicks--; hold = 4.5; }
    if (hold > 0) hold -= e.dt;
    open += ((hold > 0 ? 1 : 0) - open) * Math.min(1, e.dt * 2.2);
    boom.rotation = -open * 1.25;
    const on = clamp01(e.power);
    lit.alpha = 0.78 * e.dark * on;
    bwGlow.alpha = 0.55 * e.dark * on;
    flood.alpha = 0.7 * e.dark * on;
    cone.alpha = 0.24 * e.dark * on;
    beaconGlow.alpha = Math.sin(e.t * 3.2) > 0.2 ? 0.28 + 0.6 * e.dark : 0.05;
  };
  return { body, glows, animate };
}

// ---------- Anything else (a garage, a greenhouse later): a plain shed so it never shows an interior on the surface ----------

function shedLook(W: number, rnd: () => number): Look {
  const body = new Container();
  const glows = new Container();
  const g = new Graphics();
  const h = 46 + rnd() * 6;
  g.roundRect(2, G - 6 - h, W - 4, h, 1.4).fill(vGradient([[0, 0x8e8a7e], [1, 0x585449]]));
  g.rect(0, G - 6 - h - 4, W, 4.6).fill(vGradient([[0, 0xa8a496], [1, 0x6a665a]]));
  g.rect(W * 0.2, G - 6 - h * 0.7, W * 0.6, h * 0.7).fill(vGradient([[0, 0x3a3e40], [1, 0x24282a]]));
  for (let y = G - 6 - h * 0.7; y < G - 7; y += 5) g.rect(W * 0.2, y, W * 0.6, 0.9).fill({ color: 0x000000, alpha: 0.3 });
  body.addChild(g);
  const lampG = glowSprite(W / 2, G - 6 - h + 6, 24, 0xffd890);
  glows.addChild(lampG);
  return { body, glows, animate: e => { lampG.alpha = 0.6 * e.dark * clamp01(e.power); } };
}

const LOOKS: Partial<Record<BuildingType, (W: number, rnd: () => number) => Look>> = {
  solarArray: solarLook,
  windTurbine: windLook,
  watchtower: towerLook,
  gatePost: gateLook,
};

/** Timber scaffold and hazard tape: what a block under its first construction looks like next to its faint outline. */
function scaffoldGfx(W: number): Graphics {
  const g = new Graphics();
  const wood = 0x8a6a44, plank = 0x6e5236;
  const x0 = 1, x1 = W - 1, h = 70;
  for (let x = x0; x <= x1 + 0.1; x += Math.max(14, (x1 - x0) / Math.max(1, Math.round((x1 - x0) / 20)))) g.rect(x - 1.1, G - 6 - h, 2.2, h).fill(wood);
  g.rect(x1 - 1.1, G - 6 - h, 2.2, h).fill(wood);
  for (let y = G - 24; y > G - 6 - h; y -= 18) g.rect(x0 - 2, y, x1 - x0 + 4, 2.6).fill(plank);
  for (let x = x0 - 2; x < x1 + 2; x += 7) g.rect(x, G - 14, 7, 3.4).fill(((x - x0) / 7) % 2 < 1 ? 0xc8a032 : 0x1a1a1a);
  return g;
}

/** The look of a surface-row room: `W` is its width; `isNew` = under its first construction. */
export function buildSurfaceBlock(type: BuildingType, W: number, isNew: boolean, seed: number): RoomVisual {
  hookBus();
  const rnd = seeded(seed || 1);
  const look = (LOOKS[type] ?? shedLook)(W, rnd);
  const container = new Container();
  const body = new Container();
  body.addChild(plinth(W), look.body);
  container.addChild(body, look.glows);
  if (isNew) {
    look.body.alpha = 0.34;
    look.glows.visible = false;
    body.addChild(scaffoldGfx(W));
  }
  let lastT = -1;
  return {
    container,
    animate: (t, power) => {
      if (container.destroyed) return;
      const calm = reducedMotion();
      const dt = lastT < 0 || calm ? 0 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      const night = surfaceLive.night;
      body.tint = surfaceLive.light;
      // The people of the row stand in the same outdoor light (RoomViews keeps them in the room's second child).
      const people = container.parent?.parent?.children[1];
      if (people && people !== container.parent && people.sortableChildren) people.tint = mix(surfaceLive.light, 0xffffff, 0.25);
      if (isNew || !look.animate) return;
      look.animate({ t, dt, day: clamp01(1 - night), dark: clamp01((night - 0.25) / 0.5), gust: windAt(calm ? 0 : surfaceLive.play), power, calm });
    },
  };
}

// ---------- A wreck on the surface row ----------

/** Rubble, a broken post with rebar and hazard tape: a surface room the raiders wrecked, until the crew clears it. */
export function buildSurfaceRuin(r: Ruin, W: number, rnd: () => number): RuinVisual {
  const container = new Container();
  const body = new Container();
  container.addChild(body);
  body.addChild(plinth(W));
  const heap = ArtLibrary.get('kit/prop-5');
  const wrecked = r.kind === 'wreck';
  if (heap) {
    const specs: [number, number, number, boolean][] = [[0.5, 1, 0.92, false], [0.18, 0.62, 0.5, true], [0.84, 0.7, 0.55, false]];
    for (const [fx, sc, hh, flip] of specs) {
      const s = new Sprite(heap);
      s.anchor.set(0.5, 0.95);
      const k = (W * 0.7 * sc) / heap.width;
      s.scale.set(flip ? -k : k, k * hh * 1.15);
      s.position.set(W * fx, G - 4);
      body.addChild(s);
    }
  } else {
    const g = new Graphics();
    const pts: number[] = [W * 0.08, G - 6];
    for (let i = 0; i <= 8; i++) pts.push(W * (0.08 + 0.84 * (i / 8)), G - 6 - Math.sin((i / 8) * Math.PI) * (26 + rnd() * 10));
    pts.push(W * 0.92, G - 6);
    g.poly(pts).fill(vGradient([[0, 0x7a766e], [1, 0x3e3c38]]));
    body.addChild(g);
  }
  const post = new Graphics();
  const px = W * 0.74;
  post.poly([px - 3, G - 6, px - 3.4, G - 40, px - 0.6, G - 46, px + 3.2, G - 38, px + 3, G - 6]).fill(vGradient([[0, 0x8c887c], [1, 0x4e4a42]]));
  for (const [dx, h] of [[-1.8, 14], [0.4, 18], [2.2, 11]] as [number, number][]) post.moveTo(px + dx, G - 40).lineTo(px + dx * 2.2, G - 40 - h).stroke({ color: 0x7a4a2a, width: 1.1, alpha: 0.9 });
  body.addChild(post);
  if (wrecked) {
    // Scorched: a black bloom over the heap.
    const soot = new Graphics();
    soot.ellipse(W * 0.5, G - 14, W * 0.36, 12).fill({ color: 0x000000, alpha: 0.28 });
    body.addChild(soot);
  }
  const tape = new Graphics();
  for (let i = 0; i < Math.ceil(W / 8); i++) {
    const x = i * 8, y = G * 0.52 + Math.sin((x / W) * Math.PI) * 5;
    tape.poly([x, y, x + 8, y + 0.4, x + 8, y + 6.4, x, y + 6]).fill(i % 2 ? 0x1a1a1a : 0xe8b52a);
  }
  body.addChild(tape);
  // Work: a lamp and kicked-up dust once a crew is in.
  const glows = new Container();
  const lamp = glowSprite(W * 0.3, G - 22, 40, 0xffd890);
  glows.addChild(lamp);
  const dust: { s: Sprite; ph: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const s = new Sprite(moteTexture());
    s.anchor.set(0.5);
    s.tint = 0xd8c8a8;
    s.width = s.height = 5 + rnd() * 6;
    s.alpha = 0;
    glows.addChild(s);
    dust.push({ s, ph: rnd() * 10 });
  }
  container.addChild(glows);
  return {
    container,
    animate: (t, _dt, working) => {
      if (container.destroyed) return;
      body.tint = surfaceLive.light;
      lamp.alpha = working ? 0.5 + 0.1 * Math.sin(t * 7) : 0;
      for (const d of dust) {
        const k = ((t * 0.5 + d.ph) % 1);
        d.s.position.set(W * (0.2 + 0.6 * ((d.ph * 0.37) % 1)) + Math.sin(t + d.ph) * 4, G - 10 - k * 26);
        d.s.alpha = working ? 0.4 * Math.sin(k * Math.PI) : 0;
      }
    },
  };
}

// ---------- The yard: concrete apron under the row, and the ruin of the old gate house before it opens ----------

/** The apron the row stands on (open): a poured slab with joints per slot, a front face, steps at the west end and a path to the entrance hill. World coordinates. */
export function buildYardApron(): Container {
  const c = new Container();
  const x0 = ROW_X0 - 18, x1 = ROW_X1 + 8;
  const g = new Graphics();
  // Front face (what the soil strip would show): dark, stained, sunk 11 units.
  g.rect(x0, -1, x1 - x0, 12).fill(vGradient([[0, 0x8a857a], [0.25, 0x5e5a52], [1, 0x2c2a26]]));
  g.rect(x0, -3.4, x1 - x0, 3.4).fill(vGradient([[0, 0xc2bcae], [1, 0x8a857a]]));
  g.rect(x0, -3.4, x1 - x0, 1.2).fill({ color: 0xf0eadc, alpha: 0.5 });
  for (let x = slotX(-11); x <= ROW_X1; x += SLOT_W) g.rect(x - 0.5, -3, 1, 4).fill({ color: 0x24221e, alpha: 0.5 });
  const rnd = seeded(1616);
  for (let i = 0; i < 9; i++) g.rect(x0 + rnd() * (x1 - x0), 1 + rnd() * 6, 1.1, 3 + rnd() * 4).fill({ color: 0x6a3a1e, alpha: 0.3 });
  // Steps at the west end.
  for (let i = 0; i < 3; i++) g.rect(x0 - 5 - (2 - i) * 4, -3.4 + (i + 1) * 2.4, 5 + (2 - i) * 4, 2.4).fill(shade(0x8a857a, 0.78 - i * 0.07));
  // A path of poured concrete from the apron to the hill, ending at the entrance.
  const px0 = x1, px1 = -96;
  g.rect(px0, -1.6, px1 - px0, 2.6).fill(vGradient([[0, 0x9a958a], [1, 0x66625a]]));
  for (let x = px0 + 14; x < px1; x += 22) g.rect(x, -1.4, 0.9, 2.4).fill({ color: 0x24221e, alpha: 0.4 });
  c.addChild(g);
  return c;
}

/** The old gate house before the yard is cleared: a broken concrete shell, rubble and a hazard tape across it. World coordinates; stands behind the grass. */
export function buildGateHouseRuin(): Container {
  const c = new Container();
  const g = new Graphics();
  const rnd = seeded(4242);
  const x0 = -248, x1 = -156;
  // Back wall: broken top, two window holes, stains.
  const top: number[] = [];
  for (let i = 0; i <= 10; i++) top.push(x0 + ((x1 - x0) * i) / 10, -(34 + rnd() * 26 + (i > 6 ? 12 : 0)));
  g.poly([x0, -2, ...top, x1, -2]).fill(vGradient([[0, 0x6e6a62], [0.7, 0x4e4a44], [1, 0x34322e]]));
  g.rect(x0 + 14, -46, 15, 12).fill(0x14120f);
  g.rect(x0 + 52, -40, 13, 11).fill(0x14120f);
  g.rect(x0 + 52, -29, 13, 1.4).fill({ color: 0x8a857a, alpha: 0.6 });
  for (let i = 0; i < 5; i++) g.rect(x0 + 6 + rnd() * (x1 - x0 - 12), -50 + rnd() * 30, 1.2, 8 + rnd() * 14).fill({ color: 0x6a3a1e, alpha: 0.26 });
  // A slab that came down at an angle, and rebar sticking out of everything.
  g.poly([x0 + 40, -30, x0 + 86, -8, x0 + 82, -2, x0 + 36, -24]).fill(vGradient([[0, 0x8a857a], [1, 0x4a4640]]));
  for (const [rx, ry, len, ang] of [[x0 + 8, -52, 14, -0.5], [x0 + 70, -62, 17, 0.35], [x0 + 88, -44, 11, 0.8], [x0 + 38, -33, 12, -0.9]] as [number, number, number, number][]) {
    g.moveTo(rx, ry).lineTo(rx + Math.sin(ang) * len, ry - Math.cos(ang) * len).stroke({ color: 0x7a4a2a, width: 1.3, alpha: 0.95 });
  }
  c.addChild(g);
  const heap = ArtLibrary.get('kit/prop-5');
  if (heap) {
    for (const [x, h, flip] of [[x0 + 18, 26, false], [x0 + 62, 32, true], [x1 - 4, 20, false], [x0 - 6, 18, true]] as [number, number, boolean][]) {
      const s = new Sprite(heap);
      s.anchor.set(0.5, 0.95);
      const k = h / heap.height;
      s.scale.set(flip ? -k : k, k);
      s.position.set(x, 0);
      c.addChild(s);
    }
  }
  return c;
}

// ---------- ST-20: what the surface shows of the inside ----------

/** What the bunker is doing, as the surface can see it. Filled by `readInside` (one object, reused). */
export interface Inside {
  /** 0..1 the worst fire burning inside (the exhaust turns black and heavy). */
  fire: number;
  /** 0..1 how hard the power plants run (the exhaust smoke's strength). */
  gen: number;
  /** A decontamination chamber is standing by the entrance. */
  decon: boolean;
  /** Ventilation stacks: world x of each. */
  stacks: number[];
}
export const newInside = (): Inside => ({ fire: 0, gen: 0.4, decon: false, stacks: [] });

/** Reads the state into `out`: fire severity, generator load, decon chamber, ventilation stacks (layout.infra kind 'ventStack'). Cheap: a few small loops. */
export function readInside(state: GameState, out: Inside): Inside {
  let fire = 0;
  for (const inc of state.incidents ?? []) if (inc.kind === 'fire' && inc.severity > fire) fire = inc.severity;
  out.fire = fire;
  let load = 0, decon = false;
  for (const b of state.buildings) {
    if (b.isConstructing && b.level === 1) continue;
    if (b.type === 'generator') load += 1;
    else if (b.type === 'reactor' || b.type === 'reactorHall') load += 2;
    else if ((b.type as string) === 'decon') decon = true;
  }
  const lowPower = (state.powerRatio ?? 1) < 0.3 ? 0.25 : 1;
  out.gen = Math.min(1, 0.18 + 0.1 * load) * lowPower;
  out.decon = decon;
  out.stacks.length = 0;
  for (const i of state.layout?.infra ?? []) {
    if (i.kind !== 'ventStack' || out.stacks.length >= 3) continue;
    // The stack stands over its slot, but never in front of the entrance hill: those slots move east of it, west ones to the end of the yard.
    let x = slotX(i.x) + SLOT_W / 2;
    if (x > -110 && x < 176) x = x < 30 ? -128 : 184;
    out.stacks.push(x);
  }
  return out;
}

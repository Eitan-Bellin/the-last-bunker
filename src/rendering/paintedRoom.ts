import { Container, DisplacementFilter, Graphics, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { ArtEntry, FxSpot, LightSpot } from '../art/registry';
import { ArtLibrary, coneTexture, glowTexture, moteTexture } from '../art/ArtLibrary';
import { ROOM_H } from './layout';
import { hGradient, vGradient } from './draw';
import { crisisLight } from './crisisLight'; // gfx-p0 crisis
import { GFX } from './gfxFeatures';
import type { Animator, RoomVisual } from './roomArt';
import { viewport } from '../utils/viewport'; // [perf] window size without forcing layout

/**
 * Shared flicker (G4): every painted room publishes how far its lamps are dipped right now (1 = steady),
 * keyed by room id, so the structure lit by those lamps (tints, light spill) dips with them.
 */
export const roomFlicker = new Map<string, number>();

/**
 * [plan4:BL-6] Whether a room is staffed right now (1 = yes, 0 = nobody), keyed by room id like roomFlicker. Live effects marked `work` in a
 * composed room (conveyors, status lamps, screens) slow to a stop when it is 0; a room nobody reports for counts as working. The renderer
 * publishes it from RoomViews (one line, plan4:BL-6).
 */
export const roomWorking = new Map<string, number>();

/** gfx-p0 rooms: the renderer's quality tier. High adds heat haze; low halves the particles and drops moths and leaves. */
export type RoomFxQuality = 'high' | 'medium' | 'low';
let fxQuality: RoomFxQuality = 'high';
export function setRoomFxQuality(q: RoomFxQuality): void {
  fxQuality = q;
}

/** Shared flicker state so a room's lamps dip together when power is unstable. */
interface PowerFlicker {
  until: number;
  depth: number;
}

function flickerFactor(f: PowerFlicker, t: number, power: number): number {
  if (power >= 0.95) return 1;
  if (t > f.until && Math.random() < 0.012 + (0.95 - power) * 0.05) {
    f.until = t + 0.05 + Math.random() * 0.18;
    f.depth = 0.15 + Math.random() * 0.5;
  }
  return t < f.until ? f.depth : 1;
}

/** Candle-like noise from a couple of incommensurate sines. */
function wobble(t: number, seed: number): number {
  return 0.5 + 0.25 * Math.sin(t * 13.1 + seed) + 0.15 * Math.sin(t * 23.7 + seed * 2.3) + 0.1 * Math.sin(t * 5.3 + seed * 0.7);
}

/**
 * Lamp glow and cone. gfx-p0 rooms: `tame` (1 = dark painting .. 0.25 = bright one) scales the glow down where the
 * painting already has its light baked in, so bright tiers no longer get white smears; cones only on dark paintings.
 */
function addLight(layer: Container, spot: LightSpot, W: number, H: number, mirror: boolean, seed: number, tame: number, cones: boolean): Animator {
  const x = (mirror ? 1 - spot.x : spot.x) * W;
  const y = spot.y * H;
  const glow = new Sprite(glowTexture());
  glow.anchor.set(0.5);
  glow.tint = spot.color;
  const size = spot.r * W * 2 * (0.6 + 0.4 * tame);
  glow.width = size;
  glow.height = size * 0.9;
  glow.position.set(x, y);
  layer.addChild(glow);
  let cone: Sprite | null = null;
  if (cones && spot.r >= 0.15 && spot.y < 0.35) {
    cone = new Sprite(coneTexture());
    cone.anchor.set(0.5, 0);
    cone.tint = spot.color;
    cone.width = W * 0.95;
    cone.height = H - y - 2;
    cone.position.set(x, y + 3);
    cone.alpha = 0.32;
    layer.addChild(cone);
  }
  // Plan 2026-10 Q9: a soft shaft of light with streaks that sways a little under the bigger lamps (quality: GFX.beams).
  let beam: Sprite | null = null;
  if (beamBudget.n < beamBudget.max && spot.r >= 0.13 && spot.y < 0.4) {
    beamBudget.n++;
    beam = new Sprite(beamTexture());
    beam.anchor.set(0.5, 0);
    beam.tint = spot.color;
    beam.width = Math.min(W * 0.9, spot.r * W * 3.4);
    beam.height = Math.max(20, H * 0.96 - y);
    beam.position.set(x, y + 2);
    beam.alpha = 0;
    layer.addChild(beam);
  }
  const flicker = spot.flicker ?? 0;
  const bw = beam ? beam.width : 0;
  const bx = x;
  return (t) => {
    const w = flicker > 0 ? 1 - flicker * 0.35 * (1 - wobble(t, seed) * 1.4) : 1;
    glow.alpha = Math.max(0.15, Math.min(1, w)) * 0.85 * tame;
    if (cone) cone.alpha = glow.alpha * 0.36;
    if (beam) {
      const on = GFX.beams;
      beam.visible = on;
      if (on) {
        // The shaft breathes slowly and leans a few degrees; its width follows the lamp's own dip.
        beam.alpha = glow.alpha * (0.2 + 0.05 * Math.sin(t * 0.45 + seed)) * (0.5 + 0.5 * tame);
        beam.skew.x = 0.05 * Math.sin(t * 0.21 + seed * 1.7);
        beam.width = bw * (0.94 + 0.06 * Math.sin(t * 0.33 + seed * 0.6));
        beam.x = bx;
      }
    }
  };
}

/** Plan 2026-10 Q9: how many beams a room may carry (reset per room by buildPaintedRoom). */
const beamBudget = { n: 0, max: 2 };

let beamTex: Texture | null = null;
/** A downward shaft widening from its apex, with soft radial streaks (white; tinted per lamp). */
function beamTexture(): Texture {
  if (beamTex) return beamTex;
  const w = 96, h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  // Streak profile across the beam (by angle from the axis): a few octaves of 1-D value noise.
  const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise = (x: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
  const streak = (a: number) => 0.55 + 0.45 * (0.6 * noise(a * 5 + 3) + 0.4 * noise(a * 13 + 9));
  for (let y = 0; y < h; y++) {
    const ky = y / (h - 1);
    const half = 0.12 + 0.88 * ky;
    for (let x = 0; x < w; x++) {
      const nx = ((x + 0.5) / w) * 2 - 1;
      const a = nx / half;
      let v = 0;
      if (Math.abs(a) < 1) {
        const edge = 1 - Math.abs(a);
        v = edge * edge * (3 - 2 * edge) * streak(a) * Math.pow(1 - ky, 0.9) * Math.min(1, ky * 14 + 0.15);
      }
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * Math.min(1, v));
    }
  }
  ctx.putImageData(img, 0, 0);
  beamTex = Texture.from(c);
  return beamTex;
}

// ---- gfx-p0 rooms: shared procedural textures for the painted-motion layer (made once, white, tinted per use) ----

const texCache = new Map<string, Texture>();
function canvasTexture(key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): Texture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const tex = Texture.from(c);
  texCache.set(key, tex);
  return tex;
}

/** Soft-edged rectangle: lit screens, glow strips, fluorescent tubes. */
function softRectTexture(): Texture {
  return canvasTexture('softRect', 32, 32, ctx => {
    const img = ctx.createImageData(32, 32);
    const edge = (v: number) => Math.min(1, Math.min(v + 0.5, 32 - v - 0.5) / 7);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const a = edge(x) * edge(y);
        const i = (y * 32 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * a * a * (3 - 2 * a));
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** Thin ring for ripples where drops land. */
function ringTexture(): Texture {
  return canvasTexture('ring', 64, 64, ctx => {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'white';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(32, 32, 27, 0, Math.PI * 2);
    ctx.stroke();
  });
}

/** Radar sweep: a bright leading edge with a fading trail behind it (clockwise). */
function sweepTexture(): Texture {
  return canvasTexture('sweep', 128, 128, ctx => {
    ctx.beginPath();
    ctx.arc(64, 64, 63, 0, Math.PI * 2);
    ctx.clip();
    // Thin wedges instead of a conic gradient, so it works everywhere.
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 - ((i + 1) / n) * 1.3;
      const a1 = -Math.PI / 2 - (i / n) * 1.3 + 0.01;
      ctx.fillStyle = `rgba(255,255,255,${(0.75 * (1 - i / n) ** 2).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(64, 64);
      ctx.arc(64, 64, 64, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/**
 * Heat-haze displacement map: rising soft noise, two identical periods stacked so it can scroll seamlessly,
 * neutral (no shift) at the left and right edges so the shimmer has no hard sides.
 */
function hazeMapTexture(): Texture {
  return canvasTexture('hazeMap', 64, 128, ctx => {
    const img = ctx.createImageData(64, 128);
    for (let y = 0; y < 128; y++) {
      const v = (y % 64) / 64 * Math.PI * 2;
      for (let x = 0; x < 64; x++) {
        const u = x / 63;
        const fall = Math.sin(Math.PI * u);
        const nx = Math.sin(v * 2 + u * 9) * 0.5 + Math.sin(v * 3 + u * 17 + 1.3) * 0.3 + Math.sin(v + u * 5) * 0.2;
        const ny = Math.sin(v * 2 + u * 7 + 2.1) * 0.5 + Math.sin(v * 4 + u * 13) * 0.5;
        const i = (y * 64 + x) * 4;
        img.data[i] = Math.round(128 + 120 * nx * fall);
        img.data[i + 1] = Math.round(128 + 120 * ny * fall);
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

const subTextures = new Map<string, Texture>();

// ---- gfx-p0 rooms: pooled particles (no allocation per particle, no GC churn) ----

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
  on: boolean;
  /** 0 = main particle, 1 = splash droplet, 2 = ripple ring. */
  k: number;
  /** Ring: final scale. Puff: growth per second. */
  r: number;
}

class Pool {
  readonly items: Particle[] = [];
  private layer: Container;
  private tex: Texture;
  private cap: number;
  private add: boolean;
  constructor(layer: Container, tex: Texture, cap: number, add = false) {
    this.layer = layer;
    this.tex = tex;
    this.cap = cap;
    this.add = add;
  }
  get(): Particle | null {
    for (const p of this.items) {
      if (!p.on) {
        p.on = true;
        p.s.visible = true;
        p.life = 0;
        p.s.rotation = 0;
        return p;
      }
    }
    if (this.items.length >= this.cap) return null;
    const s = new Sprite(this.tex);
    s.anchor.set(0.5);
    if (this.add) s.blendMode = 'add';
    this.layer.addChild(s);
    const p: Particle = { s, vx: 0, vy: 0, life: 0, max: 1, on: true, k: 0, r: 0 };
    this.items.push(p);
    return p;
  }
  free(p: Particle): void {
    p.on = false;
    p.s.visible = false;
  }
}

const RATE: Partial<Record<FxSpot['kind'], number>> = { drip: 0.8, stream: 20, smoke: 2.2, steam: 3, sparks: 0.35, bubbles: 3, mist: 9, leaf: 0.3 };
const CAP: Partial<Record<FxSpot['kind'], number>> = { drip: 4, stream: 18, smoke: 10, steam: 12, sparks: 14, bubbles: 12, mist: 12, leaf: 4 };

/** Particle emitter: drips and streams (with splash rings), smoke, steam, sparks, bubbles, mist, falling leaves. */
function emitter(layer: Container, spot: FxSpot, W: number, H: number, mirror: boolean, rnd: () => number): Animator {
  const x = (mirror ? 1 - spot.x : spot.x) * W;
  const y = spot.y * H;
  const kind = spot.kind;
  const color = spot.color ?? 0xffffff;
  const size = spot.size ?? 0.03;
  const spread = size * W;
  const to = spot.to !== undefined ? spot.to * H : kind === 'bubbles' ? y - 0.08 * H : H - 6;
  const pool = new Pool(layer, moteTexture(), CAP[kind] ?? 10, kind === 'sparks');
  const rings = spot.ring ? new Pool(layer, ringTexture(), 4, true) : null;
  const ringScale = ((spot.ring ?? 0) * W) / 54;
  const puff = 0.25 + size * 8;
  let acc = rnd();
  let last = -1;
  let lastRing = 0;
  const rate = (RATE[kind] ?? 1) * (spot.rate ?? 1);

  const ring = (rx: number, ry: number, t: number) => {
    if (!rings || t - lastRing < 0.3) return;
    lastRing = t;
    const r = rings.get();
    if (!r) return;
    r.k = 2;
    r.max = 0.9;
    r.r = ringScale * (0.8 + rnd() * 0.4);
    r.s.tint = color;
    r.s.position.set(rx, ry);
    r.s.scale.set(0.05);
  };
  const splash = (sx: number, sy: number) => {
    for (let i = 0; i < 2; i++) {
      const d = pool.get();
      if (!d) return;
      d.k = 1;
      d.max = 0.22 + rnd() * 0.1;
      d.vx = (rnd() - 0.5) * 30;
      d.vy = -12 - rnd() * 14;
      d.s.tint = color;
      d.s.alpha = 0.7;
      d.s.scale.set(0.07);
      d.s.position.set(sx, sy - 0.5);
    }
  };
  const spawn = () => {
    const p = pool.get();
    if (!p) return;
    p.k = 0;
    p.s.tint = color;
    p.s.position.set(x + (rnd() - 0.5) * spread, y);
    switch (kind) {
      case 'drip':
        p.s.position.x = x;
        p.s.scale.set(0.1, 0.1);
        p.vx = 0;
        p.vy = 0;
        p.max = 9;
        break;
      case 'stream':
        p.s.scale.set(0.1 + rnd() * 0.04, 0.4);
        p.s.alpha = 0.45 + rnd() * 0.2;
        p.vx = 0;
        p.vy = 30 + rnd() * 10;
        p.max = 9;
        break;
      case 'smoke':
      case 'steam':
        p.s.scale.set(puff * (0.7 + rnd() * 0.5));
        p.r = puff * 0.45;
        p.s.alpha = 0;
        p.vx = (rnd() - 0.5) * 3;
        p.vy = -5 - rnd() * 5;
        p.max = 2.6 + rnd() * 1.5;
        break;
      case 'sparks': {
        pool.free(p);
        const n = 6 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) {
          const q = pool.get();
          if (!q) break;
          q.k = 0;
          q.s.tint = color;
          q.s.alpha = 1;
          q.s.position.set(x, y);
          q.vx = (rnd() - 0.5) * 60 * (mirror ? -1 : 1);
          q.vy = -rnd() * 35;
          q.max = 0.3 + rnd() * 0.35;
        }
        break;
      }
      case 'bubbles':
        p.s.scale.set(Math.min(0.2, 0.05 + size * 1.2) * (0.6 + rnd() * 0.6));
        p.vx = 0;
        p.vy = -8 - rnd() * 8;
        p.r = rnd() * 10;
        p.max = 12;
        break;
      case 'mist':
        p.s.scale.set(0.12 + rnd() * 0.1);
        p.s.alpha = 0;
        p.vx = (rnd() - 0.5) * 10;
        p.vy = 8 + rnd() * 8;
        p.max = 1 + rnd() * 0.6;
        break;
      case 'leaf':
        p.s.scale.set(0.24, 0.11);
        p.s.alpha = 0.9;
        p.vx = 0;
        p.vy = 5 + rnd() * 4;
        p.r = rnd() * 10;
        p.max = 40;
        break;
      default:
        pool.free(p);
    }
  };
  return (t, power) => {
    const dt = last < 0 ? 0 : Math.min(0.1, t - last);
    last = t;
    if (kind === 'leaf' && fxQuality === 'low') return;
    const active = kind === 'drip' || kind === 'stream' || kind === 'bubbles' || kind === 'leaf' || kind === 'sparks' ? 1 : power;
    const thin = fxQuality === 'low' && kind !== 'drip' && kind !== 'sparks' ? 0.5 : 1;
    acc += dt * rate * active * thin * (0.6 + rnd() * 0.8);
    while (acc >= 1) {
      acc -= 1;
      spawn();
    }
    for (const p of pool.items) {
      if (!p.on) continue;
      p.life += dt;
      const k = p.life / p.max;
      const s = p.s;
      if (k >= 1) {
        pool.free(p);
        continue;
      }
      if (p.k === 1) {
        // Splash droplet.
        p.vy += 160 * dt;
        s.alpha = 0.7 * (1 - k);
      } else if (kind === 'drip') {
        if (p.life < 0.5) {
          // The drop swells on the pipe before it lets go.
          s.scale.set(0.1 + p.life * 0.12, 0.1 + p.life * 0.28);
          s.alpha = 0.85;
        } else {
          p.vy += 300 * dt;
          s.scale.set(0.14, 0.24 + Math.min(0.2, p.vy / 900));
        }
      } else if (kind === 'stream') {
        p.vy += 280 * dt;
        s.scale.y = 0.35 + Math.min(0.5, p.vy / 400);
      } else if (kind === 'sparks') {
        p.vy += 120 * dt;
        s.alpha = 1 - k;
        s.rotation = Math.atan2(p.vy, p.vx);
        s.scale.set(0.12 + Math.min(0.25, Math.hypot(p.vx, p.vy) / 260), 0.08);
      } else if (kind === 'smoke' || kind === 'steam') {
        s.alpha = Math.sin(Math.PI * k) * (kind === 'steam' ? 0.32 : 0.22);
        s.scale.set(s.scale.x + dt * p.r);
        p.vx += Math.sin(t * 1.3 + p.max * 7) * dt * 2;
      } else if (kind === 'bubbles') {
        p.vx = Math.sin(t * 6 + p.r) * 3;
        s.alpha = 0.55 * Math.min(1, (y - s.y) / 3 + 0.2);
      } else if (kind === 'mist') {
        s.alpha = Math.sin(Math.PI * k) * 0.22;
        s.scale.set(s.scale.x + dt * 0.12);
        p.vx *= 1 - dt;
      } else if (kind === 'leaf') {
        p.vx = Math.sin(t * 1.7 + p.r) * 9;
        s.rotation = Math.sin(t * 2.3 + p.r) * 1.2;
      }
      s.x += p.vx * dt;
      s.y += p.vy * dt;
      // Landing: drips and streams splash (and ring) where they hit, bubbles pop at the surface, leaves settle.
      if (p.k === 0 && (kind === 'drip' || kind === 'stream') && s.y >= to) {
        pool.free(p);
        if (kind === 'drip' || rnd() < 0.15) splash(s.x, to);
        ring(s.x, to, t);
      } else if (kind === 'bubbles' && s.y <= to) {
        pool.free(p);
      } else if (kind === 'leaf' && s.y >= to) {
        s.alpha -= dt * 0.6;
        p.vy = 0;
        if (s.alpha <= 0) pool.free(p);
      }
    }
    if (rings) {
      for (const r of rings.items) {
        if (!r.on) continue;
        r.life += dt;
        const k = r.life / r.max;
        if (k >= 1) {
          rings.free(r);
          continue;
        }
        const sc = 0.05 + (r.r - 0.05) * (1 - (1 - k) * (1 - k));
        r.s.scale.set(sc, sc * 0.3);
        r.s.alpha = 0.45 * (1 - k);
      }
    }
  };
}

/** Standalone ripples on a tank or basin surface. */
function ripples(layer: Container, spot: FxSpot, W: number, H: number, mirror: boolean, rnd: () => number): Animator {
  const x = (mirror ? 1 - spot.x : spot.x) * W;
  const y = spot.y * H;
  const pool = new Pool(layer, ringTexture(), 3, true);
  const max = ((spot.size ?? 0.05) * W) / 54;
  let next = 0;
  let last = -1;
  return (t) => {
    const dt = last < 0 ? 0 : Math.min(0.1, t - last);
    last = t;
    if (t >= next) {
      next = t + 0.5 + rnd() * 0.8;
      const r = pool.get();
      if (r) {
        r.max = 1.2;
        r.r = max * (0.6 + rnd() * 0.5);
        r.s.tint = spot.color ?? 0xcfefff;
        r.s.position.set(x + (rnd() - 0.5) * max * 20, y);
      }
    }
    for (const r of pool.items) {
      if (!r.on) continue;
      r.life += dt;
      const k = r.life / r.max;
      if (k >= 1) {
        pool.free(r);
        continue;
      }
      const sc = 0.05 + r.r * k;
      r.s.scale.set(sc, sc * 0.28);
      r.s.alpha = 0.4 * (1 - k);
    }
  };
}

/** Lit screens, LEDs, pulsing glows, flames, fluorescent tubes, fairy lights, welding arcs, monitor traces and radar. */
function glowFx(layer: Container, fxLayer: Container, spot: FxSpot, W: number, H: number, mirror: boolean, seed: number, rnd: () => number): Animator {
  const x = (mirror ? 1 - spot.x : spot.x) * W;
  const y = spot.y * H;
  const color = spot.color ?? 0xffffff;
  const rate = spot.rate ?? 1;
  const glow = (tex: Texture, w: number, h: number) => {
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.tint = color;
    s.width = w;
    s.height = h;
    s.position.set(x, y);
    layer.addChild(s);
    return s;
  };
  switch (spot.kind) {
    case 'blink': {
      const size = (spot.size ?? 0.02) * W;
      const s = glow(glowTexture(), Math.max(3, size * 8), Math.max(3, size * 8));
      const r = (spot.rate ?? 4) * (0.85 + rnd() * 0.3);
      return (t, power) => {
        s.alpha = (Math.sin(t * r + seed) > 0.2 ? 0.9 : 0.12) * (0.3 + 0.7 * power);
      };
    }
    case 'pulse': {
      const size = (spot.size ?? 0.02) * W * 2;
      const s = spot.w && spot.h ? glow(glowTexture(), spot.w * W * 1.5, spot.h * H * 1.5) : glow(glowTexture(), size, size * 0.7);
      return (t, power) => {
        s.alpha = (0.14 + 0.08 * Math.sin(t * 1.4 * rate + seed) + 0.03 * Math.sin(t * 5.1 * rate + seed * 3)) * power;
      };
    }
    case 'screen': {
      if (!spot.w || !spot.h) {
        const size = (spot.size ?? 0.02) * W * 2;
        const s = glow(glowTexture(), Math.max(6, size * 4), Math.max(6, size * 4));
        return (t, power) => {
          s.alpha = (0.35 + 0.1 * Math.sin(t * 9 + seed) + (Math.random() < 0.02 ? 0.2 : 0)) * power;
        };
      }
      const sw = spot.w * W, sh = spot.h * H;
      const face = glow(softRectTexture(), sw * 1.15, sh * 1.2);
      const band = spot.band === false ? null : glow(softRectTexture(), sw, Math.max(1.2, sh * 0.22));
      const period = 1.8 + rnd() * 1.6;
      let step = 0, stepUntil = 0, nextStep = rnd() * 4;
      return (t, power) => {
        // Content changes now and then (a brief brighter frame), otherwise a faint electric shimmer.
        if (t > nextStep) {
          stepUntil = t + 0.08 + rnd() * 0.12;
          nextStep = t + 1.5 + rnd() * 5;
          step = 0.06 + rnd() * 0.08;
        }
        const live = spot.band === false ? 0.06 * Math.sin(t * 7.3 * rate + seed) + 0.04 * Math.sin(t * 19 + seed) : 0.025 * Math.sin(t * 9 + seed);
        face.alpha = (0.2 + live + (t < stepUntil ? step : 0)) * power;
        if (band) {
          const k = ((t / period + seed) % 1);
          band.y = y - sh / 2 + band.height / 2 + k * (sh - band.height);
          band.alpha = 0.22 * Math.sin(Math.PI * k) * power;
        }
      };
    }
    case 'flame': {
      // Candles, lanterns, gas rings and glowing radio valves: a fast, uneven flicker.
      const d = (spot.size ?? 0.008) * W * 6;
      const fw = spot.w ? spot.w * W * 1.4 : d;
      const s = glow(glowTexture(), fw, d);
      const core = glow(glowTexture(), fw * 0.45, d * 0.45);
      return (t, power) => {
        const n = wobble(t * rate, seed);
        s.alpha = (0.4 + 0.45 * n) * (0.4 + 0.6 * power);
        core.alpha = (0.55 + 0.4 * n) * (0.4 + 0.6 * power);
        s.height = d * (0.9 + 0.25 * n);
        s.y = y - d * 0.06 * n;
      };
    }
    case 'twinkle': {
      const d = (spot.size ?? 0.006) * W * 6;
      const s = glow(glowTexture(), d, d);
      const r = 0.6 + rnd() * 0.9;
      return (t, power) => {
        s.alpha = (0.35 + 0.3 * Math.sin(t * r + seed * 3.7) + 0.12 * Math.sin(t * 7.7 * r + seed)) * power;
      };
    }
    case 'tube': {
      // Fluorescent tube: steady, with a stuttering buzz every few seconds.
      const s = glow(softRectTexture(), (spot.w ?? 0.2) * W * 1.1, (spot.h ?? 0.02) * H * 3);
      let from = 3 + rnd() * 6, until = 0;
      return (t, power) => {
        if (t > until + 2 && t > from) {
          until = t + 0.25 + rnd() * 0.6;
          from = t + 5 + rnd() * 10;
        }
        const off = t < until && Math.random() < 0.45;
        s.alpha = (off ? 0.03 : 0.3 + 0.03 * Math.sin(t * 50)) * power;
      };
    }
    case 'weld': {
      // Welding arc: bursts of blue-white flashes, each throwing sparks.
      const d = (spot.size ?? 0.02) * W * 6;
      const s = glow(glowTexture(), d, d);
      const sparks = new Pool(fxLayer, moteTexture(), 16, true);
      let on = false, until = 0, last = -1;
      return (t, power) => {
        const dt = last < 0 ? 0 : Math.min(0.1, t - last);
        last = t;
        if (t > until) {
          on = !on && power > 0.3;
          until = t + (on ? 0.4 + rnd() * 1.1 : 1 + rnd() * 2.2);
        }
        s.alpha = on ? 0.5 + 0.5 * Math.random() : 0;
        s.scale.set((d / 128) * (on ? 0.8 + 0.4 * Math.random() : 1));
        if (on && Math.random() < dt * 30) {
          const p = sparks.get();
          if (p) {
            p.s.tint = 0xfff0c0;
            p.s.position.set(x, y);
            p.vx = (rnd() - 0.5) * 70;
            p.vy = -rnd() * 40;
            p.max = 0.3 + rnd() * 0.3;
          }
        }
        for (const p of sparks.items) {
          if (!p.on) continue;
          p.life += dt;
          if (p.life >= p.max) {
            sparks.free(p);
            continue;
          }
          p.vy += 130 * dt;
          p.s.x += p.vx * dt;
          p.s.y += p.vy * dt;
          p.s.alpha = 1 - p.life / p.max;
          p.s.rotation = Math.atan2(p.vy, p.vx);
          p.s.scale.set(0.12 + Math.min(0.22, Math.hypot(p.vx, p.vy) / 280), 0.07);
        }
      };
    }
    case 'ecg': {
      // A trace running across a monitor: a bright head with a fading tail over a heartbeat-like wave.
      const sw = (spot.w ?? 0.1) * W, sh = (spot.h ?? 0.04) * H;
      const N = 9;
      const dots = Array.from({ length: N }, (_, i) => {
        const s = new Sprite(moteTexture());
        s.anchor.set(0.5);
        s.tint = color;
        s.scale.set(0.12 - i * 0.006);
        layer.addChild(s);
        return s;
      });
      const wave = (p: number) => {
        const f = p - Math.floor(p);
        if (f < 0.1) return 0.15 * Math.sin((f / 0.1) * Math.PI);
        if (f < 0.16) return 0;
        if (f < 0.18) return -0.2;
        if (f < 0.22) return 1 - Math.abs(f - 0.2) * 40;
        if (f < 0.26) return -0.3;
        if (f > 0.4 && f < 0.55) return 0.25 * Math.sin(((f - 0.4) / 0.15) * Math.PI);
        return 0;
      };
      const cross = 2.2 / rate;
      return (t, power) => {
        for (let i = 0; i < N; i++) {
          const k = ((t - i * 0.035) / cross + seed) % 1;
          const px = (k < 0 ? k + 1 : k);
          const s = dots[i];
          s.x = x - sw / 2 + px * sw;
          s.y = y - wave(px * 2.5) * sh * 0.45;
          s.alpha = (1 - i / N) * 0.9 * power;
        }
      };
    }
    case 'radar': {
      const r = (spot.size ?? 0.08) * W;
      const s = glow(sweepTexture(), r * 2, r * 2);
      const blips = [0, 1].map(() => {
        const b = new Sprite(moteTexture());
        b.anchor.set(0.5);
        b.tint = color;
        b.scale.set(0.16);
        const a = rnd() * Math.PI * 2, d = r * (0.3 + rnd() * 0.55);
        b.position.set(x + Math.sin(a) * d, y - Math.cos(a) * d);
        layer.addChild(b);
        return { b, a };
      });
      const dir = mirror ? -1 : 1;
      return (t, power) => {
        const ang = (t * 1.6 * rate) % (Math.PI * 2);
        s.rotation = ang * dir;
        s.alpha = 0.55 * power;
        for (const { b, a } of blips) {
          // Each blip lights up as the sweep passes it, then fades.
          const since = (((ang - (mirror ? Math.PI * 2 - a : a)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          b.alpha = Math.max(0, 1 - since / 2.2) * power;
        }
      };
    }
    default:
      return () => {};
  }
}

/** [plan4:BL-6] Ribs of a conveyor belt (white, tinted per use): two dark bars and a thin highlight per 16 x 8 tile. */
function beltTexture(): Texture {
  return canvasTexture('belt', 16, 8, ctx => {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, 0, 16, 8);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillRect(1, 0, 3, 8);
    ctx.fillRect(9, 0, 3, 8);
  });
}

/** Gauge needles quivering, spinning tape reels and fan blades, moths circling a lamp. */
function propFx(layer: Container, spot: FxSpot, W: number, H: number, mirror: boolean, seed: number, rnd: () => number): Animator {
  const x = (mirror ? 1 - spot.x : spot.x) * W;
  const y = spot.y * H;
  const dir = mirror ? -1 : 1;
  switch (spot.kind) {
    case 'needle': {
      const len = (spot.size ?? 0.012) * W;
      const g = new Graphics();
      g.moveTo(0, len * 0.2).lineTo(0, -len).stroke({ color: spot.color ?? 0x1c1410, width: Math.max(0.35, len * 0.14), alpha: 0.9 });
      g.circle(0, 0, Math.max(0.3, len * 0.13)).fill({ color: 0x1c1410, alpha: 0.9 });
      g.position.set(x, y);
      layer.addChild(g);
      const a = spot.a ?? 0.75, amp = spot.amp ?? 0.1;
      return (t, power) => {
        // Settles, wanders with the load, trembles with the machine; drops back when the power goes.
        const n = 0.6 * Math.sin(t * 0.9 + seed) + 0.3 * Math.sin(t * 2.3 + seed * 1.7) + 0.1 * Math.sin(t * 31 + seed);
        g.rotation = dir * (a * (0.4 + 0.6 * power) + amp * n);
      };
    }
    case 'reel':
    case 'fan': {
      const r = (spot.size ?? 0.02) * W;
      const g = new Graphics();
      if (spot.kind === 'reel') {
        g.circle(0, 0, r).fill({ color: spot.color ?? 0xb8b2a8, alpha: 0.95 });
        g.circle(0, 0, r).stroke({ color: 0x2a2622, width: r * 0.12, alpha: 0.8 });
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          g.circle(Math.cos(a) * r * 0.52, Math.sin(a) * r * 0.52, r * 0.26).fill({ color: 0x2a2622, alpha: 0.9 });
        }
        g.circle(0, 0, r * 0.16).fill({ color: 0x5a544c });
      } else {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          g.ellipse(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.42, r * 0.16).fill({ color: spot.color ?? 0x30343a, alpha: 0.45 });
        }
      }
      g.position.set(x, y);
      layer.addChild(g);
      const speed = (spot.kind === 'reel' ? 1.8 : 11) * (spot.rate ?? 1);
      let ang = rnd() * 6, last = -1, v = 0;
      return (t, power) => {
        const dt = last < 0 ? 0 : Math.min(0.1, t - last);
        last = t;
        // Spins up and down with the power instead of snapping.
        v += (speed * (power > 0.2 ? 1 : 0) - v) * Math.min(1, dt * 1.5);
        ang += v * dt;
        g.rotation = ang * dir;
      };
    }
    case 'belt': {
      // [plan4:BL-6] A conveyor belt: one tiling sprite of dark ribs sliding along a strip (x, y = centre, w x h = the strip).
      const bw = (spot.w ?? 0.2) * W, bh = Math.max(1.2, (spot.h ?? 0.03) * H);
      const ts = new TilingSprite({ texture: beltTexture(), width: bw, height: bh });
      ts.anchor.set(0.5);
      ts.tint = spot.color ?? 0x15110d;
      ts.alpha = 0.55;
      ts.tileScale.set(bh / 8);
      ts.position.set(x, y);
      layer.addChild(ts);
      const sp = 14 * (spot.rate ?? 1);
      let off = rnd() * 10, last = -1, v = 0;
      return (t, power) => {
        const dt = last < 0 ? 0 : Math.min(0.1, t - last);
        last = t;
        v += (sp * Math.min(1, power * 1.2) - v) * Math.min(1, dt * 2);
        off += v * dt * dir;
        ts.tilePosition.x = off / ts.tileScale.x;
      };
    }
    case 'rotor': {
      // [plan4:BL-6] A turbine rotor: `n` long tapering blades turning slowly (wind keeps it going even without grid power).
      const len = (spot.size ?? 0.2) * W, n = spot.n ?? 3;
      const g = new Graphics();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        g.poly([ca * 1.2 - sa * 0.9, sa * 1.2 + ca * 0.9, ca * len, sa * len, ca * 1.2 + sa * 0.9, sa * 1.2 - ca * 0.9]).fill({ color: spot.color ?? 0xcfd2cc, alpha: 0.95 });
      }
      g.circle(0, 0, 1.6).fill({ color: 0x585c60 });
      g.position.set(x, y);
      layer.addChild(g);
      let ang = rnd() * 6, last = -1, v = 0;
      return (t) => {
        const dt = last < 0 ? 0 : Math.min(0.1, t - last);
        last = t;
        const gust = 0.7 + 0.3 * Math.sin(t * 0.37 + seed) + 0.15 * Math.sin(t * 1.3 + seed * 2);
        v += (1.1 * (spot.rate ?? 1) * gust - v) * Math.min(1, dt * 0.8);
        ang += v * dt;
        g.rotation = ang * dir;
      };
    }
    case 'moth': {
      const s = new Sprite(moteTexture());
      s.anchor.set(0.5);
      s.tint = 0x2a2219;
      s.scale.set(0.15, 0.11);
      layer.addChild(s);
      const r = (spot.size ?? 0.035) * W;
      const w1 = 1.3 + rnd(), w2 = 2.1 + rnd(), w3 = 7 + rnd() * 3;
      return (t, power) => {
        const on = power > 0.3 && fxQuality !== 'low';
        s.visible = on;
        if (!on) return;
        s.x = x + Math.sin(t * w1 + seed) * r + Math.sin(t * w3) * r * 0.15;
        s.y = y + Math.sin(t * w2 + seed * 2) * r * 0.55 + Math.cos(t * w3 * 1.3) * r * 0.12;
        // Wings beat: the speck flickers between wide and narrow.
        s.scale.x = 0.08 + 0.08 * Math.abs(Math.sin(t * 38 + seed));
        s.alpha = 0.85;
      };
    }
    default:
      return () => {};
  }
}

/**
 * Heat haze (high quality only): the painted region above an engine, a stove or a reactor is redrawn through a
 * scrolling displacement map, so the air over it shimmers. One small filter pass per hazy room on screen.
 */
function hazeFx(layer: Container, texture: Texture, entry: ArtEntry, spot: FxSpot, idx: number, W: number, H: number, mirror: boolean, art: Sprite): Animator {
  const rw = spot.w ?? 0.2, rh = spot.h ?? 0.2;
  const key = `${entry.key}|${idx}`;
  let sub = subTextures.get(key);
  const fr = texture.frame;
  if (!sub) {
    const fx0 = Math.max(0, (spot.x - rw / 2) * fr.width), fy0 = Math.max(0, (spot.y - rh / 2) * fr.height);
    const fw = Math.min(fr.width - fx0, rw * fr.width), fh = Math.min(fr.height - fy0, rh * fr.height);
    sub = new Texture({ source: texture.source, frame: new Rectangle(fr.x + fx0, fr.y + fy0, fw, fh) });
    subTextures.set(key, sub);
  }
  const holder = new Container();
  const s = new Sprite(sub);
  s.anchor.set(0.5);
  s.width = rw * W;
  s.height = rh * H;
  if (mirror) s.scale.x *= -1;
  const cx = (mirror ? 1 - spot.x : spot.x) * W, cy = spot.y * H;
  s.position.set(cx, cy);
  const map = new Sprite(hazeMapTexture());
  map.width = rw * W;
  map.height = rh * H * 2;
  map.position.set(cx - (rw * W) / 2, cy - (rh * H) / 2);
  const filter = new DisplacementFilter({ sprite: map, scale: 3 });
  holder.addChild(map, s);
  holder.visible = false;
  layer.addChild(holder);
  let attached = false;
  return (t, power) => {
    const on = fxQuality === 'high' && power > 0.3;
    holder.visible = on;
    if (on !== attached) {
      s.filters = on ? [filter] : null;
      attached = on;
    }
    if (!on) return;
    s.tint = art.tint;
    // Heat rises: the map scrolls up one period (half its height) and wraps.
    map.y = cy - (rh * H) / 2 - ((t * 9) % (rh * H));
    filter.scale.x = filter.scale.y = (2.2 + 0.8 * Math.sin(t * 0.7)) * power;
  };
}

/** Floating dust caught in the lamp light, the cheapest way to make a still painting breathe. */
function dustMotes(layer: Container, W: number, H: number, rnd: () => number): Animator {
  const motes = Array.from({ length: Math.round(W / 22) }, () => {
    const s = new Sprite(moteTexture());
    s.anchor.set(0.5);
    s.scale.set(0.08 + rnd() * 0.08);
    s.tint = 0xffe2b0;
    s.blendMode = 'add';
    layer.addChild(s);
    return { s, x: rnd() * W, y: 14 + rnd() * (H - 30), ph: rnd() * 10, sp: 0.15 + rnd() * 0.3 };
  });
  return (t, power) => {
    for (const m of motes) {
      m.s.x = (m.x + Math.sin(t * m.sp + m.ph) * 6 + W) % W;
      m.s.y = m.y + Math.sin(t * m.sp * 0.7 + m.ph * 2) * 5;
      m.s.alpha = (0.25 + 0.25 * Math.sin(t * 0.9 + m.ph)) * power;
    }
  };
}

/** Steel frame where this room meets a different room, plus inner shading that sells depth. */
function frame(W: number, H: number, openLeft: boolean, openRight: boolean): Graphics {
  const g = new Graphics();
  g.rect(0, 0, W, 10).fill(vGradient([[0, 0x000000, 0.55], [1, 0x000000, 0]]));
  g.rect(0, H - 8, W, 8).fill(vGradient([[0, 0x000000, 0], [1, 0x000000, 0.35]]));
  if (!openLeft) {
    g.rect(0, 0, 14, H).fill(hGradient([[0, 0x000000, 0.6], [1, 0x000000, 0]]));
    g.rect(0, 0, 3, H).fill(0x2a2b2f);
    g.rect(3, 0, 1, H).fill({ color: 0x8a8c92, alpha: 0.35 });
  }
  if (!openRight) {
    g.rect(W - 14, 0, 14, H).fill(hGradient([[0, 0x000000, 0], [1, 0x000000, 0.6]]));
    g.rect(W - 3, 0, 3, H).fill(0x2a2b2f);
    g.rect(W - 4, 0, 1, H).fill({ color: 0x000000, alpha: 0.5 });
  }
  return g;
}

/** Rough rock edges around a natural cavern (districts), instead of a steel frame. */
function rockFrame(W: number, H: number, rnd: () => number): Graphics {
  const g = new Graphics();
  const edge = (pts: number[]) => g.poly(pts).fill(0x1e1a17);
  const top: number[] = [0, 0];
  for (let x = 0; x <= W; x += 10) top.push(x, 2 + rnd() * 9);
  top.push(W, 0);
  edge(top);
  const left: number[] = [0, 0];
  for (let y = 0; y <= H; y += 10) left.push(2 + rnd() * 8, y);
  left.push(0, H);
  edge(left);
  const right: number[] = [W, 0];
  for (let y = 0; y <= H; y += 10) right.push(W - 2 - rnd() * 8, y);
  right.push(W, H);
  edge(right);
  g.rect(0, 0, W, 14).fill(vGradient([[0, 0x000000, 0.5], [1, 0x000000, 0]]));
  g.rect(0, H - 8, W, 8).fill(vGradient([[0, 0x000000, 0], [1, 0x000000, 0.4]]));
  return g;
}

const GLOW_KINDS = new Set<FxSpot['kind']>(['blink', 'pulse', 'screen', 'flame', 'twinkle', 'tube', 'weld', 'ecg', 'radar']);
const PROP_KINDS = new Set<FxSpot['kind']>(['needle', 'reel', 'fan', 'moth', 'belt', 'rotor']);

/** gfx-p0 rooms: true when the room is near the screen, so off-screen rooms skip their particle work. */
function onScreen(c: Container, W: number, H: number): boolean {
  if (!c.parent) return true;
  const m = c.worldTransform;
  const x0 = m.tx, y0 = m.ty, x1 = m.tx + m.a * W, y1 = m.ty + m.d * H;
  const pad = 60;
  return Math.max(x0, x1) > -pad && Math.min(x0, x1) < viewport.w + pad
    && Math.max(y0, y1) > -pad && Math.min(y0, y1) < viewport.h + pad;
}

/**
 * A room drawn from a painting, with live layers on top: lamp glows and light cones placed on the
 * painted lamps, flicker and blackout when power is short, particles on painted props, dust motes.
 */
export function buildPaintedRoom(
  texture: Texture, entry: ArtEntry, W: number, openLeft: boolean, openRight: boolean, mirror: boolean, rnd: () => number,
  H: number = ROOM_H,
  /** Per-channel colour gains (painting balance, depth fog, per-room variation); 1,1,1 leaves the painting as is. */
  gains: [number, number, number] = [1, 1, 1],
  /** Room id under which this room's lamp flicker is shared (see roomFlicker). */
  flickerKey?: string,
): RoomVisual {
  const container = new Container();
  const art = new Sprite(texture);
  // Paintings are made at the slot's aspect, so a plain fit keeps the painted lamps under the live lights.
  art.width = W;
  art.height = H;
  if (mirror) {
    art.scale.x *= -1;
    art.x = W;
  }
  // Exposure lift for dark paintings (tier 0 is painted around luma 0.14, which read as "the screen is dark" in
  // play). A tint can only darken, so the lift is the same painting added on top: colour × (1 + boostK), shadows
  // stay black, nothing is washed out. Bright paintings (luma ≥ ~0.26) get none.
  const boostK = Math.max(0, Math.min(0.85, 0.26 / Math.max(0.05, ArtLibrary.lumOf(entry.key) ?? 0.26) - 1));
  const boost = boostK > 0.02 ? new Sprite(texture) : null;
  if (boost) {
    boost.width = W;
    boost.height = H;
    if (mirror) {
      boost.scale.x *= -1;
      boost.x = W;
    }
    boost.blendMode = 'add';
  }
  const hazeLayer = new Container();
  const fxLayer = new Container();
  const lights = new Container();
  lights.blendMode = 'add';
  const animators: Animator[] = [];
  const seed = rnd() * 100;
  // gfx-p0 rooms: bright paintings already carry their lamp light, so the live glow is tamed and cones are skipped.
  const lum = ArtLibrary.lumOf(entry.key) ?? 0.15;
  // [plan4:BL-6] A composed room has its lamp pools baked in: tamed glows, no second cone.
  const tame = Math.max(0.25, Math.min(entry.baked ? 0.7 : 1, 1 - (lum - 0.15) * 1.7));
  beamBudget.n = 0;
  ArtLibrary.lightsFor(entry).forEach((l, i) => animators.push(addLight(lights, l, W, H, mirror, seed + i * 7, tame, lum < 0.3 && !entry.baked)));
  (entry.fx ?? []).forEach((spot, i) => {
    const s = seed + i * 1.37;
    const an = GLOW_KINDS.has(spot.kind) ? glowFx(lights, fxLayer, spot, W, H, mirror, s, rnd)
      : PROP_KINDS.has(spot.kind) ? propFx(fxLayer, spot, W, H, mirror, s, rnd)
        : spot.kind === 'haze' ? hazeFx(hazeLayer, texture, entry, spot, i, W, H, mirror, art)
          : spot.kind === 'ripple' ? ripples(fxLayer, spot, W, H, mirror, rnd)
            : emitter(fxLayer, spot, W, H, mirror, rnd);
    // [plan4:BL-6] `work` effects follow whether the room is staffed (see roomWorking).
    animators.push(spot.work && flickerKey ? (t, power) => an(t, power * (roomWorking.get(flickerKey) ?? 1)) : an);
  });
  animators.push(dustMotes(lights, W, H, rnd));
  container.addChild(art);
  if (boost) container.addChild(boost);
  container.addChild(hazeLayer, fxLayer, lights, entry.kind === 'district' ? rockFrame(W, H, rnd) : frame(W, H, openLeft, openRight));

  const flicker: PowerFlicker = { until: 0, depth: 1 };
  let shown = true;
  return {
    container,
    animate: (t, power) => {
      // gfx-p0 crisis: an incident (blackout, fire smoke, flood short) pulls this room's lamps down.
      const f = flickerFactor(flicker, t, power) * (flickerKey ? crisisLight.get(flickerKey) ?? 1 : 1);
      if (flickerKey) roomFlicker.set(flickerKey, f);
      const level = (0.4 + 0.6 * power) * (0.55 + 0.45 * f);
      const v = 255 * Math.min(1, level);
      const ch = (k: number) => Math.round(Math.min(255, v * k));
      art.tint = (ch(gains[0]) << 16) | (ch(gains[1]) << 8) | ch(gains[2] * (0.94 + 0.06 * power));
      if (boost) {
        // The lift follows the lamps: a blackout still goes dark.
        boost.tint = art.tint;
        boost.alpha = boostK * Math.min(1, level);
      }
      lights.alpha = Math.max(0, power * f);
      // gfx-p0 rooms: painted motion follows the room light; off-screen rooms skip the work entirely.
      fxLayer.alpha = Math.min(1, 0.35 + 0.65 * level);
      const vis = onScreen(container, W, H);
      if (vis !== shown) {
        shown = vis;
        hazeLayer.visible = fxLayer.visible = lights.visible = vis;
      }
      if (!vis) return;
      for (const a of animators) a(t, power);
    },
  };
}

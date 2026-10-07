import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { GameState, Incident, IncidentKind, SurvivorState } from '../core/GameState';
import { INCIDENTS } from '../data/incidents';
import { coneTexture, glowTexture, moteTexture } from '../art/ArtLibrary';
import { iconSprite } from './richText';
import { ROOM_H } from './layout';
import { hashString, seeded } from './draw';
import { puffTexture } from './atmosphere';
import { Person } from './people';
import { roomFlicker } from './paintedRoom';
import { crisisLight } from './crisisLight';
import { flashOk, flashSafe } from '../utils/a11y';

export interface RoomRect {
  x: number;
  y: number;
  w: number;
  h?: number;
}

export type CrisisQuality = 'high' | 'medium' | 'low';

type PKind = 'flame' | 'smoke' | 'steam' | 'wisp' | 'ember' | 'spark' | 'drip' | 'splash' | 'grit';

interface Particle {
  s: Sprite;
  kind: PKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  ph: number;
  /** Smoke: the ceiling it pools under. */
  lim: number;
  /** Smoke: which way it spills along the ceiling (-1 / 1). */
  dir: number;
  /** Drips: the flood whose surface they fall into. */
  owner: View | null;
}

interface Bug {
  x: number;
  y: number;
  vx: number;
  vy: number;
  wall: boolean;
  phase: number;
}

interface View {
  inc: Incident;
  root: Container;
  g: Graphics;
  /** The crisis's own light (fire glow, arc flash, water sheen, red wash). */
  glow: Sprite;
  /** Light that reaches past the room: across the corridor floor and into the neighbours. */
  spill: Sprite;
  /** Kind-specific sprites (seat beds, smoke bank, water layers, beams…). */
  extra: Sprite[];
  raiders: Person[];
  raiderHolder: Container | null;
  bugs: Bug[];
  badge: Container;
  ring: Graphics;
  spawn: number;
  spawn2: number;
  shake: number;
  rect: RoomRect;
  floor: number;
  age: number;
  /** < 0 while the crisis is on; counts the wind-down down once it is over. */
  dying: number;
  /** Fire: smoothed severity; flood: current water height. */
  level: number;
  /** Flood: world y of the water surface. */
  surface: number;
  /** Blackout arc / beacon flash, 0..1. */
  flash: number;
  dipUntil: number;
  dipDepth: number;
  /** Flood ripples as [x, age] pairs (age < 0 = free slot). */
  rip: number[];
  seed: number;
}

interface Scar {
  s: Sprite;
  a: number;
  target: number;
  hold: number;
}

const BADGE_R = 13;
/** Seconds a crisis takes to wind down on screen once it is over (water drains, lamps stutter back on). */
const DIE = 1.6;
/** Seconds the soot of a fire stays on the walls (it fades over the last SCAR_FADE). */
const SCAR_HOLD = 150;
const SCAR_FADE = 40;
const BUDGET: Record<CrisisQuality, number> = { high: 260, medium: 160, low: 90 };
const RATE: Record<CrisisQuality, number> = { high: 1, medium: 0.65, low: 0.4 };
const SEATS = [0.22, 0.5, 0.78];

/** Candle-like noise in 0..1 from incommensurate sines. [plan4:AC-5] No component above 2.4 Hz (15 rad/s): it was up to 3.8 Hz. */
function wob(t: number, seed: number): number {
  if (flashSafe()) return 0.5; // [plan4:AC-5] "no flashes": a steady flame light
  return 0.5 + 0.25 * Math.sin(t * 10.9 + seed) + 0.15 * Math.sin(t * 14.6 + seed * 2.3) + 0.1 * Math.sin(t * 5.3 + seed * 0.7);
}

/** Deterministic 0..1 hash of an integer (stutter patterns). */
function hash01(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function mix(a: number, b: number, k: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const r = ar + (((b >> 16) & 255) - ar) * k;
  const g = ag + (((b >> 8) & 255) - ag) * k;
  const bl = ab + ((b & 255) - ab) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** Flame colour over a tongue's life: white-hot root, yellow, orange, a dull red tip. */
const FLAME_STOPS = [0xfff4c8, 0xffc254, 0xff7a24, 0xc83a12, 0x5a1a08];
function flameTint(k: number): number {
  const f = Math.min(0.999, Math.max(0, k)) * (FLAME_STOPS.length - 1);
  const i = Math.floor(f);
  return mix(FLAME_STOPS[i], FLAME_STOPS[i + 1], f - i);
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

let flameTex: Texture | null = null;

/** A single tongue of flame: round, hot root and a soft pointed tip (white, tinted per use, drawn additive). */
function flameTexture(): Texture {
  if (flameTex) return flameTex;
  const W = 32, H = 64;
  const [c, ctx] = canvas(W, H);
  ctx.filter = 'blur(1.6px)';
  const g = ctx.createRadialGradient(W / 2, H * 0.74, 1, W / 2, H * 0.6, H * 0.52);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(W / 2, 4);
  ctx.bezierCurveTo(W * 0.6, H * 0.3, W * 0.94, H * 0.52, W * 0.86, H * 0.76);
  ctx.bezierCurveTo(W * 0.78, H * 0.95, W * 0.22, H * 0.95, W * 0.14, H * 0.76);
  ctx.bezierCurveTo(W * 0.06, H * 0.52, W * 0.4, H * 0.3, W / 2, 4);
  ctx.fill();
  flameTex = Texture.from(c);
  return flameTex;
}

type Soft = 'band' | 'down' | 'up' | 'body' | 'rect';
const softTex: Partial<Record<Soft, Texture>> = {};

/**
 * Soft gradient sheets (white, tinted per use) so no crisis layer is a flat fill:
 * band = fades downward with feathered sides (smoke banks), down / up = hard-sided vertical fades (water),
 * body = water column getting denser with depth, rect = a sheet feathered on all sides (blackout shade).
 */
function softTexture(kind: Soft): Texture {
  const cached = softTex[kind];
  if (cached) return cached;
  const S = 64;
  const [c, ctx] = canvas(S, S);
  const v = ctx.createLinearGradient(0, 0, 0, S);
  const stops: [number, number][] = kind === 'band' ? [[0, 1], [0.45, 0.55], [1, 0]]
    : kind === 'down' ? [[0, 1], [1, 0]]
      : kind === 'up' ? [[0, 0], [1, 1]]
        : kind === 'body' ? [[0, 0.5], [0.35, 0.75], [1, 1]]
          : [[0, 0], [0.14, 1], [0.86, 1], [1, 0]];
  for (const [o, a] of stops) v.addColorStop(o, `rgba(255,255,255,${a})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, S, S);
  if (kind === 'band' || kind === 'rect') {
    ctx.globalCompositeOperation = 'destination-in';
    const h = ctx.createLinearGradient(0, 0, S, 0);
    h.addColorStop(0, 'rgba(0,0,0,0)');
    h.addColorStop(0.12, 'rgba(0,0,0,1)');
    h.addColorStop(0.88, 'rgba(0,0,0,1)');
    h.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = h;
    ctx.fillRect(0, 0, S, S);
  }
  const tex = Texture.from(c);
  softTex[kind] = tex;
  return tex;
}

let scorchTex: Texture | null = null;

/** Soot left by a fire: a char pool along the floor, plumes licking up from the three seats, a blackened ceiling. */
function scorchTexture(): Texture {
  if (scorchTex) return scorchTex;
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const r = seeded(9137);
  const blob = (x: number, y: number, rad: number, a: number, rx = 1) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    g.addColorStop(0, `rgba(26,15,8,${a})`);
    g.addColorStop(0.6, `rgba(30,18,10,${a * 0.5})`);
    g.addColorStop(1, 'rgba(30,18,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
    ctx.restore();
  };
  for (let i = 0; i < 16; i++) blob(6 + r() * 116, 116 + r() * 10, 10 + r() * 14, 0.55, 1.6);
  for (const seat of [0.25, 0.5, 0.75]) {
    let x = seat * S;
    for (let j = 0; j < 11; j++) {
      x += (r() - 0.5) * 7;
      blob(x, 118 - j * 10 - r() * 4, 15 - j * 0.7 + r() * 4, 0.42 * (1 - j / 12), 0.75);
    }
  }
  for (let i = 0; i < 12; i++) blob(r() * S, 2 + r() * 10, 14 + r() * 12, 0.4, 1.8);
  ctx.fillStyle = 'rgba(20,12,6,0.55)';
  for (let i = 0; i < 180; i++) {
    const y = 40 + r() * 88;
    ctx.fillRect(r() * S, y, 0.6 + r() * 1.2, 0.6 + r() * 1.2);
  }
  scorchTex = Texture.from(c);
  return scorchTex;
}

/**
 * Crisis visuals. Fire is built in layers (hot seat beds, flame tongues, dark smoke that pools under the ceiling
 * and spills out the doors, ember streaks, soot that stays on the walls); a flood is a water column with a lit
 * surface, depth, ripples and a burst main pouring in; a blackout really turns the floor's lamps off (and stutters
 * them back on when fixed); a breach spins a red beacon while painted raiders haul loot; roaches swarm the floor.
 * Each crisis floats an alarm badge under the ceiling: tapping it is the player's helping hand.
 */
export class IncidentLayer {
  readonly fx = new Container();
  readonly badges = new Container();
  /** Set by the renderer from the adaptive quality ladder. */
  quality: CrisisQuality = 'high';
  private views = new Map<string, View>();
  private scars = new Map<string, Scar>();
  private seen = new Set<string>();
  private scarL = new Container();
  private viewL = new Container();
  private flameL = new Container();
  private smokeL = new Container();
  private sparkL = new Container();
  private live: Particle[] = [];
  private pool: Particle[] = [];
  onTap: ((incidentId: string, sx: number, sy: number) => void) | null = null;

  constructor() {
    this.fx.eventMode = 'none';
    this.badges.eventMode = 'passive';
    this.fx.addChild(this.scarL, this.viewL, this.flameL, this.smokeL, this.sparkL);
  }

  has(): boolean {
    return this.views.size > 0;
  }

  update(state: GameState, t: number, dt: number, rectOf: (buildingId: string) => RoomRect | null, floorRect: (floor: number) => RoomRect): void {
    crisisLight.clear();
    this.seen.clear();
    for (const inc of state.incidents ?? []) {
      const rect = rectOf(inc.buildingId);
      if (!rect) continue;
      this.seen.add(inc.id);
      let v = this.views.get(inc.id);
      if (!v) {
        v = this.create(inc, rect);
        this.views.set(inc.id, v);
      }
      v.inc = inc;
      v.rect = rect;
      const b = state.buildings.find(x => x.id === inc.buildingId);
      v.floor = b ? b.position.floor : -1;
      this.animate(v, state, t, dt, floorRect);
    }
    for (const [id, v] of this.views) {
      if (this.seen.has(id)) continue;
      if (v.dying < 0) {
        // Over: the badge goes at once, the room winds down for a moment (water drains, lamps stutter back).
        v.dying = DIE;
        v.badge.destroy({ children: true });
        this.finale(v);
      }
      v.dying -= dt;
      const rect = rectOf(v.inc.buildingId);
      if (!rect || v.dying <= 0) {
        for (const p of this.live) if (p.owner === v) p.owner = null;
        v.root.destroy({ children: true });
        this.views.delete(id);
        continue;
      }
      v.rect = rect;
      this.animate(v, state, t, dt, floorRect);
    }
    this.updateScars(dt, rectOf);
    this.step(dt);
  }

  private create(inc: Incident, rect: RoomRect): View {
    const root = new Container();
    const g = new Graphics();
    const glow = this.light(glowTexture());
    const spill = this.light(glowTexture());
    root.addChild(g, glow, spill);
    this.viewL.addChild(root);

    const def = INCIDENTS[inc.kind];
    const badge = new Container();
    const halo = new Sprite(glowTexture());
    halo.anchor.set(0.5);
    halo.width = halo.height = 48;
    halo.tint = def.color;
    halo.blendMode = 'add';
    const disc = new Graphics();
    disc.circle(0, 0, BADGE_R).fill({ color: 0x1a0e0a, alpha: 0.92 }).stroke({ color: def.color, width: 2 });
    const ring = new Graphics();
    const ic = iconSprite(def.icon, 16, `#${def.color.toString(16).padStart(6, '0')}`);
    ic.anchor.set(0.5);
    badge.addChild(halo, disc, ring, ic);
    badge.eventMode = 'static';
    badge.cursor = 'pointer';
    badge.hitArea = new Rectangle(-22, -22, 44, 44);
    badge.on('pointertap', (e) => {
      e.stopPropagation();
      this.onTap?.(inc.id, e.global.x, e.global.y);
    });
    this.badges.addChild(badge);

    const H = rect.h ?? ROOM_H;
    const extra: Sprite[] = [];
    const bugs: Bug[] = [];
    let raiderHolder: Container | null = null;
    const raiders: Person[] = [];
    const sheet = (tex: Texture, add = false, anchorX = 0, anchorY = 0) => {
      const s = new Sprite(tex);
      s.anchor.set(anchorX, anchorY);
      if (add) s.blendMode = 'add';
      root.addChild(s);
      extra.push(s);
      return s;
    };
    if (inc.kind === 'fire') {
      // 0-2 hot beds under the seats of fire, 3 the smoke bank under the ceiling.
      for (let i = 0; i < 3; i++) sheet(glowTexture(), true, 0.5, 0.5).tint = 0xff8a2a;
      sheet(softTexture('band')).tint = 0x100c0a;
    } else if (inc.kind === 'flood') {
      // 0 water column, 1 lit surface layer, 2 wet band on the wall, 3-6 caustics, 7 the burst main pouring in.
      sheet(softTexture('body')).tint = 0x0a2234;
      sheet(softTexture('down')).tint = 0x3f88a8;
      sheet(softTexture('up')).tint = 0x000000;
      for (let i = 0; i < 4; i++) sheet(glowTexture(), true, 0.5, 0.5).tint = 0x7cc8e8;
      sheet(softTexture('rect'), false, 0.5, 0).tint = 0xa8d8f0;
      root.addChild(g, glow);
    } else if (inc.kind === 'blackout') {
      // 0 floor-wide shade, 1 emergency lamp glow, 2 its dim cone.
      sheet(softTexture('rect')).tint = 0x03050c;
      sheet(glowTexture(), true, 0.5, 0.5).tint = 0xff5a2a;
      sheet(coneTexture(), true, 0.5, 0).tint = 0xff4a20;
      root.addChild(g, glow);
    } else if (inc.kind === 'breach') {
      // Painted raiders under the beacon: 0-1 beams, 2 the spot on the back wall, 3 the beacon's flash.
      raiderHolder = new Container();
      root.addChild(raiderHolder);
      for (let i = 0; i < 2; i++) {
        const p = new Person({ id: `raider_${inc.id}_${i}`, name: 'Raider', portraitIndex: 3 + i * 5 } as unknown as SurvivorState);
        p.dress('metro');
        p.container.eventMode = 'none';
        p.placeIn(`raid:${inc.id}`, { x0: 12, x1: rect.w - 12 });
        raiderHolder.addChild(p.container);
        raiders.push(p);
      }
      sheet(coneTexture(), true, 0.5, 0).tint = 0xff2a14;
      sheet(coneTexture(), true, 0.5, 0).tint = 0xff2a14;
      sheet(glowTexture(), true, 0.5, 0.5).tint = 0xff2a1a;
      sheet(glowTexture(), true, 0.5, 0.5).tint = 0xff4a3a;
      root.addChild(g);
    } else if (inc.kind === 'roaches') {
      for (let i = 0; i < 40; i++) {
        bugs.push({ x: Math.random() * rect.w, y: H - 9 - Math.random() * 4, vx: (Math.random() - 0.5) * 50, vy: 0, wall: i % 4 === 0, phase: Math.random() * 6 });
      }
    }
    return {
      inc, root, g, glow, spill, extra, raiders, raiderHolder, bugs, badge, ring, spawn: 0, spawn2: 0, shake: 0, rect,
      floor: -1, age: 0, dying: -1, level: inc.kind === 'fire' ? inc.severity : 0, surface: rect.y + H, flash: 0,
      dipUntil: 0, dipDepth: 1, rip: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1], seed: Math.random() * 100,
    };
  }

  private light(tex: Texture): Sprite {
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.alpha = 0;
    return s;
  }

  /** Player tapped the alarm: a squirt of the right kind of help. */
  hit(incidentId: string): void {
    const v = this.views.get(incidentId);
    if (!v || v.dying >= 0) return;
    v.shake = 1;
    const { x, y, w } = v.rect;
    const H = v.rect.h ?? ROOM_H;
    const kind = v.inc.kind;
    const color = kind === 'fire' ? 0x9fd8ff : kind === 'flood' ? 0xd8f0ff : kind === 'blackout' ? 0xfff2a0 : kind === 'roaches' ? 0xc8a070 : 0xffd27a;
    for (let i = 0; i < 14; i++) {
      this.emit('splash', x + w * (0.25 + Math.random() * 0.5), y + H * (0.45 + Math.random() * 0.3),
        (Math.random() - 0.5) * 120, -40 - Math.random() * 70, 0.5 + Math.random() * 0.4, 2 + Math.random() * 2, color, null);
    }
    // Water on a fire flashes to steam.
    if (kind === 'fire') {
      for (let i = 0; i < 4; i++) {
        this.emit('steam', x + w * (0.3 + Math.random() * 0.4), y + H - 20, (Math.random() - 0.5) * 16, -22 - Math.random() * 10, 1.4 + Math.random() * 0.6, 8 + Math.random() * 5, 0xdfe4e6, null);
      }
    }
    // Squash a few roaches.
    if (kind === 'roaches') v.bugs.splice(0, Math.min(v.bugs.length - 6, 3));
  }

  /** The crisis ended: a fire hisses out in steam, raiders and roaches leave a glint behind. */
  private finale(v: View): void {
    const { x, y, w } = v.rect;
    const H = v.rect.h ?? ROOM_H;
    if (v.inc.kind === 'fire') {
      for (let i = 0; i < 18; i++) {
        this.emit('steam', x + w * (0.12 + Math.random() * 0.76), y + H - 12 - Math.random() * 20, (Math.random() - 0.5) * 20, -14 - Math.random() * 22,
          1.8 + Math.random() * 1.2, 9 + Math.random() * 7, 0xe2e7ea, null);
      }
    } else if (v.inc.kind === 'roaches' || v.inc.kind === 'breach') {
      for (let i = 0; i < 16; i++) {
        this.emit('splash', x + Math.random() * w, y + H * (0.4 + Math.random() * 0.5), (Math.random() - 0.5) * 30, -20 - Math.random() * 40, 0.8 + Math.random() * 0.6, 1.5 + Math.random(), 0xfff0b0, null);
      }
    }
  }

  // ---- particles (one pool for every crisis) ----

  private emit(kind: PKind, x: number, y: number, vx: number, vy: number, life: number, size: number, tint: number, owner: View | null): Particle | null {
    if (this.live.length >= BUDGET[this.quality]) return null;
    let p = this.pool.pop();
    if (!p) {
      p = { s: new Sprite(), kind, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 1, ph: 0, lim: 0, dir: 1, owner: null };
    }
    const smoky = kind === 'smoke' || kind === 'steam' || kind === 'wisp';
    p.s.texture = kind === 'flame' ? flameTexture() : smoky ? puffTexture() : moteTexture();
    p.s.anchor.set(0.5, kind === 'flame' ? 0.85 : 0.5);
    p.s.blendMode = smoky || kind === 'grit' ? 'normal' : 'add';
    p.s.tint = tint;
    p.s.rotation = 0;
    p.s.alpha = 0;
    p.s.visible = false;
    (kind === 'flame' ? this.flameL : smoky ? this.smokeL : this.sparkL).addChild(p.s);
    p.kind = kind;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.age = 0; p.life = life; p.size = size; p.ph = Math.random() * 10;
    p.lim = -1e9; p.dir = vx < 0 ? -1 : 1; p.owner = owner;
    this.live.push(p);
    return p;
  }

  private release(i: number): void {
    const p = this.live[i];
    p.s.removeFromParent();
    p.owner = null;
    this.live[i] = this.live[this.live.length - 1];
    this.live.pop();
    if (this.pool.length < 320) this.pool.push(p);
    else p.s.destroy();
  }

  private step(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        this.release(i);
        continue;
      }
      const s = p.s;
      switch (p.kind) {
        case 'flame': {
          // A tongue leaves the bed, stretches as it climbs, sways, then tears off and cools to a red tip.
          p.vy -= 22 * dt;
          p.vx *= 1 - dt * 2;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const sway = Math.sin(p.age * 9 + p.ph) * (1 + k * 3);
          s.position.set(p.x + sway, p.y);
          s.width = 6.5 * p.size * (1 - 0.5 * k);
          s.height = 15 * p.size * (0.55 + 0.8 * Math.sin(Math.min(1, k * 1.4) * Math.PI / 2)) * (1 - 0.55 * k * k);
          s.rotation = Math.max(-0.35, Math.min(0.35, p.vx * 0.012)) + 0.1 * Math.sin(p.age * 11 + p.ph);
          s.tint = flameTint(k);
          s.alpha = Math.min(1, k * 8) * Math.pow(1 - k, 1.2) * 0.95;
          break;
        }
        case 'smoke':
        case 'steam':
        case 'wisp': {
          if (p.y > p.lim) {
            // Hot smoke climbs; steam and wisps just rise and spread.
            p.vy = Math.max(p.vy - 10 * dt, -30);
          } else {
            // Banked under the ceiling: it stops climbing and rolls along it towards the doors.
            p.vy *= 1 - dt * 5;
            p.y = Math.max(p.y, p.lim - 3);
            p.vx += p.dir * 16 * dt;
            p.vx = Math.max(-24, Math.min(24, p.vx));
          }
          p.vx += Math.sin(p.age * 1.6 + p.ph) * 6 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const sz = p.size * (0.45 + 1.15 * Math.sqrt(k));
          s.width = sz * 1.35;
          s.height = sz;
          s.rotation = p.ph + p.age * 0.15;
          s.position.set(p.x, p.y);
          if (p.kind === 'smoke') {
            // Lit orange from below while it is low and fresh, then a cold soot grey that thins out.
            s.tint = k < 0.22 ? mix(0x5a3218, 0x1d1915, k / 0.22) : mix(0x1d1915, 0x2c2826, (k - 0.22) / 0.78);
            s.alpha = 0.62 * Math.min(1, k * 5) * Math.pow(1 - k, 1.1);
          } else {
            s.alpha = (p.kind === 'steam' ? 0.42 : 0.26) * Math.min(1, k * 6) * (1 - k);
          }
          break;
        }
        case 'ember': {
          // Buoyant at first, wandering on the draught, then it cools and drops.
          p.vy += (k < 0.55 ? -28 : 46) * dt;
          p.vx += Math.sin(p.age * 7 + p.ph) * 70 * dt;
          p.vx *= 1 - dt * 0.8;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const sp = Math.hypot(p.vx, p.vy);
          s.rotation = Math.atan2(p.vy, p.vx) + Math.PI / 2;
          s.width = 1.2 * p.size;
          s.height = p.size * (1.2 + Math.min(5, sp * 0.05));
          s.position.set(p.x, p.y);
          s.tint = mix(0xffd070, 0xff4a14, k);
          s.alpha = (1 - k * k) * (0.65 + 0.35 * Math.sin(p.age * 30 + p.ph));
          break;
        }
        case 'spark': {
          p.vy += 220 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          s.rotation = Math.atan2(p.vy, p.vx) + Math.PI / 2;
          s.width = p.size;
          s.height = p.size + Math.min(4, Math.hypot(p.vx, p.vy) * 0.04);
          s.position.set(p.x, p.y);
          s.alpha = 1 - k * k;
          break;
        }
        case 'drip': {
          p.vy += 300 * dt;
          p.y += p.vy * dt;
          s.width = 0.9;
          s.height = 1.6 + Math.min(2.2, p.vy * 0.012);
          s.position.set(p.x, p.y);
          s.alpha = 0.85;
          const o = p.owner;
          if (o && p.y >= o.surface) {
            this.ripple(o, p.x);
            for (let j = 0; j < 2; j++) this.emit('splash', p.x, o.surface, (Math.random() - 0.5) * 26, -14 - Math.random() * 14, 0.3, 0.7, 0xc8e4f0, null);
            this.release(i);
            continue;
          }
          break;
        }
        case 'splash':
        case 'grit': {
          p.vy += (p.kind === 'grit' ? 200 : 260) * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          s.position.set(p.x, p.y);
          s.width = s.height = p.size;
          s.alpha = p.kind === 'grit' ? 0.8 * (1 - k) : 1 - k;
          break;
        }
      }
      s.visible = true;
    }
  }

  private ripple(v: View, x: number): void {
    const r = v.rip;
    let slot = 0;
    for (let i = 0; i < r.length; i += 2) {
      if (r[i + 1] < 0) { slot = i; break; }
      if (r[i + 1] > r[slot + 1]) slot = i;
    }
    r[slot] = x;
    r[slot + 1] = 0;
  }

  // ---- soot ----

  private scarFor(buildingId: string): Scar {
    let sc = this.scars.get(buildingId);
    if (!sc) {
      const s = new Sprite(scorchTexture());
      s.blendMode = 'multiply';
      s.alpha = 0;
      this.scarL.addChild(s);
      sc = { s, a: 0, target: 0, hold: SCAR_HOLD };
      this.scars.set(buildingId, sc);
    }
    return sc;
  }

  private updateScars(dt: number, rectOf: (buildingId: string) => RoomRect | null): void {
    for (const [id, sc] of this.scars) {
      const rect = rectOf(id);
      sc.hold -= dt;
      if (!rect || sc.hold <= 0) {
        sc.s.destroy();
        this.scars.delete(id);
        continue;
      }
      sc.a += (sc.target - sc.a) * Math.min(1, dt * 0.35);
      sc.s.position.set(rect.x, rect.y);
      sc.s.width = rect.w;
      sc.s.height = rect.h ?? ROOM_H;
      sc.s.alpha = sc.a * Math.min(1, sc.hold / SCAR_FADE);
    }
  }

  /** Lamps of a room pulled down to `f` this frame (the darkest crisis wins). */
  private dim(roomId: string, f: number): void {
    const prev = crisisLight.get(roomId);
    crisisLight.set(roomId, prev === undefined ? f : Math.min(prev, f));
  }

  private animate(v: View, state: GameState, t: number, dt: number, floorRect: (floor: number) => RoomRect): void {
    const { inc, g, glow, spill, extra } = v;
    const { x, y, w } = v.rect;
    const H = v.rect.h ?? ROOM_H;
    const alive = v.dying < 0;
    const fade = alive ? 1 : Math.max(0, v.dying / DIE);
    const q = RATE[this.quality];
    v.age += dt;
    g.clear();
    const kind: IncidentKind = inc.kind;

    if (kind === 'fire') {
      v.level += (inc.severity - v.level) * Math.min(1, dt * 1.5);
      const sev = v.level;
      const heat = (0.4 + 0.6 * sev) * fade;
      const fl = wob(t, v.seed);
      // The fire's light: a hot wash in the room and a pool that spills across the corridor into the neighbours.
      glow.position.set(x + w / 2, y + H * 0.72);
      glow.width = w * 1.7;
      glow.height = H * 1.45;
      glow.tint = 0xff6a1a;
      glow.alpha = (0.3 + 0.3 * fl) * heat;
      spill.position.set(x + w / 2, y + H - 4);
      spill.width = w + 120;
      spill.height = 36;
      spill.tint = 0xff7a2a;
      spill.alpha = (0.22 + 0.16 * fl) * heat;
      const seats = Math.min(3, 1 + Math.floor(sev * 3 + 0.6));
      for (let i = 0; i < 3; i++) {
        const bed = extra[i];
        bed.visible = i < seats;
        bed.position.set(x + w * SEATS[i], y + H - 6);
        bed.width = 30 + 26 * sev;
        bed.height = 14 + 6 * sev;
        bed.alpha = (0.55 + 0.35 * wob(t * 1.3, v.seed + i * 3)) * heat;
      }
      // Smoke banks down from the ceiling, thicker as the fire grows.
      const bank = extra[3];
      bank.position.set(x - 12, y);
      bank.width = w + 24;
      bank.height = 14 + 32 * sev;
      bank.alpha = (0.3 + 0.42 * sev) * fade;
      const sc = this.scarFor(inc.buildingId);
      sc.target = Math.max(sc.target, 0.25 + 0.65 * sev);
      sc.hold = SCAR_HOLD;
      this.dim(inc.buildingId, (1 - 0.4 * sev * fade) * (0.9 + 0.1 * fl));
      if (alive) {
        v.spawn += dt * (36 + 40 * sev) * q;
        while (v.spawn >= 1) {
          v.spawn -= 1;
          const si = Math.floor(Math.random() * seats);
          const middle = si === 1 ? 1.15 : 1;
          this.emit('flame', x + w * SEATS[si] + (Math.random() - 0.5) * 14 * (0.6 + sev), y + H - 6,
            (Math.random() - 0.5) * 12, -(24 + Math.random() * 30) * (0.7 + 0.5 * sev), 0.42 + Math.random() * 0.38,
            (0.85 + 0.75 * sev + Math.random() * 0.45) * middle, 0xfff4c8, null);
        }
        v.spawn2 += dt * (7 + 12 * sev) * q;
        while (v.spawn2 >= 1) {
          v.spawn2 -= 1;
          const sx = x + w * SEATS[Math.floor(Math.random() * seats)] + (Math.random() - 0.5) * 10;
          if (Math.random() < 0.55) {
            const p = this.emit('smoke', sx, y + H - 34 - Math.random() * 12, (Math.random() - 0.5) * 8, -14 - Math.random() * 8,
              3.4 + Math.random() * 1.6, 12 + Math.random() * 8 + sev * 6, 0x1d1915, null);
            if (p) {
              p.lim = y + 6 + Math.random() * (6 + 20 * sev);
              p.dir = sx < x + w / 2 ? -1 : 1;
            }
          } else {
            this.emit('ember', sx, y + H - 22, (Math.random() - 0.5) * 40, -45 - Math.random() * 50, 1 + Math.random() * 0.9, 0.9 + Math.random() * 0.6, 0xffd070, null);
          }
        }
      }
    } else if (kind === 'flood') {
      const target = alive ? 10 + inc.severity * 42 : 0;
      v.level += (target - v.level) * Math.min(1, dt * (alive ? 1.2 : 2.4));
      const level = Math.max(0, v.level);
      const top = y + H - level;
      v.surface = top;
      const body = extra[0], sheen = extra[1], wet = extra[2];
      body.position.set(x, top);
      body.width = w;
      body.height = level;
      body.alpha = 0.82;
      sheen.position.set(x, top);
      sheen.width = w;
      sheen.height = Math.min(level, 16);
      sheen.alpha = 0.45;
      // The wall is soaked a little above the waterline.
      wet.position.set(x, top - 10);
      wet.width = w;
      wet.height = 10;
      wet.alpha = 0.24 * Math.min(1, level / 12);
      // Light dancing under the surface.
      for (let i = 0; i < 4; i++) {
        const c = extra[3 + i];
        const depth = ((i * 0.37 + 0.15) % 1) * Math.max(0, level - 10);
        c.position.set(x + ((t * (5 + i * 2.5) + i * w * 0.29) % w), top + 5 + depth);
        c.width = 24 + i * 5;
        c.height = 3.5;
        c.alpha = level > 8 ? (0.1 + 0.07 * Math.sin(t * 1.7 + i * 2)) * Math.min(1, level / 20) : 0;
      }
      // The burst main: a pouring stream from the ceiling into the water.
      const stream = extra[7];
      const sxp = x + w * 0.68;
      stream.position.set(sxp, y + 7);
      stream.width = 3.2;
      stream.height = Math.max(0, top - y - 7);
      stream.alpha = alive ? 0.4 + 0.12 * Math.sin(t * 23) : 0;
      glow.position.set(x + w / 2, top);
      glow.width = w * 1.1;
      glow.height = 18;
      glow.tint = 0x5ab0e0;
      glow.alpha = 0.18 * fade * Math.min(1, level / 10);
      // Surface: a slow swell with a lit meniscus, glints and the rings where drops land.
      if (level > 1) {
        const wave = (px: number) => top + Math.sin(t * 2.6 + px * 0.21) * 1.1 + Math.sin(t * 1.7 - px * 0.09) * 0.8;
        g.moveTo(x, wave(0));
        for (let px = 4; px <= w; px += 4) g.lineTo(x + px, wave(px));
        g.lineTo(x + w, wave(w) + 3.5);
        for (let px = w - 4; px >= 0; px -= 4) g.lineTo(x + px, wave(px) + 3.5);
        g.closePath().fill({ color: 0x6ab0d0, alpha: 0.32 });
        g.moveTo(x, wave(0));
        for (let px = 4; px <= w; px += 4) g.lineTo(x + px, wave(px));
        g.stroke({ color: 0xbfe6f8, width: 1, alpha: 0.75 });
        for (let i = 0; i < 3; i++) {
          const gx = (t * 11 + i * w / 3 + v.seed * 7) % w;
          g.moveTo(x + gx, wave(gx) - 0.3).lineTo(x + Math.min(w, gx + 5), wave(gx + 5) - 0.3)
            .stroke({ color: 0xffffff, width: 1.1, alpha: 0.5 + 0.4 * Math.sin(t * 3 + i * 2) });
        }
        const r = v.rip;
        for (let i = 0; i < r.length; i += 2) {
          if (r[i + 1] < 0) continue;
          r[i + 1] += dt;
          const a = r[i + 1];
          if (a > 0.9) { r[i + 1] = -1; continue; }
          const rad = 2 + a * 16;
          g.ellipse(r[i], top + 1, rad, rad * 0.25).stroke({ color: 0xcfeaff, width: 0.8, alpha: (1 - a / 0.9) * 0.6 });
        }
        // Where the stream hits, the surface churns.
        if (alive) g.ellipse(sxp, top + 1, 5 + Math.sin(t * 17) * 1.2, 1.4).fill({ color: 0xe0f4ff, alpha: 0.45 });
        // Flotsam bobbing on the swell.
        for (let i = 0; i < 2; i++) {
          const bx = w * (0.28 + 0.38 * i) + Math.sin(t * 0.4 + i * 2) * 8;
          const by = wave(bx) + 0.6;
          const a = Math.sin(t * 1.3 + i * 1.7) * 0.15;
          const ca = Math.cos(a), sa = Math.sin(a);
          const hw = 4.5 - i, hh = 1.1;
          g.poly([
            x + bx - hw * ca + hh * sa, by - hw * sa - hh * ca, x + bx + hw * ca + hh * sa, by + hw * sa - hh * ca,
            x + bx + hw * ca - hh * sa, by + hw * sa + hh * ca, x + bx - hw * ca - hh * sa, by - hw * sa + hh * ca,
          ]).fill({ color: i ? 0x5a4632 : 0x3a2a1c, alpha: Math.min(1, level / 6) });
        }
      }
      // Water in the wiring: the room's lamps dip now and then.
      if (alive && t > v.dipUntil && Math.random() < dt * (0.4 + inc.severity)) {
        v.dipUntil = t + 0.05 + Math.random() * 0.16;
        v.dipDepth = 0.3 + Math.random() * 0.4;
      }
      this.dim(inc.buildingId, (t < v.dipUntil ? v.dipDepth : 1) * (1 - 0.15 * inc.severity * fade));
      if (alive) {
        v.spawn += dt * (1.5 + 2.5 * inc.severity) * q;
        while (v.spawn >= 1) {
          v.spawn -= 1;
          this.emit('drip', x + w * (0.18 + Math.random() * 0.4), y + 9, 0, 10, 2, 1, 0x9fd8ff, v);
        }
        v.spawn2 += dt * 10 * q;
        while (v.spawn2 >= 1) {
          v.spawn2 -= 1;
          this.emit('splash', sxp + (Math.random() - 0.5) * 4, top, (Math.random() - 0.5) * 36, -18 - Math.random() * 22, 0.35, 0.8, 0xc8e8f8, null);
        }
      }
    } else if (kind === 'blackout') {
      // The lamps stutter and die, stay dead, and stutter back on once it is fixed.
      let lamp: number;
      if (!alive) {
        const r = DIE - v.dying;
        lamp = r > DIE - 0.3 || hash01(Math.floor(r * 15) + v.seed) < r / (DIE - 0.3) + 0.1 ? 1 : 0.12;
      } else if (v.age < 1) {
        lamp = hash01(Math.floor(v.age * 15) + v.seed) < 0.85 - v.age ? 1 : 0.06;
      } else {
        lamp = 0.05;
      }
      const dark = Math.min(1, (1 - lamp) / 0.95);
      const fr = v.floor >= 0 ? floorRect(v.floor) : v.rect;
      if (v.floor >= 0) {
        for (const b of state.buildings) if (b.position.floor === v.floor) this.dim(b.id, lamp);
      } else {
        this.dim(inc.buildingId, lamp);
      }
      // Painted rooms really go dark through their lamps; the shade only deepens it (code-drawn rooms need more).
      const painted = roomFlicker.has(inc.buildingId);
      const shade = extra[0];
      shade.position.set(fr.x - 8, fr.y - 4);
      shade.width = fr.w + 16;
      shade.height = H + 8;
      shade.alpha = dark * (painted ? 0.4 : 0.62);
      // A battery emergency lamp keeps a dim red pulse going in the dead room.
      const ex = x + w - 12, ey = y + 13;
      g.roundRect(ex - 4, ey - 4, 8, 4, 1).fill(0x2a2826);
      g.ellipse(ex, ey + 0.5, 3, 1.6).fill(mix(0x4a1408, 0xff6a3a, dark * (0.6 + 0.4 * Math.sin(t * 2.2))));
      const em = extra[1];
      em.position.set(ex, ey);
      em.width = em.height = 22;
      em.alpha = dark * (0.5 + 0.3 * Math.sin(t * 2.2));
      const cone = extra[2];
      cone.position.set(ex, ey + 2);
      cone.width = Math.min(70, w * 0.8);
      cone.height = H - 16;
      cone.alpha = dark * (0.09 + 0.05 * Math.sin(t * 2.2));
      // The shorted switchboard: an open box that arcs, lighting the room blue-white for an instant.
      const fx = x + w * 0.18, fy = y + H * 0.48;
      g.rect(fx - 5, fy - 7, 10, 13).fill(0x26282a).stroke({ color: 0x55585c, width: 0.8 });
      g.poly([fx + 5, fy - 7, fx + 9, fy - 5, fx + 9, fy + 8, fx + 5, fy + 6]).fill(0x34373a);
      // [plan4:AC-5] At most ~1.6 arcs a second, each gated by the global flash budget; 'safe' mode shows a steady dim glow instead.
      const safeFx = flashSafe();
      if (alive && !safeFx && Math.random() < dt * 1.6 && flashOk(`arc${inc.id}`)) {
        v.flash = 1;
        for (let i = 0; i < 6; i++) {
          this.emit('spark', fx, fy, (Math.random() - 0.5) * 120, -Math.random() * 80, 0.35 + Math.random() * 0.3, 1 + Math.random() * 0.5, Math.random() < 0.5 ? 0xd8e8ff : 0xfff0c0, null);
        }
      }
      v.flash = Math.max(0, v.flash - dt * 9);
      glow.position.set(fx, fy);
      glow.width = glow.height = 30 + 80 * v.flash;
      glow.tint = 0xb8d0ff;
      glow.alpha = (safeFx ? 0.22 : 0.1 + 0.4 * v.flash) * dark;
      spill.alpha = 0;
      if (v.flash > 0.45) {
        g.moveTo(fx - 3, fy - 3);
        for (let i = 1; i <= 4; i++) g.lineTo(fx - 3 + i * 2, fy - 3 + (Math.random() - 0.5) * 7);
        g.stroke({ color: 0xeef4ff, width: 1.1 });
      }
      if (alive) {
        v.spawn += dt * 1.6 * q;
        while (v.spawn >= 1) {
          v.spawn -= 1;
          this.emit('wisp', fx + 2, fy - 6, (Math.random() - 0.5) * 6, -9 - Math.random() * 5, 2.4, 5 + Math.random() * 3, 0x5a5a5c, null);
        }
      }
    } else if (kind === 'roaches') {
      const alivebugs = Math.round(14 + inc.severity * 26);
      glow.alpha = 0;
      g.alpha = fade;
      g.rect(x, y + H - 16, w, 16).fill({ color: 0x3a2008, alpha: 0.18 + 0.12 * inc.severity });
      for (let i = 0; i < Math.min(alivebugs, v.bugs.length); i++) {
        const bug = v.bugs[i];
        bug.phase += dt * 20;
        if (Math.random() < dt * 2) bug.vx = (Math.random() - 0.5) * 60;
        bug.x += bug.vx * dt;
        if (bug.wall) {
          bug.vy = Math.sin(t * 2 + i) * 18;
          bug.y = Math.max(14, Math.min(H - 10, bug.y + bug.vy * dt));
        }
        if (bug.x < 4 || bug.x > w - 4) {
          bug.vx = -bug.vx;
          bug.x = Math.max(4, Math.min(w - 4, bug.x));
        }
        const bx = x + bug.x, by = y + bug.y;
        const dir = Math.sign(bug.vx) || 1;
        const leg = Math.sin(bug.phase) * 1.4;
        g.moveTo(bx - 1.5, by).lineTo(bx - 2.2, by + 2 + leg).moveTo(bx + 1.5, by).lineTo(bx + 2.2, by + 2 - leg)
          .moveTo(bx, by).lineTo(bx, by + 2 + leg * 0.5)
          .moveTo(bx + 3 * dir, by - 0.6).lineTo(bx + 6 * dir, by - 3).moveTo(bx + 3 * dir, by - 0.2).lineTo(bx + 6.4 * dir, by - 1)
          .stroke({ color: 0x1a0e06, width: 0.6 });
        g.ellipse(bx, by, 3.4, 1.9).fill(0x6a3a14);
        g.ellipse(bx - 0.6 * dir, by - 0.6, 2, 0.7).fill({ color: 0xd8a060, alpha: 0.7 });
        g.circle(bx + 3 * dir, by - 0.2, 1.1).fill(0x2a1608);
      }
    } else if (kind === 'breach') {
      // A red beacon turns under the ceiling: two beams sweep the room, one throws a spot on the back wall,
      // and it flashes each time a beam faces us. The room's own lamps are knocked down so the red reads.
      const phi = t * 4.2 + v.seed;
      const c = Math.cos(phi), s = Math.sin(phi);
      const bx = x + w / 2, by = y + 9;
      const L = Math.min(w * 0.62, 150) + 20;
      // [plan4:AC-5] A smooth pulse (a plain sinusoid, 1.3 Hz) instead of a sharp beat; 'safe' mode holds a steady red.
      const safeFx = flashSafe();
      const flash = safeFx ? 0.4 : 0.15 + 0.85 * s * s;
      for (let i = 0; i < 2; i++) {
        const beam = extra[i];
        const hx = i === 0 ? c : -c;
        const toward = i === 0 ? s : -s;
        beam.position.set(bx, by);
        beam.rotation = hx >= 0 ? -Math.PI / 2 + 0.34 : Math.PI / 2 - 0.34;
        beam.height = Math.abs(hx) * L;
        beam.width = 40 + 18 * Math.abs(hx);
        beam.alpha = (safeFx ? 0.4 : 0.2 + 0.5 * Math.max(0, toward)) * fade;
      }
      const spot = extra[2];
      spot.position.set(bx + (s < 0 ? c : -c) * L * 0.8, by + 30);
      spot.width = 54;
      spot.height = 64;
      spot.alpha = (safeFx ? 0.2 : 0.34 * Math.abs(s)) * fade;
      const fl = extra[3];
      fl.position.set(bx, by);
      fl.width = fl.height = 40 + 40 * flash;
      fl.alpha = (0.3 + 0.7 * flash) * fade;
      glow.position.set(bx, y + H * 0.55);
      glow.width = w * 1.3;
      glow.height = H * 1.2;
      glow.tint = 0xff2a1a;
      glow.alpha = (0.06 + 0.2 * flash) * fade;
      spill.alpha = 0;
      g.rect(bx - 5, y + 2, 10, 3).fill(0x2a2a2c);
      g.ellipse(bx, by, 4.2, 3.8).fill(mix(0x5a0e0a, 0xff5a44, Math.max(0.2, flash) * fade));
      g.circle(bx - 1.2, by - 1.4, 1).fill({ color: 0xffffff, alpha: 0.5 });
      // The torn vent they came through, still shedding grit.
      const vx = x + w * 0.74;
      g.rect(vx, y + 2, 14, 6).fill(0x0a0a0a).stroke({ color: 0x6a6a70, width: 1 });
      g.poly([vx + 1, y + 8, vx + 13, y + 8, vx + 11, y + 14, vx + 2, y + 12]).fill(0x4a4c50).stroke({ color: 0x2a2a2c, width: 0.6 });
      if (alive && Math.random() < dt * 2.2 * q) this.emit('grit', vx + 3 + Math.random() * 8, y + 9, (Math.random() - 0.5) * 10, 5, 0.9, 0.9, 0x8a8070, null);
      // Raiders hauling loot, lit red by the beacon.
      if (v.raiderHolder) {
        v.raiderHolder.position.set(x, y);
        v.raiderHolder.alpha = fade;
        for (const r of v.raiders) {
          r.update(dt, t, 1, 'carry');
          const lit = Math.round((0.15 + 0.85 * flash) * 5) / 5;
          r.setAmbient(mix(0x5a4c48, 0xd06050, lit * 0.7));
        }
      }
      this.dim(inc.buildingId, 1 - 0.5 * fade);
    }

    // The alarm badge: under the ceiling, out of the fire's way; bobbing, shaking when hit, with a progress ring.
    if (!alive) return;
    v.shake = Math.max(0, v.shake - dt * 4);
    const bob = Math.sin(t * 4) * 1.5;
    v.badge.position.set(x + w / 2 + Math.sin(t * 60) * 2.5 * v.shake, y + 16 + bob);
    const pulse = 1 + 0.08 * Math.sin(t * 9) * (0.4 + inc.severity);
    v.badge.scale.set(pulse * (1 + v.shake * 0.25));
    const def = INCIDENTS[kind];
    v.ring.clear();
    v.ring.circle(0, 0, BADGE_R + 3).stroke({ color: 0x000000, width: 3, alpha: 0.5 });
    if (inc.progress > 0.005) {
      v.ring.arc(0, 0, BADGE_R + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * inc.progress).stroke({ color: 0x7affb0, width: 3 });
    }
    // Severity shows as a red arc closing in from the other side.
    v.ring.arc(0, 0, BADGE_R + 6.5, Math.PI / 2, Math.PI / 2 + Math.PI * 2 * inc.severity).stroke({ color: def.color, width: 1.5, alpha: 0.7 });
  }
}

// ---------------------------------------------------------------------------------------------------------
// [Danger C2/C3] Disaster countdown overlays and rust over worn rooms. Drawn as light Graphics washes (no
// textures, no particles pool): dust and cracks for a cave-in, a rising water line for a flood, green mist
// for an epidemic, a red pulse for a reactor about to melt. Rooms past 50% wear get rust streaks.
// ---------------------------------------------------------------------------------------------------------
export class DisasterLayer {
  readonly fx = new Container();
  private wash = new Graphics();
  private rust = new Map<string, { key: string; g: Graphics }>();

  constructor() {
    this.fx.eventMode = 'none';
    this.fx.addChild(this.wash);
  }

  update(state: GameState, t: number, rectOf: (buildingId: string) => RoomRect | null): void {
    const now = state.stats.totalPlayTime;
    const g = this.wash;
    g.clear();
    for (const dz of state.danger?.disasters ?? []) {
      const left = Math.max(0, dz.deadline - now);
      const urgency = 1 - left / Math.max(1, dz.deadline - dz.startedAt);
      if (dz.kind === 'epidemic') {
        // A green sickly mist in every dormitory.
        for (const b of state.buildings) {
          if (b.type !== 'quarters' || b.isConstructing) continue;
          const r = rectOf(b.id);
          if (!r) continue;
          const H = r.h ?? ROOM_H;
          g.rect(r.x, r.y, r.w, H).fill({ color: 0x6fd35a, alpha: 0.07 + 0.08 * urgency + 0.03 * Math.sin(t * 2 + r.x) });
        }
        continue;
      }
      const r = dz.buildingId ? rectOf(dz.buildingId) : null;
      if (!r) continue;
      const H = r.h ?? ROOM_H;
      if (dz.kind === 'collapse') {
        g.rect(r.x, r.y, r.w, H).fill({ color: 0x8a6a45, alpha: 0.10 + 0.14 * urgency });
        // Cracks along the ceiling and grit falling.
        const rnd = seeded(hashString(dz.id));
        for (let i = 0; i < 4; i++) {
          const cx = r.x + 8 + rnd() * (r.w - 16);
          g.moveTo(cx, r.y).lineTo(cx + 5 * (rnd() - 0.5), r.y + 8).lineTo(cx + 9 * (rnd() - 0.5), r.y + 15).stroke({ color: 0x1a120a, width: 1, alpha: 0.35 + 0.4 * urgency });
        }
        for (let i = 0; i < 9; i++) {
          const k = (t * (0.6 + 0.4 * rnd()) + rnd() * 3) % 1;
          g.rect(r.x + rnd() * r.w, r.y + k * H, 1.4, 1.4).fill({ color: 0xcdb08a, alpha: 0.7 * (1 - k) });
        }
      } else if (dz.kind === 'deepFlood') {
        // Water creeping up the room as the deadline closes in.
        const level = H * (0.1 + 0.55 * urgency);
        g.rect(r.x, r.y + H - level, r.w, level).fill({ color: 0x2f7fc4, alpha: 0.28 });
        g.rect(r.x, r.y + H - level - 1.5 + Math.sin(t * 3) * 1.2, r.w, 2).fill({ color: 0xbfe6ff, alpha: 0.5 });
      } else {
        // Reactor meltdown: a red pulse that quickens as it nears.
        const pulse = 0.5 + 0.5 * Math.sin(t * (3 + 9 * urgency));
        g.rect(r.x, r.y, r.w, H).fill({ color: 0xff3a1a, alpha: 0.08 + 0.2 * pulse * (0.4 + urgency) });
      }
    }
    // Rust and cracks on rooms worn past half way (cached per room and 10% wear step).
    const seen = new Set<string>();
    for (const b of state.buildings) {
      const wear = b.wear ?? 0;
      if (wear < 50 || b.isConstructing) continue;
      const r = rectOf(b.id);
      if (!r) continue;
      seen.add(b.id);
      const key = `${Math.floor(wear / 10)}:${Math.round(r.x)}:${Math.round(r.y)}:${Math.round(r.w)}`;
      const have = this.rust.get(b.id);
      if (have?.key === key) continue;
      have?.g.destroy();
      const rg = new Graphics();
      const H = r.h ?? ROOM_H;
      const rnd = seeded(hashString(`rust:${b.id}`));
      const k = (wear - 40) / 60;
      for (let i = 0; i < 3 + Math.round(k * 7); i++) {
        const sx = r.x + 4 + rnd() * (r.w - 8);
        const len = 6 + rnd() * H * 0.5 * k;
        rg.rect(sx, r.y + H - len - 4, 1.6 + rnd() * 2, len).fill({ color: 0x8a4a22, alpha: 0.16 + 0.18 * k });
      }
      for (let i = 0; i < 2 + Math.round(k * 3); i++) {
        const sx = r.x + 6 + rnd() * (r.w - 12);
        const sy = r.y + 6 + rnd() * (H - 14);
        rg.moveTo(sx, sy).lineTo(sx + 5 + rnd() * 6, sy + 4 + rnd() * 5).lineTo(sx + 2 + rnd() * 8, sy + 10 + rnd() * 6).stroke({ color: 0x120c08, width: 0.8, alpha: 0.3 + 0.2 * k });
      }
      this.fx.addChildAt(rg, 0);
      this.rust.set(b.id, { key, g: rg });
    }
    for (const [id, v] of this.rust) {
      if (seen.has(id)) continue;
      v.g.destroy();
      this.rust.delete(id);
    }
  }
}

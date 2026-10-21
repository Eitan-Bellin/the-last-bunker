// v2 room life: animated layers over the static room paintings (lamp flicker, fire, embers, steam, LEDs, fans, conveyors,
// sparks). Coordinates are fractions of the painting (0..1). Machines run with the room's activity: idle rooms go quiet.
import { Container, Graphics, Sprite, Texture } from 'pixi.js';

export interface Light { x: number; y: number; r: number; color: number; flicker: number }

let dotTex: Texture | null = null;
/** Soft round dot (white, alpha falloff), shared by every particle and glow. */
export function softDot(): Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTex = Texture.from(c);
  return dotTex;
}

interface P { s: Sprite; vx: number; vy: number; life: number; max: number; grow: number; a: number; drag: number; g: number }

/** A small pooled particle layer. */
export class Particles {
  readonly layer = new Container();
  private live: P[] = [];
  private pool: Sprite[] = [];
  constructor(add = true) { if (add) this.layer.blendMode = 'add'; }

  spawn(o: { x: number; y: number; vx?: number; vy?: number; life: number; size: number; color: number; alpha?: number; grow?: number; drag?: number; g?: number }): void {
    if (this.live.length > 260) return;
    const s = this.pool.pop() ?? new Sprite(softDot());
    s.anchor.set(0.5);
    s.position.set(o.x, o.y);
    s.tint = o.color;
    s.width = s.height = o.size;
    s.alpha = o.alpha ?? 1;
    s.visible = true;
    this.layer.addChild(s);
    this.live.push({ s, vx: o.vx ?? 0, vy: o.vy ?? 0, life: o.life, max: o.life, grow: o.grow ?? 0, a: o.alpha ?? 1, drag: o.drag ?? 0, g: o.g ?? 0 });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        this.layer.removeChild(p.s);
        this.pool.push(p.s);
        this.live.splice(i, 1);
        continue;
      }
      p.vy += p.g * dt;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      if (p.grow) p.s.width = p.s.height = p.s.width + p.grow * dt;
      const f = p.life / p.max;
      p.s.alpha = p.a * Math.min(1, f * 3) * Math.min(1, (1 - f) * 8 + 0.2);
    }
  }
}

type Fx =
  | { k: 'glow'; x: number; y: number; r: number; color: number; base: number; amp: number; speed: number; active?: boolean }
  | { k: 'fire'; x: number; y: number; w: number }
  | { k: 'steam'; x: number; y: number; rate: number; active?: boolean }
  | { k: 'smoke'; x: number; y: number; rate: number }
  | { k: 'bubbles'; x: number; y: number; w: number; h: number; color: number }
  | { k: 'leds'; x: number; y: number; w: number; h: number; n: number }
  | { k: 'fan'; x: number; y: number; r: number }
  | { k: 'belt'; x0: number; y0: number; x1: number; y1: number; color: number; size: number; gap: number }
  | { k: 'sparks'; x: number; y: number; every: number }
  | { k: 'drip'; x: number; y: number; to: number; every: number; color: number }
  | { k: 'screen'; x: number; y: number; w: number; h: number; color: number }
  | { k: 'needle'; x: number; y: number; r: number }
  | { k: 'rollers'; x: number; y: number; w: number; h: number; n: number };

/** Recipes per painting key; tiers that are a different picture use only the generic lamp flicker. */
const RECIPES: Record<string, Fx[]> = {
  recycler: [
    { k: 'belt', x0: 0.03, y0: 0.6, x1: 0.4, y1: 0.3, color: 0xb8aea4, size: 0.032, gap: 0.06 },
    { k: 'belt', x0: 0.42, y0: 0.42, x1: 0.47, y1: 0.55, color: 0xa89e94, size: 0.026, gap: 0.09 },
    { k: 'rollers', x: 0.43, y: 0.52, w: 0.2, h: 0.17, n: 5 },
    { k: 'sparks', x: 0.52, y: 0.66, every: 0.5 },
    { k: 'steam', x: 0.52, y: 0.72, rate: 4, active: true },
    { k: 'glow', x: 0.6, y: 0.27, r: 0.06, color: 0xff5030, base: 0.15, amp: 0.4, speed: 3 },
  ],
  farm: [
    { k: 'glow', x: 0.24, y: 0.38, r: 0.12, color: 0xd060ff, base: 0.35, amp: 0.12, speed: 1.2 },
    { k: 'glow', x: 0.42, y: 0.38, r: 0.12, color: 0xd060ff, base: 0.35, amp: 0.12, speed: 1.4 },
    { k: 'glow', x: 0.58, y: 0.38, r: 0.12, color: 0xd060ff, base: 0.35, amp: 0.12, speed: 1.1 },
    { k: 'glow', x: 0.76, y: 0.38, r: 0.12, color: 0xd060ff, base: 0.35, amp: 0.12, speed: 1.3 },
    { k: 'drip', x: 0.88, y: 0.4, to: 0.75, every: 0.9, color: 0x9fd8ff },
  ],
  hydroponics: [
    { k: 'bubbles', x: 0.05, y: 0.66, w: 0.08, h: 0.16, color: 0xbfe8ff },
    { k: 'drip', x: 0.21, y: 0.46, to: 0.62, every: 0.6, color: 0x9fd8ff },
    { k: 'drip', x: 0.5, y: 0.54, to: 0.66, every: 0.8, color: 0x9fd8ff },
    { k: 'drip', x: 0.75, y: 0.36, to: 0.48, every: 1.1, color: 0x9fd8ff },
    { k: 'glow', x: 0.45, y: 0.25, r: 0.25, color: 0xe8f4ff, base: 0.18, amp: 0.05, speed: 2 },
  ],
  seedLab: [
    { k: 'glow', x: 0.11, y: 0.55, r: 0.14, color: 0x50e0ff, base: 0.3, amp: 0.1, speed: 0.8 },
    { k: 'glow', x: 0.28, y: 0.55, r: 0.14, color: 0x50e0ff, base: 0.3, amp: 0.1, speed: 0.9 },
    { k: 'screen', x: 0.42, y: 0.55, w: 0.11, h: 0.1, color: 0x60ffd0 },
    { k: 'bubbles', x: 0.85, y: 0.62, w: 0.08, h: 0.2, color: 0x80ffe0 },
    { k: 'leds', x: 0.92, y: 0.36, w: 0.06, h: 0.08, n: 6 },
  ],
  componentsPlant: [
    { k: 'sparks', x: 0.09, y: 0.58, every: 0.35 },
    { k: 'glow', x: 0.09, y: 0.58, r: 0.07, color: 0xffd070, base: 0.2, amp: 0.6, speed: 9, active: true },
    { k: 'sparks', x: 0.34, y: 0.58, every: 0.6 },
    { k: 'belt', x0: 0.12, y0: 0.645, x1: 0.78, y1: 0.645, color: 0xb0a080, size: 0.03, gap: 0.08 },
    { k: 'steam', x: 0.72, y: 0.5, rate: 2, active: true },
  ],
  alloyFoundry: [
    { k: 'fire', x: 0.21, y: 0.6, w: 0.14 },
    { k: 'fire', x: 0.82, y: 0.6, w: 0.14 },
    { k: 'glow', x: 0.5, y: 0.43, r: 0.08, color: 0xff8a20, base: 0.45, amp: 0.25, speed: 2.4 },
    { k: 'smoke', x: 0.25, y: 0.12, rate: 3 },
    { k: 'smoke', x: 0.78, y: 0.12, rate: 3 },
    { k: 'sparks', x: 0.5, y: 0.5, every: 0.8 },
  ],
  dataCenter: [
    { k: 'leds', x: 0.03, y: 0.33, w: 0.3, h: 0.45, n: 60 },
    { k: 'leds', x: 0.7, y: 0.33, w: 0.27, h: 0.45, n: 55 },
    { k: 'screen', x: 0.43, y: 0.54, w: 0.09, h: 0.07, color: 0x50e8ff },
    { k: 'screen', x: 0.53, y: 0.54, w: 0.09, h: 0.07, color: 0x50e8ff },
    { k: 'fan', x: 0.555, y: 0.15, r: 0.045 },
    { k: 'steam', x: 0.55, y: 0.3, rate: 3 },
  ],
  reactor: [
    { k: 'glow', x: 0.5, y: 0.47, r: 0.12, color: 0x90ff40, base: 0.45, amp: 0.3, speed: 1.6 },
    { k: 'steam', x: 0.31, y: 0.56, rate: 3, active: true },
    { k: 'steam', x: 0.67, y: 0.56, rate: 3, active: true },
    { k: 'needle', x: 0.87, y: 0.52, r: 0.02 },
    { k: 'needle', x: 0.91, y: 0.52, r: 0.02 },
    { k: 'leds', x: 0.82, y: 0.6, w: 0.11, h: 0.05, n: 10 },
  ],
};
/** Tiers whose picture is a different layout (only the generic layer applies). */
const OTHER_LAYOUT = new Set(['farm-0', 'farm-2', 'hydroponics-0', 'hydroponics-2', 'reactor-2']);

/** Animated layer for one room painting of size w x h (world units), its top-left at (0, 0). */
export class RoomFx {
  readonly root = new Container();
  private add = new Container();
  private parts = new Particles();
  private smokeParts = new Particles(false);
  private glows: { s: Sprite; base: number; amp: number; speed: number; flicker: number; active: boolean; ph: number }[] = [];
  private fxs: Fx[] = [];
  private leds: { g: Graphics; fx: Extract<Fx, { k: 'leds' }>; pts: [number, number, number][] }[] = [];
  private fans: { g: Graphics; fx: Extract<Fx, { k: 'fan' }> }[] = [];
  private screens: { s: Sprite; fx: Extract<Fx, { k: 'screen' }> }[] = [];
  private needles: { g: Graphics; ph: number }[] = [];
  private rollers: { g: Graphics; fx: Extract<Fx, { k: 'rollers' }>; off: number }[] = [];
  private belts: { items: Graphics; fx: Extract<Fx, { k: 'belt' }>; off: number }[] = [];
  private timers = new Map<Fx, number>();
  private t = Math.random() * 10;
  private w: number;
  private h: number;

  constructor(art: string, tier: number, lights: Light[], w: number, h: number) {
    this.w = w;
    this.h = h;
    this.add.blendMode = 'add';
    this.root.addChild(this.smokeParts.layer, this.add, this.parts.layer);
    for (const l of lights) this.glow(l.x, l.y, l.r * 1.6, l.color, 0.22, 0.1, 0, l.flicker, false);
    if (OTHER_LAYOUT.has(`${art}-${tier}`)) return;
    this.fxs = RECIPES[art] ?? [];
    for (const fx of this.fxs) this.build(fx);
  }

  private glow(x: number, y: number, r: number, color: number, base: number, amp: number, speed: number, flicker: number, active: boolean): void {
    const s = new Sprite(softDot());
    s.anchor.set(0.5);
    s.position.set(x * this.w, y * this.h);
    s.width = s.height = r * 2 * this.w;
    s.tint = color;
    this.add.addChild(s);
    this.glows.push({ s, base, amp, speed, flicker, active, ph: Math.random() * 6 });
  }

  private build(fx: Fx): void {
    const W = this.w, H = this.h;
    switch (fx.k) {
      case 'glow': this.glow(fx.x, fx.y, fx.r, fx.color, fx.base, fx.amp, fx.speed, 0, !!fx.active); break;
      case 'fire': this.glow(fx.x, fx.y, fx.w * 0.9, 0xff7020, 0.5, 0.25, 7, 0.4, false); break;
      case 'leds': {
        const g = new Graphics();
        const pts: [number, number, number][] = [];
        for (let i = 0; i < fx.n; i++) pts.push([(fx.x + Math.random() * fx.w) * W, (fx.y + Math.random() * fx.h) * H, Math.random()]);
        this.add.addChild(g);
        this.leds.push({ g, fx, pts });
        break;
      }
      case 'fan': {
        const g = new Graphics();
        g.position.set(fx.x * W, fx.y * H);
        const r = fx.r * W;
        for (let b = 0; b < 4; b++) {
          const a = (b * Math.PI) / 2;
          g.moveTo(0, 0).lineTo(Math.cos(a - 0.35) * r, Math.sin(a - 0.35) * r).lineTo(Math.cos(a + 0.2) * r, Math.sin(a + 0.2) * r).closePath();
        }
        g.fill({ color: 0x1a2228, alpha: 0.75 });
        g.circle(0, 0, r * 0.18).fill(0x40505a);
        this.root.addChildAt(g, 0);
        this.fans.push({ g, fx });
        break;
      }
      case 'screen': {
        const s = new Sprite(Texture.WHITE);
        s.position.set(fx.x * W, fx.y * H);
        s.width = fx.w * W;
        s.height = fx.h * H;
        s.tint = fx.color;
        s.alpha = 0.15;
        this.add.addChild(s);
        this.screens.push({ s, fx });
        break;
      }
      case 'needle': {
        const g = new Graphics().moveTo(0, 0).lineTo(0, -fx.r * W).stroke({ width: 2, color: 0xff3020 });
        g.position.set(fx.x * W, fx.y * H);
        this.root.addChild(g);
        this.needles.push({ g, ph: Math.random() * 6 });
        break;
      }
      case 'rollers': {
        const g = new Graphics();
        const m = new Graphics().rect(fx.x * W, fx.y * H, fx.w * W, fx.h * H).fill(0xffffff);
        g.mask = m;
        this.root.addChild(g, m);
        this.rollers.push({ g, fx, off: 0 });
        break;
      }
      case 'belt': {
        const items = new Graphics();
        this.root.addChild(items);
        this.belts.push({ items, fx, off: 0 });
        break;
      }
      default: break;
    }
  }

  private every(fx: Fx, period: number, dt: number): number {
    let t = (this.timers.get(fx) ?? Math.random() * period) - dt;
    let n = 0;
    while (t <= 0) { t += period; n++; }
    this.timers.set(fx, t);
    return n;
  }

  /** activity 0..1: share of the crew working right now (machines and sparks follow it). */
  update(dt: number, activity: number): void {
    this.t += dt;
    const t = this.t;
    const W = this.w, H = this.h;
    const run = 0.15 + 0.85 * activity;
    for (const g of this.glows) {
      const fl = g.flicker ? (Math.random() < g.flicker * 0.05 ? -0.12 : 0) : 0;
      const wave = g.speed ? Math.sin(t * g.speed + g.ph) * g.amp : 0;
      const busy = g.active ? (activity > 0 ? Math.max(0, Math.sin(t * g.speed * 1.3 + g.ph)) * g.amp * 1.6 : 0) : wave;
      g.s.alpha = Math.max(0, g.base + busy + fl);
    }
    for (const fx of this.fxs) {
      switch (fx.k) {
        case 'fire': {
          const n = this.every(fx, 0.06, dt);
          for (let i = 0; i < n; i++) {
            this.parts.spawn({ x: (fx.x + (Math.random() - 0.5) * fx.w * 0.8) * W, y: fx.y * H + 8, vy: -30 - Math.random() * 40, vx: (Math.random() - 0.5) * 10, life: 0.6, size: 14 + Math.random() * 10, color: Math.random() < 0.5 ? 0xff6010 : 0xffb030, alpha: 0.7, grow: -12 });
            if (Math.random() < 0.25 * run) this.parts.spawn({ x: fx.x * W, y: fx.y * H, vy: -60 - Math.random() * 60, vx: (Math.random() - 0.5) * 40, life: 1.4, size: 4, color: 0xffa040, g: 20 });
          }
          break;
        }
        case 'steam': {
          const rate = fx.rate * (fx.active ? activity : 1);
          const n = rate > 0 ? this.every(fx, 1 / rate, dt) : 0;
          for (let i = 0; i < n; i++) this.smokeParts.spawn({ x: fx.x * W + (Math.random() - 0.5) * 8, y: fx.y * H, vy: -20 - Math.random() * 14, vx: (Math.random() - 0.5) * 12, life: 2.2, size: 16, color: 0xd8d8d0, alpha: 0.22, grow: 22, drag: 0.4 });
          break;
        }
        case 'smoke': {
          const n = this.every(fx, 1 / fx.rate, dt);
          for (let i = 0; i < n; i++) this.smokeParts.spawn({ x: fx.x * W + (Math.random() - 0.5) * 10, y: fx.y * H, vy: -14 - Math.random() * 10, vx: (Math.random() - 0.5) * 8, life: 2.6, size: 18, color: 0x4a4440, alpha: 0.35, grow: 18 });
          break;
        }
        case 'bubbles': {
          const n = this.every(fx, 0.25, dt);
          for (let i = 0; i < n; i++) this.parts.spawn({ x: (fx.x + Math.random() * fx.w) * W, y: (fx.y + fx.h) * H, vy: -(fx.h * H) / 1.6, vx: (Math.random() - 0.5) * 4, life: 1.6, size: 4 + Math.random() * 3, color: fx.color, alpha: 0.7 });
          break;
        }
        case 'sparks': {
          if (activity <= 0) break;
          const n = this.every(fx, fx.every / activity, dt);
          for (let i = 0; i < n; i++) {
            for (let j = 0; j < 7; j++) {
              const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
              const v = 60 + Math.random() * 110;
              this.parts.spawn({ x: fx.x * W, y: fx.y * H, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.3, size: 4, color: 0xffd060, g: 260 });
            }
            this.parts.spawn({ x: fx.x * W, y: fx.y * H, life: 0.18, size: 60, color: 0xffc060, alpha: 0.6 });
          }
          break;
        }
        case 'drip': {
          const n = this.every(fx, fx.every, dt);
          for (let i = 0; i < n; i++) this.parts.spawn({ x: fx.x * W, y: fx.y * H, vy: 20, g: 500, life: Math.sqrt((2 * (fx.to - fx.y) * H) / 500), size: 5, color: fx.color, alpha: 0.8 });
          break;
        }
        default: break;
      }
    }
    for (const l of this.leds) {
      l.g.clear();
      for (const p of l.pts) {
        const on = Math.sin(t * (2 + p[2] * 9) + p[2] * 50) > (activity > 0 ? -0.2 : 0.4);
        if (!on) continue;
        l.g.circle(p[0], p[1], 1.6).fill({ color: p[2] < 0.15 ? 0xff4030 : p[2] < 0.3 ? 0xffc040 : 0x40ff70, alpha: 0.9 });
      }
    }
    for (const f of this.fans) f.g.rotation += dt * (2 + 14 * activity);
    for (const s of this.screens) s.s.alpha = 0.12 + 0.1 * Math.sin(t * 13) * Math.sin(t * 3.1) + (Math.random() < 0.03 ? 0.15 : 0) + 0.1 * activity;
    for (const n of this.needles) n.g.rotation = -0.6 + 0.5 * activity + Math.sin(t * 5 + n.ph) * 0.08 * (0.3 + activity);
    for (const r of this.rollers) {
      const fx = r.fx;
      const x0 = fx.x * W, y0 = fx.y * H, w = fx.w * W, h = fx.h * H;
      const pitch = h / 3;
      r.off = (r.off + dt * 70 * activity) % pitch;
      r.g.clear();
      for (let c = 0; c < fx.n; c++) {
        const cx = x0 + (c + 0.5) * (w / fx.n);
        const off = (r.off + c * pitch * 0.37) % pitch;
        for (let y = y0 - pitch + off; y < y0 + h; y += pitch) {
          // a tooth catching the light, then its shadow: reads as a turning blade
          r.g.rect(cx - w / fx.n * 0.4, y, (w / fx.n) * 0.8, pitch * 0.18).fill({ color: 0xe8e4dc, alpha: 0.28 });
          r.g.rect(cx - w / fx.n * 0.4, y + pitch * 0.18, (w / fx.n) * 0.8, pitch * 0.3).fill({ color: 0x000000, alpha: 0.3 });
        }
      }
    }
    for (const b of this.belts) {
      const fx = b.fx;
      const len = Math.hypot((fx.x1 - fx.x0) * W, (fx.y1 - fx.y0) * H);
      b.off = (b.off + dt * 55 * activity) % (fx.gap * W);
      b.items.clear();
      const sz = fx.size * W;
      for (let d = b.off; d < len; d += fx.gap * W) {
        const k = d / len;
        const x = (fx.x0 + (fx.x1 - fx.x0) * k) * W;
        const y = (fx.y0 + (fx.y1 - fx.y0) * k) * H;
        // an irregular lump that tumbles a little as it rides
        const seed = Math.floor((d - b.off) / (fx.gap * W)) * 7.31;
        const rot = k * 6 + seed;
        const pts: number[] = [];
        for (let v = 0; v < 6; v++) {
          const a = rot + (v * Math.PI) / 3;
          const rr = sz * (0.32 + 0.22 * Math.abs(Math.sin(seed + v * 1.7)));
          pts.push(x + Math.cos(a) * rr, y - sz * 0.45 + Math.sin(a) * rr * 0.8);
        }
        const shade = [0x6e665c, 0x7d6a52, 0x5c6268, 0x8a7a64][Math.abs(Math.floor(seed)) % 4];
        b.items.poly(pts).fill({ color: shade, alpha: 0.95 }).stroke({ width: 1.2, color: 0x1a1612, alpha: 0.8 });
      }
    }
    this.parts.update(dt);
    this.smokeParts.update(dt);
  }
}

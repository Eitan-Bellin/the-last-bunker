import { Container, TextStyle } from 'pixi.js';
import { richLine } from '../../rendering/richText';
import { popupScale } from '../../rendering/LabelScale'; // [plan4:ST-12]

interface PopupInstance {
  line: Container;
  /** Pool key of the line (value|color). */
  lineKey: string;
  /** Merge key: same spot and colour. */
  spot: string;
  value: string;
  /** Unrounded running total of a merged "+N" popup (the display rounds). */
  sum: number;
  color: number;
  x0: number;
  y0: number;
  drift: number;
  /** Seconds since spawn (or since the last merge, which restarts the read time). */
  age: number;
  /** Seconds since the last merge bump (scale kick), or a large number. */
  bump: number;
  /** >0 while being retired early (cap reached, or an incident in the room). */
  kill: number;
}

const STYLE_CACHE = new Map<number, TextStyle>();

function styleFor(color: number): TextStyle {
  let s = STYLE_CACHE.get(color);
  if (!s) {
    s = new TextStyle({
      fontFamily: 'Rubik, sans-serif',
      fontSize: 14,
      fontWeight: 'bold',
      fill: color,
      stroke: { color: 0x000000, width: 3, join: 'round' },
      dropShadow: { color: 0x000000, blur: 3, distance: 1, alpha: 0.6 },
    });
    STYLE_CACHE.set(color, s);
  }
  return s;
}

/** Seconds a popup lives, how far it rises (world units), how many may be on screen. */
const LIFE = 1.5;
const RISE = 40;
const MAX_ON_SCREEN = 12;
/** Lines kept for reuse: production waves repeat the same "+6.5 [food]" every few seconds (no new text textures). */
const POOL_MAX = 48;
const NUM = /^\+(\d+(?:\.\d+)?)(.*)$/;

/** [camera] World points where popups must not appear (rooms with an active incident); set by the renderer. */
let blockedAt: ((x: number, y: number) => boolean) | null = null;
export function setPopupBlocker(fn: ((x: number, y: number) => boolean) | null): void {
  blockedAt = fn;
}

const easeOutCubic = (k: number) => 1 - (1 - k) * (1 - k) * (1 - k);

/**
 * Floating "+5 [food]" style feedback in world space; text may contain [[icon]] tokens.
 * Time-based (independent of frame rate), merged per spot (a second "+N" on the same room adds up and bumps
 * instead of stacking), capped, kept out of rooms in crisis, and backed by a pool of rendered lines.
 */
export class NumberPopupManager {
  private parent: Container;
  /** [plan4:ST-12] Extra scale that keeps the numbers readable when the camera is zoomed out (set by the renderer). */
  zoom = 1;
  private active: PopupInstance[] = [];
  private pool = new Map<string, Container[]>();
  private pooled = 0;
  private last = performance.now();

  constructor(parent: Container) {
    this.parent = parent;
  }

  spawn(x: number, y: number, value: string, color: number = 0x44ff44): void {
    if (blockedAt?.(x, y)) return;
    const spot = `${Math.round(x)}|${Math.round(y)}|${color}`;
    // Merge into a popup still being read at the same spot: "+6 [food]" + "+6 [food]" -> "+12 [food]".
    for (const p of this.active) {
      if (p.spot !== spot || p.kill > 0 || p.age > LIFE * 0.7) continue;
      const merged = mergeValues(p, value);
      if (merged === null) continue;
      if (merged !== p.value) this.setLine(p, merged);
      p.age = Math.min(p.age, 0.25);
      p.bump = 0;
      return;
    }
    // Keep clear of other fresh popups nearby: step upwards instead of piling on top of them.
    let y0 = y;
    for (let tries = 0; tries < 3; tries++) {
      let hit = false;
      for (const p of this.active) {
        const py = p.y0 - RISE * easeOutCubic(Math.min(1, p.age / LIFE));
        if (Math.abs(p.x0 - x) < 34 && Math.abs(py - y0) < 15) { hit = true; break; }
      }
      if (!hit) break;
      y0 -= 16;
    }
    const p: PopupInstance = {
      line: this.take(value, color), lineKey: `${value}|${color}`, spot, value, color, sum: parseFloat(NUM.exec(value)?.[1] ?? '0'),
      x0: x, y0, drift: (Math.random() - 0.5) * 14, age: 0, bump: 9, kill: 0,
    };
    p.line.position.set(x, y0);
    p.line.scale.set(0.4);
    p.line.alpha = 1;
    this.parent.addChild(p.line);
    this.active.push(p);
    // Over the cap: the oldest leave early (quick fade) rather than piling up.
    let live = 0;
    for (const q of this.active) if (q.kill === 0) live++;
    for (let i = 0; live > MAX_ON_SCREEN && i < this.active.length; i++) {
      if (this.active[i].kill === 0) {
        this.active[i].kill = 0.001;
        live--;
      }
    }
  }

  /** [perf] Popups are on screen (the engine keeps a smoother picture while they animate). */
  get busy(): boolean {
    return this.active.length > 0;
  }

  /** [perf] Is any popup inside this world rectangle? (A popup nobody can see does not need a smooth picture.) */
  anyIn(x0: number, y0: number, x1: number, y1: number): boolean {
    for (const p of this.active) if (p.x0 > x0 && p.x0 < x1 && p.y0 > y0 && p.y0 < y1) return true;
    return false;
  }

  /** Steps all popups; `dt` in seconds is optional (measured from the clock when omitted). */
  update(dt?: number): void {
    const now = performance.now();
    const ps = popupScale(this.zoom);
    const step = Math.min(0.1, dt ?? (now - this.last) / 1000);
    this.last = now;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.age += step;
      p.bump += step;
      if (p.kill === 0 && blockedAt?.(p.x0, p.y0)) p.kill = 0.001;
      if (p.kill > 0) p.kill += step;
      const k = Math.min(1, p.age / LIFE);
      p.line.x = p.x0 + p.drift * k;
      p.line.y = p.y0 - RISE * easeOutCubic(k);
      // Pop in with a little overshoot, settle; a merge kicks the scale up once more.
      const t = p.age;
      let s = t < 0.12 ? 0.4 + 0.75 * easeOutCubic(t / 0.12) : t < 0.22 ? 1.15 - 0.15 * ((t - 0.12) / 0.1) : 1;
      if (p.bump < 0.2) s *= 1 + 0.28 * Math.sin((p.bump / 0.2) * Math.PI);
      p.line.scale.set(s * ps);
      let a = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
      if (p.kill > 0) a *= Math.max(0, 1 - p.kill / 0.18);
      p.line.alpha = a;
      if (k >= 1 || a <= 0) {
        this.give(p);
        this.active.splice(i, 1);
      }
    }
  }

  destroy(): void {
    for (const p of this.active) p.line.destroy({ children: true });
    this.active = [];
    for (const list of this.pool.values()) for (const c of list) c.destroy({ children: true });
    this.pool.clear();
    this.pooled = 0;
  }

  private setLine(p: PopupInstance, value: string): void {
    const { x, y } = p.line.position;
    const s = p.line.scale.x, a = p.line.alpha;
    this.give(p);
    p.value = value;
    p.lineKey = `${value}|${p.color}`;
    p.line = this.take(value, p.color);
    p.line.position.set(x, y);
    p.line.scale.set(s);
    p.line.alpha = a;
    this.parent.addChild(p.line);
  }

  private take(value: string, color: number): Container {
    const list = this.pool.get(`${value}|${color}`);
    const hit = list?.pop();
    if (hit) {
      this.pooled--;
      return hit;
    }
    return richLine(value, styleFor(color), 15);
  }

  private give(p: PopupInstance): void {
    p.line.removeFromParent();
    if (this.pooled >= POOL_MAX) {
      // Make room: drop the largest bucket's oldest line.
      let worst: Container[] | null = null;
      for (const l of this.pool.values()) if (!worst || l.length > worst.length) worst = l;
      const old = worst?.shift();
      if (old) {
        old.destroy({ children: true });
        this.pooled--;
      }
    }
    let list = this.pool.get(p.lineKey);
    if (!list) this.pool.set(p.lineKey, (list = []));
    list.push(p.line);
    this.pooled++;
  }
}

/** "+6.5 [x]" + "+6.5 [x]" -> "+13 [x]" (keeps the exact total in p.sum); identical non-numeric text merges as is; otherwise null. */
function mergeValues(p: PopupInstance, b: string): string | null {
  const a = p.value;
  const ma = NUM.exec(a), mb = NUM.exec(b);
  if (ma && mb) {
    if (ma[2] !== mb[2]) return null;
    p.sum += parseFloat(mb[1]);
    const ints = Number.isInteger(p.sum);
    return `+${ints || p.sum >= 10 ? Math.round(p.sum) : p.sum.toFixed(1)}${ma[2]}`;
  }
  return a === b ? a : null;
}

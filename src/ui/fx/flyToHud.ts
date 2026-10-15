/**
 * [ux-redesign W4] Fly-to-HUD: when goods arrive in one moment (a bubble, a restored room's finds, a stash, the day chest, a trip home)
 * a few small icons leave the place they came from, arc to the store's HUD tile, and the tile's icon pulses as they land.
 *
 *  - DOM layer over the canvas, pointer-events none (input is never blocked), pooled elements, one rAF loop that runs only while
 *    something flies, transform/opacity writes only.
 *  - At most MAX_ACTIVE particles at once (a burst over the cap is thinned, never queued).
 *  - Reduced motion: no flight, a single fade of the icon at the tile (still says "this store grew").
 *  - Durations and easing come from the motion tokens (src/ui/kit/tokens.ts mirrors tokens.css).
 */
import type { ResourceType } from '../../core/GameState';
import { reducedMotion } from '../../utils/a11y';
import { MS, resourceColor } from '../kit/tokens';
import { RESOURCE_ICONS, setRich } from '../dom';

/** One flight: two screen lengths of the --dur-screen token (600 ms). */
export const FLY_MS = MS['dur-screen'] * 2;
/** Between two particles of a burst (--stagger, 40 ms). */
const STAGGER_MS = MS.stagger;
/** Particles per burst, by size, and at most this many in the air at once. */
const MIN_PARTICLES = 5;
const MAX_PARTICLES = 12;
const MAX_ACTIVE = 40;
/** The reduced-motion fade at the tile (--dur-popup-in in, held, out). */
const FADE_MS = MS['dur-popup-in'] * 3;
/** [w4fix C2] Share of the way a particle's end point moves toward a tile that moved, per frame. */
const FOLLOW = 0.35;

export interface Point { x: number; y: number }

export interface FlyHost {
  /** The tile a resource flies to (null: nowhere to go, nothing flies). */
  target(r: ResourceType): DOMRect | null;
  /** The first particle of a burst landed (the tile pulses, the number may start counting). */
  land(r: ResourceType): void;
  /** A burst starts: the number may wait for the landing before it counts. */
  start?(r: ResourceType, landsInMs: number): void;
}

interface Particle {
  node: HTMLElement;
  r: ResourceType;
  from: Point;
  ctrl: Point;
  to: Point;
  t0: number;
  first: boolean;
  /** The reduced-motion fade (no path). */
  still: boolean;
  label: string;
  live: boolean;
}

/** easeOutCubic: the curve of the --ease-out token, cubic-bezier(.33, 1, .68, 1). */
function easeOut(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** How many particles a gain of `amount` gets (5..12, more for bigger gains). */
export function particlesFor(amount: number): number {
  if (!(amount > 0)) return MIN_PARTICLES;
  return Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, Math.round(MIN_PARTICLES + Math.log10(amount) * 2)));
}

export class FlyToHud {
  private layer: HTMLElement | null = null;
  private pool: HTMLElement[] = [];
  private parts: Particle[] = [];
  /** [w4fix] Particles waiting or in the air (the cap counts these, not the finished ones still in `parts`). */
  private liveCount = 0;
  private raf = 0;
  /** For the debug tool: bursts asked for, particles flown, particles dropped by the cap. */
  readonly stats = { bursts: 0, flown: 0, dropped: 0 };

  private host: FlyHost;

  constructor(host: FlyHost) {
    this.host = host;
  }

  private ensureLayer(): HTMLElement {
    if (!this.layer || !this.layer.isConnected) {
      this.layer = document.createElement('div');
      this.layer.className = 'fx-layer';
      this.layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(this.layer);
    }
    return this.layer;
  }

  private take(): HTMLElement {
    const n = this.pool.pop() ?? document.createElement('span');
    n.className = 'fx-fly';
    n.style.opacity = '0';
    // [w4fix] A pooled node may sit in an old layer that was removed from the page: move it into the live one.
    const layer = this.ensureLayer();
    if (n.parentElement !== layer) layer.appendChild(n);
    return n;
  }

  private give(p: Particle): void {
    p.live = false;
    this.liveCount--;
    p.node.style.opacity = '0';
    p.node.style.transform = '';
    p.node.className = 'fx-fly is-parked';
    this.pool.push(p.node);
  }

  /**
   * Goods of one store fly from `from` (screen px) to their tile. `amount` sets the number of particles; `label` ("+12") rides on the
   * first one. Returns the time (ms) until the first lands (0 when nothing flies).
   */
  fly(r: ResourceType, from: Point, amount = 0, label = ''): number {
    const rect = this.host.target(r);
    if (!rect) return 0;
    this.stats.bursts++;
    const to = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const now = performance.now();
    const icon = RESOURCE_ICONS[r] ?? '';
    const color = resourceColor(r);
    if (reducedMotion()) {
      this.spawn({ r, from: to, ctrl: to, to, t0: now, first: true, still: true, label }, icon, color);
      this.host.start?.(r, 0);
      return 1;
    }
    const want = particlesFor(amount);
    const room = Math.max(0, MAX_ACTIVE - this.liveCount);
    const n = Math.min(want, room);
    this.stats.dropped += want - n;
    if (n === 0) {
      // [w4fix C5] Nothing of this store flies (the cap): its tile pulses when its goods would have landed, with the others.
      this.host.start?.(r, FLY_MS);
      window.setTimeout(() => { if (!document.hidden) this.host.land(r); }, FLY_MS);
      return 0;
    }
    // The arc bows to one side of the straight line (alternating per particle), so the burst fans out and gathers at the tile.
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 0; i < n; i++) {
      const spread = (i % 2 ? 1 : -1) * (0.18 + ((i * 37) % 10) / 40) * len;
      const jitter = { x: ((i * 53) % 21) - 10, y: ((i * 29) % 21) - 10 };
      const start = { x: from.x + jitter.x, y: from.y + jitter.y };
      const ctrl = { x: (start.x + to.x) / 2 + nx * spread, y: Math.min(start.y, to.y) - len * 0.15 + ny * spread * 0.3 };
      this.spawn({ r, from: start, ctrl, to, t0: now + i * STAGGER_MS, first: i === 0, still: false, label: i === 0 ? label : '' }, icon, color);
    }
    this.host.start?.(r, FLY_MS);
    return FLY_MS;
  }

  private spawn(p: Omit<Particle, 'node' | 'live'>, icon: string, color: string): void {
    const node = this.take();
    setRich(node, p.label ? `${icon} ${p.label}` : icon);
    node.classList.toggle('has-label', !!p.label);
    node.style.color = color;
    const part: Particle = { ...p, node, live: true };
    this.place(part, 0);
    this.parts.push(part);
    this.liveCount++;
    this.stats.flown++;
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private place(p: Particle, k: number): void {
    if (p.still) {
      // In 1/3, hold 1/3, out 1/3: opacity only.
      const o = k < 1 / 3 ? k * 3 : k < 2 / 3 ? 1 : (1 - k) * 3;
      p.node.style.transform = `translate3d(${p.to.x}px, ${p.to.y}px, 0) translate(-50%, -50%)`;
      p.node.style.opacity = String(o);
      return;
    }
    const t = easeOut(k);
    const u = 1 - t;
    const x = u * u * p.from.x + 2 * u * t * p.ctrl.x + t * t * p.to.x;
    const y = u * u * p.from.y + 2 * u * t * p.ctrl.y + t * t * p.to.y;
    const s = 1 - 0.35 * t;
    p.node.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${s})`;
    p.node.style.opacity = k <= 0 ? '0' : k > 0.85 ? String((1 - k) / 0.15) : '1';
  }

  private readonly tick = (): void => {
    this.raf = 0;
    const now = performance.now();
    let alive = 0;
    // [w4fix C2] Tiles reorder (a store fills up) and the screen turns: in the second half of a flight the end point follows the tile's
    // rect now, read once per store per frame, and eases toward it so a particle never jumps.
    const fresh = new Map<ResourceType, Point | null>();
    for (const p of this.parts) {
      if (!p.live) continue;
      const dur = p.still ? FADE_MS : FLY_MS;
      const k = (now - p.t0) / dur;
      if (k < 0) { alive++; continue; }
      if (k >= 1) {
        // A tab that was in the background comes back long after the landing: no late pulse or buzz, the goods are simply there.
        if (p.first && now - p.t0 <= 2 * dur) this.host.land(p.r);
        this.give(p);
        continue;
      }
      if (!p.still && k > 0.5) {
        if (!fresh.has(p.r)) {
          const rect = this.host.target(p.r);
          fresh.set(p.r, rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null);
        }
        const to = fresh.get(p.r);
        if (to) {
          p.to = Math.abs(to.x - p.to.x) + Math.abs(to.y - p.to.y) < 1 ? to : { x: p.to.x + (to.x - p.to.x) * FOLLOW, y: p.to.y + (to.y - p.to.y) * FOLLOW };
        }
      }
      this.place(p, k);
      alive++;
    }
    if (alive) {
      // Compact the list now and then (finished particles are parked in the pool already).
      if (this.parts.length > alive * 2 + 8) this.parts = this.parts.filter(p => p.live);
      this.raf = requestAnimationFrame(this.tick);
    } else {
      this.parts.length = 0;
      this.liveCount = 0;
    }
  };

  /** Particles in the air right now (debug / perf check). */
  get active(): number {
    return this.liveCount;
  }
}

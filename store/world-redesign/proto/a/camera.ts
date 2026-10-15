/** Pan (drag + fling), zoom (wheel around cursor, pinch around fingers), tap detection, and parallax transforms. */
import type { Container } from 'pixi.js';
import { T } from './tokens';
import { clamp } from './util';

export class Camera {
  x: number = T.camera.start.x;
  y: number = T.camera.start.y;
  zoom = 1;
  targetZoom = 1;
  private anchor: { sx: number; sy: number; wx: number; wy: number } | null = null;
  private vx = 0; private vy = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; t: number; moved: boolean } | null = null;
  private last: { x: number; y: number; t: number }[] = [];
  private pinch: { d: number; zoom: number; wx: number; wy: number } | null = null;
  sw = 1; sh = 1;
  onTap: (wx: number, wy: number) => void = () => {};

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.pd);
    addEventListener('pointermove', this.pm);
    addEventListener('pointerup', this.pu);
    addEventListener('pointercancel', this.pu);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.style.touchAction = 'none';
  }

  resize(w: number, h: number, phone: boolean) {
    const first = this.sw === 1;
    this.sw = w; this.sh = h;
    if (first) {
      this.zoom = this.targetZoom = clamp(w / (phone ? T.camera.startViewW.phone : T.camera.startViewW.desktop), T.camera.zoomMin, T.camera.zoomMax);
    }
  }

  toWorld(sx: number, sy: number) {
    return { x: this.x + (sx - this.sw / 2) / this.zoom, y: this.y + (sy - this.sh / 2) / this.zoom };
  }

  private pd = (e: PointerEvent) => {
    this.el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.vx = this.vy = 0;
    if (this.pointers.size === 1) {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      this.last = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const w = this.toWorld(mx, my);
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom, wx: w.x, wy: w.y };
      if (this.down) this.down.moved = true;
    }
  };

  private pm = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const z = clamp(this.pinch.zoom * (d / this.pinch.d), T.camera.zoomMin, T.camera.zoomMax);
      this.zoom = this.targetZoom = z;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.x = this.pinch.wx - (mx - this.sw / 2) / z;
      this.y = this.pinch.wy - (my - this.sh / 2) / z;
      return;
    }
    if (!this.down) return;
    if (!this.down.moved && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > T.camera.dragThreshold) this.down.moved = true;
    if (this.down.moved) {
      this.x -= dx / this.zoom; this.y -= dy / this.zoom;
      this.anchor = null;
      const now = performance.now();
      this.last.push({ x: e.clientX, y: e.clientY, t: now });
      while (this.last.length > 2 && now - this.last[0].t > 90) this.last.shift();
    }
  };

  private pu = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0 && this.down) {
      const dt = performance.now() - this.down.t;
      if (!this.down.moved && dt < T.camera.tapMs) {
        // a drop over DOM UI is not a tap on the world
        if (document.elementFromPoint(e.clientX, e.clientY) === this.el) {
          const w = this.toWorld(e.clientX, e.clientY);
          this.onTap(w.x, w.y);
        }
      } else if (this.down.moved && this.last.length >= 2) {
        const a = this.last[0], b = this.last[this.last.length - 1];
        const s = Math.max(1, b.t - a.t) / 1000;
        const m = T.camera.maxFling;
        this.vx = clamp(-(b.x - a.x) / s, -m, m) / this.zoom;
        this.vy = clamp(-(b.y - a.y) / s, -m, m) / this.zoom;
      }
      this.down = null;
    } else if (this.pointers.size === 1) {
      // continuing with one finger after a pinch
      const p = [...this.pointers.values()][0];
      this.down = { x: p.x, y: p.y, t: 0, moved: true };
    }
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const dz = Math.exp(-e.deltaY * T.camera.wheelStep);
    this.targetZoom = clamp(this.targetZoom * dz, T.camera.zoomMin, T.camera.zoomMax);
    const w = this.toWorld(e.clientX, e.clientY);
    this.anchor = { sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y };
  };

  update(dt: number) {
    if (Math.abs(this.targetZoom - this.zoom) > 1e-4) {
      this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dt * T.camera.zoomEase);
      if (this.anchor) {
        this.x = this.anchor.wx - (this.anchor.sx - this.sw / 2) / this.zoom;
        this.y = this.anchor.wy - (this.anchor.sy - this.sh / 2) / this.zoom;
      }
    } else this.anchor = null;
    if (!this.down) {
      this.x += this.vx * dt; this.y += this.vy * dt;
      const f = Math.exp(-T.camera.friction * dt);
      this.vx *= f; this.vy *= f;
    }
    // clamp to the world (+margin); centre if the view is larger than the world
    const m = T.camera.margin, W = T.world.width, H = T.world.height;
    const hw = this.sw / 2 / this.zoom, hh = this.sh / 2 / this.zoom;
    const top = -260;
    this.x = W + 2 * m < hw * 2 ? W / 2 : clamp(this.x, -m + hw, W + m - hw);
    this.y = H - top + m < hh * 2 ? (top + H) / 2 : clamp(this.y, top + hh, H + m - hh);
  }

  /** place a depth layer: parallax factor p moves (and zooms) it less than the play plane */
  apply(c: Container, p: number) {
    const s = Math.pow(this.zoom, p * T.layers.zoomCoupling);
    c.scale.set(s);
    c.x = this.sw / 2 - this.x * p * s;
    c.y = this.sh / 2 - this.y * p * s;
  }
}

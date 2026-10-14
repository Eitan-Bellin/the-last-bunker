import { T } from './tokens';

/**
 * Pan (drag, with fling), zoom (wheel around the cursor, pinch around the fingers' midpoint) and tap detection.
 * Camera state is the world-px point at the screen centre plus a zoom; every world-space layer copies it each frame.
 */
export class Camera {
  x = 0; y = 0; zoom = 1;
  private targetZoom = 1;
  private zoomAnchor: { sx: number; sy: number } | null = null;
  private vx = 0; vy = 0;
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private pinch: { d: number; zoom: number } | null = null;
  private dragging = false;
  private lastMove = { x: 0, y: 0, t: 0 };
  onTap: ((sx: number, sy: number) => void) | null = null;
  w = 1; h = 1;

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('pointercancel', e => this.up(e));
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * T.camera.wheelStep);
      this.zoomAt(e.offsetX, e.offsetY, this.targetZoom * f);
    }, { passive: false });
    el.style.touchAction = 'none';
  }

  set(x: number, y: number, zoom: number): void { this.x = x; this.y = y; this.zoom = this.targetZoom = zoom; }

  toWorld(px: number, py: number): { x: number; y: number } {
    return { x: this.x + (px - this.w / 2) / this.zoom, y: this.y + (py - this.h / 2) / this.zoom };
  }

  private zoomAt(px: number, py: number, z: number): void {
    this.targetZoom = Math.max(T.camera.minZoom, Math.min(T.camera.maxZoom, z));
    this.zoomAnchor = { sx: px, sy: py };
  }

  private down(e: PointerEvent): void {
    const r = this.el.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    this.pointers.set(e.pointerId, { x: px, y: py, sx: px, sy: py, t: performance.now() });
    this.vx = this.vy = 0;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
      this.dragging = true;
    }
    this.lastMove = { x: px, y: py, t: performance.now() };
  }

  private move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const r = this.el.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const dx = px - p.x, dy = py - p.y;
    p.x = px; p.y = py;
    if (!this.dragging && Math.hypot(px - p.sx, py - p.sy) > T.camera.dragThreshold) this.dragging = true;
    if (!this.dragging) return;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const before = this.toWorld(mx, my);
      this.zoom = this.targetZoom = Math.max(T.camera.minZoom, Math.min(T.camera.maxZoom, this.pinch.zoom * (d / this.pinch.d)));
      const after = this.toWorld(mx, my);
      this.x += before.x - after.x; this.y += before.y - after.y;
      this.x -= dx / 2 / this.zoom; this.y -= dy / 2 / this.zoom;
      return;
    }
    this.x -= dx / this.zoom; this.y -= dy / this.zoom;
    const now = performance.now();
    const dtm = Math.max(1, now - this.lastMove.t) / 1000;
    this.vx = 0.7 * this.vx + 0.3 * (-(px - this.lastMove.x) / this.zoom / dtm);
    this.vy = 0.7 * this.vy + 0.3 * (-(py - this.lastMove.y) / this.zoom / dtm);
    this.lastMove = { x: px, y: py, t: now };
  }

  private up(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (!this.dragging && this.pointers.size === 0 && this.onTap) this.onTap(p.x, p.y);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) {
      if (performance.now() - this.lastMove.t > 80) this.vx = this.vy = 0;
      const m = T.camera.maxFling / this.zoom, s = Math.hypot(this.vx, this.vy);
      if (s > m) { this.vx *= m / s; this.vy *= m / s; }
      this.dragging = false;
    }
  }

  update(dt: number, bounds: { x0: number; x1: number; y0: number; y1: number }): void {
    if (this.pointers.size === 0) {
      this.x += this.vx * dt; this.y += this.vy * dt;
      const f = Math.exp(-T.camera.friction * dt);
      this.vx *= f; this.vy *= f;
    }
    if (Math.abs(this.targetZoom - this.zoom) > 1e-4 && this.zoomAnchor) {
      const a = this.zoomAnchor;
      const before = this.toWorld(a.sx, a.sy);
      this.zoom += (this.targetZoom - this.zoom) * (1 - Math.exp(-T.camera.zoomEase * dt));
      const after = this.toWorld(a.sx, a.sy);
      this.x += before.x - after.x; this.y += before.y - after.y;
    }
    this.x = Math.max(bounds.x0, Math.min(bounds.x1, this.x));
    this.y = Math.max(bounds.y0, Math.min(bounds.y1, this.y));
  }
}

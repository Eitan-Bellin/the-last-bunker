import type { Application, Container } from 'pixi.js';
import { BUILDING_W, ROOM_H, SIDE_MARGIN, floorTop } from './layout';
import { reducedMotion } from '../utils/a11y';

// [plan4 X-1] Split out of BunkerRenderer.ts with no change in behaviour: everything about the camera (constants, pan / pinch / fling /
// double tap input, bounds, zoom springs, shake and punch) lives here. BunkerRenderer stays the public facade and builds this class
// with a small host that gives it the few things it needs from the scene.

export const DRAG_THRESHOLD = 6;
export const HUD_TOP = 150;
export const HUD_BOTTOM = 72;
export const VIEW_TOP = -140;
export const MAX_ZOOM = 3;
// [camera] Feel constants: glide friction (1/s), edge spring and focus spring (rad/s, critically damped),
// shake size at full trauma (screen px), double-tap window.
export const FRICTION = 4.2;
export const EDGE_SPRING = 13;
export const FOCUS_SPRING = 7.5;
export const ZOOM_SPRING = 14;
export const SHAKE_PX = 16;
export const DOUBLE_TAP_MS = 320;

/** What the camera needs to know about the scene it looks at (implemented by BunkerRenderer). */
export interface CameraHost {
  readonly app: Application;
  readonly worldContainer: Container;
  /** World y of the bottom of the deepest floor (plus a little). */
  contentBottom(): number;
  /** Right edge of everything built (rooms and project lots). */
  extentR(): number;
  /** World y of the top of the tallest project building on the surface. */
  projectTop(): number;
  /** Scene clock in seconds (drives the shake noise). */
  time(): number;
  selectedId(): string | null;
  /** World rectangle of a room. */
  roomRect(id: string): { x: number; y: number; w: number; h: number } | null;
  /** World rectangle of the room or ruin with this id (what a double tap frames). */
  targetRect(id: string): { x: number; y: number; w: number; h: number } | null;
  /** Which room or ruin is under a screen point. */
  targetAt(sx: number, sy: number): string | null;
  /** Pointer id of the survivor being carried by the player, or null. */
  carryPointer(): number | null;
  moveCarried(sx: number, sy: number): void;
  endCarry(sx: number, sy: number): void;
  /** Cancels the press-and-hold that would lift a survivor. */
  cancelPress(): void;
}

export class CameraController {
  camX = BUILDING_W / 2;
  camY = 0;
  baseZoom = 1;
  zoom = 1;
  isDragging = false;
  pointerDown = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private camStartX = 0;
  private camStartY = 0;
  // [camera] Camera physics (see the camera section after setup): velocities in world units/s, zoom in ln-space.
  private camVX = 0;
  private camVY = 0;
  private zoomV = 0;
  private focusTarget: { x: number; y: number; z: number } | null = null;
  private wheelZoom: number | null = null;
  private zoomAnchorX = 0;
  private zoomAnchorY = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d0: number; z0: number; wx: number; wy: number } | null = null;
  /** Last pointer positions (t, x, y) × 8 for the release velocity. */
  private samples = new Float64Array(24);
  private sampleN = 0;
  private downAt = 0;
  private lastTap = { t: 0, x: 0, y: 0 };
  private swallowClickUntil = 0;
  /** Screen px at the bottom covered by an open sheet; the camera may rest lower while it is open. */
  private bottomInset = 0;
  private framedId: string | null = null;
  private insetCheck = 0;
  private bnd = { x0: 0, x1: 0, y0: 0, y1: 0 };
  private trauma = 0;
  private traumaDecay = 1;
  private punchT = 9;
  private punchAmt = 0;
  private punchDX = 0;
  private punchDY = 0;
  /** [plan4:AC-2] Live: the in-game motion setting (auto follows the OS) now reaches shake and punch. */
  private get calm(): boolean { return reducedMotion(); }

  private readonly host: CameraHost;

  constructor(host: CameraHost) {
    this.host = host;
  }

  /**
   * [camera] Camera shake for big moments (a crisis breaking out, a new era, the drill): adds trauma; the shake is
   * trauma² × smooth noise, so it starts at about `amount` screen px and eases out over `seconds`.
   * Strong shakes (≥ 4) also land a downward kick and a zoom punch.
   */
  shake(amount: number, seconds: number): void {
    const t = Math.min(1, Math.sqrt(Math.max(0, amount) / SHAKE_PX));
    if (t >= this.trauma) {
      this.trauma = t;
      this.traumaDecay = t / Math.max(0.05, seconds);
    } else this.trauma = Math.min(1, this.trauma + t * 0.25);
    if (amount >= 4) this.punch(amount / 5, 0, 1);
  }

  /**
   * [camera] A short zoom punch (+3% × strength, ~120 ms, springs back) with an optional directional kick
   * (screen direction, ~6 px × strength). For build complete, collect, crisis start.
   */
  punch(strength = 1, dirX = 0, dirY = 0): void {
    const s = Math.min(2.5, strength) * (this.calm ? 0.4 : 1);
    // A punch already in flight keeps the stronger one.
    if (this.punchT < 0.12 && this.punchAmt >= 0.03 * s) return;
    this.punchT = 0;
    this.punchAmt = 0.03 * s;
    const len = Math.hypot(dirX, dirY) || 1;
    this.punchDX = (dirX / len) * 6 * s;
    this.punchDY = (dirY / len) * 6 * s;
  }

  fitToScreen(): void {
    const { width } = this.host.app.screen;
    const contentW = BUILDING_W + SIDE_MARGIN * 2;
    this.baseZoom = Math.max(0.35, Math.min(1.6, (width - 8) / contentW));
    this.zoom = this.baseZoom;
    this.camX = BUILDING_W / 2;
    const usable = this.host.app.screen.height - HUD_TOP - HUD_BOTTOM;
    this.camY = VIEW_TOP + usable / 2 / this.zoom;
    this.stopCamera();
    this.clampCamera();
    this.updateTransform();
  }

  // ───────────────────────────── [camera] input ─────────────────────────────
  // One finger drags 1:1 with a rubber band past the edges and glides on release; two fingers pinch around the
  // point between them (and pan); the wheel zooms around the cursor; a double tap frames a room. Everything is
  // stepped by time in stepCamera(), so it feels the same at 30, 60 and 120 Hz.

  setup(): void {
    const host = this.host;
    const canvas = host.app.canvas;
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      // A primary pointer starts a fresh gesture: forget any finger whose release we never saw.
      if (e.isPrimary) {
        this.pointers.clear();
        this.pinch = null;
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // A touch catches a gliding camera; that touch only stops it (no room tap).
      // (Not when this touch may be the second half of a double tap.)
      const pendingTap = performance.now() - this.lastTap.t < DOUBLE_TAP_MS;
      const moving = !pendingTap && (Math.hypot(this.camVX, this.camVY) * this.zoom > 140 || this.focusTarget !== null);
      this.stopCamera();
      if (this.pointers.size === 1) {
        this.isDragging = moving;
        this.downAt = e.timeStamp;
        this.beginPan(e.clientX, e.clientY, e.timeStamp);
      } else if (this.pointers.size === 2) this.beginPinch();
    });
    // Moves and releases are followed on the window, so a finger sliding over the HUD keeps dragging.
    window.addEventListener('pointermove', (e: PointerEvent) => {
      const carry = host.carryPointer();
      if (carry !== null) {
        if (e.pointerId !== carry) return;
        const r = canvas.getBoundingClientRect();
        host.moveCarried(e.clientX - r.left, e.clientY - r.top);
        return;
      }
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pinch) {
        this.movePinch();
        return;
      }
      if (!this.pointerDown) return;
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      this.pushSample(e.timeStamp, e.clientX, e.clientY);
      if (!this.isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) this.isDragging = true;
      if (!this.isDragging) return;
      this.camBounds(this.zoom);
      const b = this.bnd;
      this.camX = rubber(this.camStartX - dx / this.zoom, b.x0, b.x1, this.viewW());
      this.camY = rubber(this.camStartY - dy / this.zoom, b.y0, b.y1, this.viewH());
      this.updateTransform();
    });
    const end = (e: PointerEvent) => {
      const known = this.pointers.delete(e.pointerId);
      host.cancelPress();
      const carry = host.carryPointer();
      if (carry !== null && (e.pointerId === carry || !this.pointers.size)) {
        const r = canvas.getBoundingClientRect();
        host.endCarry(e.clientX - r.left, e.clientY - r.top);
      }
      if (!known) return;
      if (this.pinch) {
        if (this.pointers.size < 2) {
          this.pinch = null;
          // The finger left behind carries on as a one-finger drag from where the camera is.
          for (const p of this.pointers.values()) this.beginPan(p.x, p.y, e.timeStamp);
        }
        return;
      }
      if (this.pointers.size) return;
      if (this.pointerDown && this.isDragging) this.fling(e.timeStamp);
      else if (this.pointerDown && e.type === 'pointerup' && e.timeStamp - this.downAt < 300) this.tapAt(e.clientX, e.clientY, true);
      this.pointerDown = false;
      // Keep isDragging until PixiJS has dispatched pointertap for this release.
      setTimeout(() => { this.isDragging = false; }, 0);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', () => {
      this.pointers.clear();
      this.pinch = null;
      this.pointerDown = false;
      this.isDragging = false;
    });
    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const from = this.wheelZoom ?? this.zoom;
      this.focusTarget = null;
      this.camVX = this.camVY = 0;
      this.wheelZoom = this.clampZoom(from * Math.exp(-Math.max(-300, Math.min(300, dy)) * 0.0016));
      this.zoomAnchorX = e.clientX;
      this.zoomAnchorY = e.clientY;
    }, { passive: false });
    // A double tap can land on the backdrop of the sheet the first tap opened: frame the room, keep the sheet.
    const isBackdrop = (t: EventTarget | null) => t instanceof HTMLElement && t.classList.contains('sheet-overlay');
    let backdropDown = 0;
    window.addEventListener('pointerdown', (e) => { if (isBackdrop(e.target)) backdropDown = e.timeStamp; }, true);
    window.addEventListener('pointerup', (e) => {
      if (!isBackdrop(e.target) || e.timeStamp - backdropDown > 300) return;
      if (this.tapAt(e.clientX, e.clientY, false)) this.swallowClickUntil = performance.now() + 450;
    }, true);
    window.addEventListener('click', (e) => {
      if (performance.now() > this.swallowClickUntil || !isBackdrop(e.target)) return;
      this.swallowClickUntil = 0;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  private beginPan(x: number, y: number, t: number): void {
    this.pointerDown = true;
    this.dragStartX = x;
    this.dragStartY = y;
    // Start from the "unstretched" position, so grabbing the camera inside the rubber band does not jump.
    this.camBounds(this.zoom);
    const b = this.bnd;
    this.camStartX = unrubber(this.camX, b.x0, b.x1, this.viewW());
    this.camStartY = unrubber(this.camY, b.y0, b.y1, this.viewH());
    this.sampleN = 0;
    this.pushSample(t, x, y);
  }

  private beginPinch(): void {
    let i = 0, ax = 0, ay = 0, bx = 0, by = 0;
    for (const p of this.pointers.values()) {
      if (i === 0) { ax = p.x; ay = p.y; } else if (i === 1) { bx = p.x; by = p.y; }
      i++;
    }
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const { width } = this.host.app.screen;
    this.pinch = {
      d0: Math.max(24, Math.hypot(ax - bx, ay - by)), z0: this.zoom,
      wx: this.camX + (mx - width / 2) / this.zoom, wy: this.camY + (my - this.viewCY()) / this.zoom,
    };
    this.isDragging = true;
    this.pointerDown = true;
  }

  /** Pinch: the world point under the fingers stays under them while they spread and move. */
  private movePinch(): void {
    const p = this.pinch!;
    let i = 0, ax = 0, ay = 0, bx = 0, by = 0;
    for (const q of this.pointers.values()) {
      if (i === 0) { ax = q.x; ay = q.y; } else if (i === 1) { bx = q.x; by = q.y; }
      i++;
    }
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const z = this.softZoom(p.z0 * Math.hypot(ax - bx, ay - by) / p.d0);
    this.zoom = z;
    this.camBounds(z);
    const b = this.bnd;
    const { width } = this.host.app.screen;
    this.camX = rubber(p.wx - (mx - width / 2) / z, b.x0, b.x1, this.viewW());
    this.camY = rubber(p.wy - (my - this.viewCY()) / z, b.y0, b.y1, this.viewH());
    this.zoomAnchorX = mx;
    this.zoomAnchorY = my;
    this.updateTransform();
  }

  private pushSample(t: number, x: number, y: number): void {
    const i = (this.sampleN % 8) * 3;
    this.samples[i] = t;
    this.samples[i + 1] = x;
    this.samples[i + 2] = y;
    this.sampleN++;
  }

  /** Release: the finger's speed over its last ~90 ms becomes the glide. A finger that stopped first does not fling. */
  private fling(t: number): void {
    const n = this.sampleN;
    if (n < 2) return;
    const s = this.samples;
    const last = ((n - 1) % 8) * 3;
    if (t - s[last] > 60) return;
    let first = last;
    for (let k = 2; k <= Math.min(8, n); k++) {
      const j = ((n - k) % 8) * 3;
      if (s[last] - s[j] > 90) break;
      first = j;
    }
    const dt = (s[last] - s[first]) / 1000;
    if (dt < 0.008) return;
    let vx = (s[last + 1] - s[first + 1]) / dt;
    let vy = (s[last + 2] - s[first + 2]) / dt;
    const sp = Math.hypot(vx, vy);
    if (sp < 60) return;
    if (sp > 5000) {
      vx *= 5000 / sp;
      vy *= 5000 / sp;
    }
    this.camVX = -vx / this.zoom;
    this.camVY = -vy / this.zoom;
  }

  /** Records a tap; true when it completes a double tap (which then frames what was tapped). Only canvas taps start one. */
  private tapAt(x: number, y: number, canStart: boolean): boolean {
    const now = performance.now();
    const t = this.lastTap;
    if (now - t.t < DOUBLE_TAP_MS && Math.hypot(x - t.x, y - t.y) < 36) {
      t.t = 0;
      this.onDoubleTap(x, y);
      return true;
    }
    t.t = canStart ? now : 0;
    t.x = x;
    t.y = y;
    return false;
  }

  /** Double tap: frame the room (or ruin) under the finger above any open sheet; again to zoom back out. Empty space zooms in. */
  private onDoubleTap(sx: number, sy: number): void {
    const { width, height } = this.host.app.screen;
    const id = this.host.targetAt(sx, sy);
    const rect = id ? this.host.targetRect(id) : null;
    const inset = this.sheetInset();
    const wx = this.camX + (sx - width / 2) / this.zoom;
    const wy = this.camY + (sy - this.viewCY()) / this.zoom;
    if (rect) {
      const visH = height - HUD_TOP - HUD_BOTTOM - inset;
      const z = this.clampZoom(Math.min(width * 0.9 / rect.w, visH * 0.82 / rect.h, MAX_ZOOM));
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
      // Already framed: the second double tap goes back to the overview.
      const framed = this.framedId === id && Math.abs(this.zoom / z - 1) < 0.08;
      this.framedId = framed ? null : id;
      this.bottomInset = inset;
      if (framed) this.focusTo(wx - (sx - width / 2) / this.baseZoom, wy - (sy - this.viewCY()) / this.baseZoom, this.baseZoom);
      // The visible middle sits inset/2 px above the view centre.
      else this.focusTo(cx, cy + inset / 2 / z, z);
    } else {
      const z = this.zoom > this.baseZoom * 2.2 ? this.baseZoom : this.clampZoom(this.zoom * 1.8);
      this.focusTo(wx - (sx - width / 2) / z, wy - (sy - this.viewCY()) / z, z);
    }
  }

  /** Screen px of an open bottom sheet that reach above the nav bar. */
  private sheetInset(): number {
    const s = document.querySelector('.sheet-overlay.open .sheet') as HTMLElement | null;
    return s ? Math.max(0, Math.min(this.host.app.screen.height * 0.7, s.offsetHeight - HUD_BOTTOM)) : 0;
  }

  /** After a room is selected: if its sheet (or the screen edge) hides it, glide just enough to show it. */
  keepInSight(id: string): void {
    const v = this.host.roomRect(id);
    if (!v || this.host.selectedId() !== id || this.pointers.size || this.focusTarget) return;
    const { width, height } = this.host.app.screen;
    const inset = this.sheetInset();
    const z = this.zoom, cy = this.viewCY();
    const top = HUD_TOP + 10, bottom = height - HUD_BOTTOM - inset - 10;
    const rTop = cy + (v.y - this.camY) * z, rBot = cy + (v.y + v.h - this.camY) * z;
    const rL = width / 2 + (v.x - this.camX) * z, rR = width / 2 + (v.x + v.w - this.camX) * z;
    let sy = 0, sx = 0;
    if (rBot - rTop > bottom - top) sy = (rTop + rBot) / 2 - (top + bottom) / 2;
    else if (rBot > bottom) sy = rBot - bottom;
    else if (rTop < top) sy = rTop - top;
    if (rR - rL > width - 20) sx = (rL + rR) / 2 - width / 2;
    else if (rR > width - 10) sx = rR - (width - 10);
    else if (rL < 10) sx = rL - 10;
    if (Math.abs(sx) < 2 && Math.abs(sy) < 2) return;
    this.bottomInset = Math.max(this.bottomInset, inset);
    this.focusTo(this.camX + sx / z, this.camY + sy / z, z);
  }

  // ───────────────────────────── [camera] physics ─────────────────────────────

  stopCamera(): void {
    this.camVX = this.camVY = this.zoomV = 0;
    this.focusTarget = null;
    this.wheelZoom = null;
  }

  private viewW(): number {
    return this.host.app.screen.width / this.zoom;
  }

  private viewH(): number {
    return (this.host.app.screen.height - HUD_TOP - HUD_BOTTOM) / this.zoom;
  }

  /** Screen y the camera centre maps to (the middle between the HUD bars). */
  private viewCY(): number {
    return HUD_TOP + (this.host.app.screen.height - HUD_TOP - HUD_BOTTOM) / 2;
  }

  /** Where the camera centre may rest at zoom z (lo === hi on an axis when the content fits). Writes this.bnd. */
  private camBounds(z: number): void {
    const { width, height } = this.host.app.screen;
    const halfW = width / 2 / z;
    const halfH = (height - HUD_TOP - HUD_BOTTOM) / 2 / z;
    const b = this.bnd;
    const minX = -SIDE_MARGIN, maxX = this.host.extentR() + SIDE_MARGIN;
    if (maxX - minX <= halfW * 2) b.x0 = b.x1 = (minX + maxX) / 2;
    else { b.x0 = minX + halfW; b.x1 = maxX - halfW; }
    // An open sheet lets the camera go lower, so the deepest rooms can sit above it.
    // Tall project buildings on the surface let the camera rise to their tops.
    const minY = Math.min(VIEW_TOP, this.host.projectTop()) - 60, maxY = this.host.contentBottom() + this.bottomInset / z;
    if (maxY - minY <= halfH * 2) b.y0 = b.y1 = minY + halfH;
    else { b.y0 = minY + halfH; b.y1 = maxY - halfH; }
  }

  clampZoom(z: number): number {
    return Math.max(this.baseZoom * 0.5, Math.min(MAX_ZOOM, z));
  }

  /** Pinching past the zoom limits gives way with resistance, then springs back on release. */
  private softZoom(z: number): number {
    const lo = this.baseZoom * 0.5;
    if (z > MAX_ZOOM) return MAX_ZOOM * Math.exp(Math.log(z / MAX_ZOOM) * 0.3);
    if (z < lo) return lo * Math.exp(Math.log(z / lo) * 0.3);
    return z;
  }

  clampCamera(): void {
    this.camBounds(this.zoom);
    const b = this.bnd;
    this.camX = Math.max(b.x0, Math.min(b.x1, this.camX));
    this.camY = Math.max(b.y0, Math.min(b.y1, this.camY));
  }

  /** Zoom to z keeping the world point under the screen point (ax, ay) where it is. */
  private zoomAround(z: number, ax: number, ay: number): void {
    const { width } = this.host.app.screen;
    const cy = this.viewCY();
    const wx = this.camX + (ax - width / 2) / this.zoom;
    const wy = this.camY + (ay - cy) / this.zoom;
    this.zoom = z;
    this.camX = wx - (ax - width / 2) / z;
    this.camY = wy - (ay - cy) / z;
  }

  /** Glide (critically damped spring) to a camera centre and zoom; the target is kept inside the bounds. */
  focusTo(x: number, y: number, z: number): void {
    z = this.clampZoom(z);
    this.camBounds(z);
    const b = this.bnd;
    const f = this.focusTarget ?? { x: 0, y: 0, z: 0 };
    f.x = Math.max(b.x0, Math.min(b.x1, x));
    f.y = Math.max(b.y0, Math.min(b.y1, y));
    f.z = z;
    this.focusTarget = f;
    this.wheelZoom = null;
  }

  /** One time step of the camera: focus glide, wheel zoom, zoom-limit spring, coasting, edge springs, shake. */
  stepCamera(dt: number): void {
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
    if (this.punchT < 1) this.punchT += dt;
    // While a sheet lets the camera rest lower, check now and then whether it closed (then glide back).
    if (this.bottomInset > 0 && (this.insetCheck += dt) > 0.25) {
      this.insetCheck = 0;
      if (!document.querySelector('.sheet-overlay.open')) this.bottomInset = 0;
    }
    if (this.pointers.size > 0 && (this.isDragging || this.pinch)) {
      // The fingers own the camera.
    } else if (this.focusTarget) {
      const f = this.focusTarget;
      const lz = crit(Math.log(this.zoom), this.zoomV, Math.log(f.z), FOCUS_SPRING, dt);
      this.zoom = Math.exp(lz);
      this.zoomV = SPRING_V;
      this.camX = crit(this.camX, this.camVX, f.x, FOCUS_SPRING, dt);
      this.camVX = SPRING_V;
      this.camY = crit(this.camY, this.camVY, f.y, FOCUS_SPRING, dt);
      this.camVY = SPRING_V;
      if (Math.abs(this.camX - f.x) * this.zoom < 0.3 && Math.abs(this.camY - f.y) * this.zoom < 0.3 && Math.abs(lz - Math.log(f.z)) < 0.0005) {
        this.camX = f.x;
        this.camY = f.y;
        this.zoom = f.z;
        this.stopCamera();
      }
    } else {
      if (this.wheelZoom !== null) {
        const target = Math.log(this.wheelZoom), lz = Math.log(this.zoom);
        const next = Math.abs(target - lz) < 0.0005 ? target : lz + (target - lz) * (1 - Math.exp(-dt * 16));
        this.zoomAround(Math.exp(next), this.zoomAnchorX, this.zoomAnchorY);
        if (next === target) this.wheelZoom = null;
      }
      // Past the zoom limits (after a pinch): spring back around the last pinch point.
      const zc = this.clampZoom(this.zoom);
      if (zc !== this.zoom || this.zoomV !== 0) {
        const lz = crit(Math.log(this.zoom), this.zoomV, Math.log(zc), ZOOM_SPRING, dt);
        this.zoomV = SPRING_V;
        const settled = Math.abs(lz - Math.log(zc)) < 0.0005 && Math.abs(this.zoomV) < 0.01;
        this.zoomAround(settled ? zc : Math.exp(lz), this.zoomAnchorX, this.zoomAnchorY);
        if (settled) this.zoomV = 0;
      }
      // Pan: glide with friction inside the bounds; outside them a spring pulls back (rubber band).
      this.camBounds(this.zoom);
      const b = this.bnd;
      this.camX = this.axisStep(this.camX, this.camVX, b.x0, b.x1, dt);
      this.camVX = SPRING_V;
      this.camY = this.axisStep(this.camY, this.camVY, b.y0, b.y1, dt);
      this.camVY = SPRING_V;
    }
    this.updateTransform();
  }

  /** [perf] The camera (or a carried person) is moving right now: the engine draws at its motion rate (60) while this holds. */
  get moving(): boolean {
    return this.host.carryPointer() !== null || (this.pointers.size > 0 && (this.isDragging || this.pinch !== null)) || this.focusTarget !== null
      || this.camVX !== 0 || this.camVY !== 0 || this.zoomV !== 0 || this.wheelZoom !== null || this.trauma > 0 || this.punchT < 1;
  }

  /** One axis of the free camera; the new velocity is left in SPRING_V. */
  private axisStep(x: number, v: number, lo: number, hi: number, dt: number): number {
    if (x < lo || x > hi) {
      const t = x < lo ? lo : hi;
      const nx = crit(x, v, t, EDGE_SPRING, dt);
      if (Math.abs(nx - t) * this.zoom < 0.2 && Math.abs(SPRING_V) * this.zoom < 4) {
        SPRING_V = 0;
        return t;
      }
      return nx;
    }
    if (v === 0) {
      SPRING_V = 0;
      return x;
    }
    const e = Math.exp(-FRICTION * dt);
    const nx = x + (v * (1 - e)) / FRICTION;
    SPRING_V = Math.abs(v * e) * this.zoom < 8 ? 0 : v * e;
    return nx;
  }

  updateTransform(): void {
    const wc = this.host.worldContainer;
    const { width } = this.host.app.screen;
    const cy = this.viewCY();
    let ox = 0, oy = 0, zk = 1;
    if (this.trauma > 0) {
      // Trauma² × smooth noise: big hits read big, the tail fades softly instead of buzzing.
      const a = SHAKE_PX * this.trauma * this.trauma * (this.calm ? 0.3 : 1);
      const t = this.host.time() * 26;
      ox = a * (Math.sin(t) * 0.5 + Math.sin(t * 2.13 + 1.7) * 0.3 + Math.sin(t * 4.37 + 4.1) * 0.2);
      oy = a * (Math.sin(t * 1.11 + 3.3) * 0.5 + Math.sin(t * 2.41 + 0.6) * 0.3 + Math.sin(t * 3.97 + 2.2) * 0.2);
    }
    if (this.punchT < 0.5) {
      const e = punchEnvelope(this.punchT);
      zk += this.punchAmt * e;
      ox += this.punchDX * e;
      oy += this.punchDY * e;
    }
    // The punch zooms around the view centre.
    const z = this.zoom * zk;
    wc.scale.set(z);
    wc.x = width / 2 - this.camX * z + ox;
    wc.y = cy - this.camY * z + oy;
  }

  /** Dev tools: put the camera at a world point with a zoom relative to the fit-to-screen zoom. */
  devCamera(x: number, y: number, zoomRel: number): void {
    this.stopCamera();
    this.zoom = this.clampZoom(this.baseZoom * zoomRel);
    this.camX = x;
    this.camY = y;
    this.clampCamera();
    this.updateTransform();
  }

  /** Glides a floor into view (used when placing a room and after digging). */
  focusFloor(floor: number): void {
    this.focusTo(this.camX, floorTop(floor) + ROOM_H / 2, this.zoom);
  }

  /** Centers the camera on a world point and zooms in a little. */
  focusOn(x: number, y: number, zoomBoost = 1.5): void {
    // [camera] A glide (critically damped spring), not a jump.
    this.focusTo(x, y, Math.max(this.zoom, this.baseZoom * zoomBoost));
  }
}

// [camera] Spring and rubber-band helpers (allocation-free: crit() leaves the new velocity in SPRING_V).
let SPRING_V = 0;

/** Exact step of a critically damped spring towards target (stable for any dt). */
function crit(x: number, v: number, target: number, w: number, dt: number): number {
  const x0 = x - target;
  const e = Math.exp(-w * dt);
  const c = v + w * x0;
  SPRING_V = (v - w * c * dt) * e;
  return target + (x0 + c * dt) * e;
}

/** iOS-style rubber band: past [lo, hi] the camera gives way less and less (dim = view size in world units). */
function rubber(v: number, lo: number, hi: number, dim: number): number {
  const off = (o: number) => (1 - 1 / ((o * 0.55) / dim + 1)) * dim;
  return v < lo ? lo - off(lo - v) : v > hi ? hi + off(v - hi) : v;
}

/** The raw position that rubber() maps to v. */
function unrubber(v: number, lo: number, hi: number, dim: number): number {
  const inv = (y: number) => (dim / 0.55) * (1 / (1 - Math.min(0.95, y / dim)) - 1);
  return v < lo ? lo - inv(lo - v) : v > hi ? hi + inv(v - hi) : v;
}

/** Zoom punch shape: 40 ms attack, then a damped wobble (a small undershoot) gone by ~0.4 s. */
function punchEnvelope(t: number): number {
  if (t < 0.04) return Math.sin((t / 0.04) * Math.PI / 2);
  const u = t - 0.04;
  return Math.exp(-u * 11) * Math.cos(u * 15);
}

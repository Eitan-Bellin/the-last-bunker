import { tokens } from './tokens';
import { DEG, clamp, invert, lerp, lookAt, m4, mul, perspective, type V3 } from './math';

/**
 * Orbit camera around a target on the plane z = focusZ. Pan keeps the grabbed world point under the finger; zoom keeps the point under
 * the cursor fixed; yaw is limited to +-yawLimitDeg around the base angle; pitch follows zoom (low and cinematic close, map-like far).
 */
export class Camera {
  tx = 0;
  ty = 0;
  dist = 60;
  goalDist = 60;
  yaw = 0; // user yaw in degrees (clamped)
  vx = 0;
  vy = 0;
  w = 1;
  h = 1;
  eye: V3 = [0, 0, 0];
  readonly view = m4();
  readonly proj = m4();
  readonly vp = m4();
  readonly invVP = m4();
  private anchor: [number, number] | null = null;

  setViewport(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.rebuild();
  }

  get fov(): number { return tokens.camera.fovDeg * DEG; }

  pitch(): number {
    const C = tokens.camera;
    const t = Math.pow(clamp((this.dist - C.distMin) / (C.distMax - C.distMin), 0, 1), 0.6);
    return lerp(C.pitchNearDeg, C.pitchFarDeg, t) * DEG;
  }

  rebuild(): void {
    const C = tokens.camera;
    const p = this.pitch(), y = (C.baseYawDeg + this.yaw) * DEG;
    const t: V3 = [this.tx, this.ty, C.focusZ];
    this.eye = [t[0] + this.dist * Math.sin(y) * Math.cos(p), t[1] + this.dist * Math.sin(p), t[2] + this.dist * Math.cos(y) * Math.cos(p)];
    lookAt(this.view, this.eye, t, [0, 1, 0]);
    perspective(this.proj, this.fov, this.w / this.h, Math.max(0.3, this.dist * 0.04), this.dist + 420);
    mul(this.vp, this.proj, this.view);
    invert(this.invVP, this.vp);
  }

  /** World point under a screen pixel on the plane z = planeZ (or null if the ray misses). */
  pick(sx: number, sy: number, planeZ = tokens.camera.focusZ): V3 | null {
    const nx = (sx / this.w) * 2 - 1, ny = 1 - (sy / this.h) * 2;
    const un = (z: number): V3 => {
      const m = this.invVP;
      const X = m[0] * nx + m[4] * ny + m[8] * z + m[12];
      const Y = m[1] * nx + m[5] * ny + m[9] * z + m[13];
      const Z = m[2] * nx + m[6] * ny + m[10] * z + m[14];
      const W = m[3] * nx + m[7] * ny + m[11] * z + m[15];
      return [X / W, Y / W, Z / W];
    };
    const a = un(-1), b = un(1);
    const dz = b[2] - a[2];
    if (Math.abs(dz) < 1e-6) return null;
    const t = (planeZ - a[2]) / dz;
    if (t < 0) return null;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, planeZ];
  }

  panPixels(x0: number, y0: number, x1: number, y1: number, dt: number): void {
    const a = this.pick(x0, y0), b = this.pick(x1, y1);
    if (!a || !b) return;
    const dx = a[0] - b[0], dy = a[1] - b[1];
    this.tx += dx;
    this.ty += dy;
    if (dt > 0) {
      this.vx = lerp(this.vx, dx / dt, 0.5);
      this.vy = lerp(this.vy, dy / dt, 0.5);
    }
    this.clampTarget();
    this.rebuild();
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    const C = tokens.camera;
    this.goalDist = clamp(this.goalDist * factor, C.distMin, C.distMax);
    this.anchor = [sx, sy];
  }

  orbit(dDeg: number): void {
    const L = tokens.camera.yawLimitDeg;
    this.yaw = clamp(this.yaw + dDeg, -L, L);
    this.rebuild();
  }

  stop(): void { this.vx = 0; this.vy = 0; }

  clampTarget(): void {
    const B = tokens.camera.bounds;
    this.tx = clamp(this.tx, B.xMin, B.xMax);
    this.ty = clamp(this.ty, B.yMin, B.yMax);
  }

  /** Returns true while the camera is still moving (so the caller can keep a high frame rate). */
  update(dt: number, dragging: boolean): boolean {
    const C = tokens.camera;
    let moving = false;
    if (!dragging && (Math.abs(this.vx) > 0.01 || Math.abs(this.vy) > 0.01)) {
      this.tx += this.vx * dt;
      this.ty += this.vy * dt;
      const f = Math.exp(-C.panFriction * dt);
      this.vx *= f;
      this.vy *= f;
      this.clampTarget();
      moving = true;
    }
    if (Math.abs(this.dist - this.goalDist) > 0.001) {
      const before = this.anchor ? this.pick(this.anchor[0], this.anchor[1]) : null;
      this.dist = lerp(this.dist, this.goalDist, 1 - Math.exp(-C.zoomSmoothing * dt));
      if (Math.abs(this.dist - this.goalDist) < 0.002) this.dist = this.goalDist;
      this.rebuild();
      const after = this.anchor ? this.pick(this.anchor[0], this.anchor[1]) : null;
      if (before && after) {
        this.tx += before[0] - after[0];
        this.ty += before[1] - after[1];
        this.clampTarget();
      }
      moving = true;
    }
    this.rebuild();
    return moving;
  }
}

/**
 * [world:M2 camera-nav] Follow-survivor: the camera half (a tracker that keeps a moving point inside the central dead zone of the view) and
 * the seam to whoever knows where the survivors are (`FollowSource`, implemented by walkers.ts `followSource`). Pure and Node-safe; the
 * gestures themselves live in CameraController (double tap on a walking survivor starts, a pan / pinch / wheel or a tap elsewhere stops).
 *
 * Tracking (CAMERA.follow):
 *   - catch-up: after a start (or after the target jumped: a walk cut short, a survivor placed at once) the camera glides toward the target
 *     at `catchUp` with no hold, so nothing snaps;
 *   - held: once the target sits inside the dead zone the camera eases toward target + look-ahead at `spring`, AND a hard hold keeps the
 *     target inside the central `deadZone` of the view on both axes every frame, whatever its speed (the lift car crosses a stratum in about
 *     two seconds; a spring alone would lose it);
 *   - reduced motion: no easing at all. The camera stands still while the target is inside the dead zone and cuts to centre it when it leaves.
 * No allocation per step.
 */
import { CAMERA } from '../tokens';

/** Who the camera can follow: a hit test in world space and where a followed person is right now. */
export interface FollowSource {
  /** The id of the walking survivor whose figure is at (wx, wy) give or take `slop` world units, or null. */
  pickAt(wx: number, wy: number, slop: number): string | null;
  /** Writes the centre of the person's figure (world units) into `out`; false when the person is gone. */
  locate(id: string, out: { x: number; y: number }): boolean;
}

export class FollowTracker {
  /** The target has been inside the dead zone since the last (re)start: the hard hold is on. */
  locked = false;
  private vx = 0;
  private vy = 0;
  private lx = NaN;
  private ly = NaN;

  reset(): void {
    this.locked = false;
    this.vx = this.vy = 0;
    this.lx = this.ly = NaN;
  }

  /**
   * One step. `cam` is the camera centre (world, read and written), (tx, ty) the target, `z` the zoom, `vw` / `vh` the view in screen px
   * (between the HUD bands), `calm` reduced motion. Returns true when the camera moved.
   */
  step(cam: { x: number; y: number }, tx: number, ty: number, dt: number, z: number, vw: number, vh: number, calm: boolean): boolean {
    const F = CAMERA.follow;
    const hw = (vw * F.deadZone) / 2 / z, hh = (vh * F.deadZone) / 2 / z;
    const ox = cam.x, oy = cam.y;
    // Velocity (smoothed); a jump (placed, not walked) restarts the catch-up.
    if (Number.isFinite(this.lx) && dt > 0) {
      const dx = tx - this.lx, dy = ty - this.ly;
      if (Math.hypot(dx, dy) * z > F.jumpPx) {
        this.locked = false;
        this.vx = this.vy = 0;
      } else {
        const k = 1 - Math.exp(-dt * 8);
        this.vx += (dx / dt - this.vx) * k;
        this.vy += (dy / dt - this.vy) * k;
      }
    }
    this.lx = tx;
    this.ly = ty;
    const inside = Math.abs(tx - cam.x) <= hw && Math.abs(ty - cam.y) <= hh;
    if (calm) {
      // Reduced motion: cuts only.
      if (!inside) { cam.x = tx; cam.y = ty; }
      this.locked = true;
      return cam.x !== ox || cam.y !== oy;
    }
    if (!this.locked && inside) this.locked = true;
    const lead = F.maxLead;
    const ax = Math.max(-hw * lead, Math.min(hw * lead, this.vx * F.lookAhead));
    const ay = Math.max(-hh * lead, Math.min(hh * lead, this.vy * F.lookAhead));
    const k = 1 - Math.exp(-dt * (this.locked ? F.spring : F.catchUp));
    cam.x += (tx + ax - cam.x) * k;
    cam.y += (ty + ay - cam.y) * k;
    if (this.locked) {
      // The hard hold: the target never leaves the central dead zone.
      if (tx - cam.x > hw) cam.x = tx - hw;
      else if (cam.x - tx > hw) cam.x = tx + hw;
      if (ty - cam.y > hh) cam.y = ty - hh;
      else if (cam.y - ty > hh) cam.y = ty + hh;
    }
    return cam.x !== ox || cam.y !== oy;
  }
}

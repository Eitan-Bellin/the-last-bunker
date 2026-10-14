import { tokens } from './tokens';
import { smooth } from './math';

/**
 * Fog of war: a small single-channel texture over the cross-section (x, y). 1 = known, 0 = unexplored.
 * The shaders sample it by world position, so rock, rooms, lights, halos and dust all vanish into it together.
 * A click starts a reveal that grows over `revealSeconds`.
 */
export class Fow {
  readonly x0 = -82;
  readonly y0 = -34;
  readonly wM = 136;
  readonly hM = 36;
  readonly w: number;
  readonly h: number;
  readonly tpm = tokens.fow.texelsPerM;
  readonly cur: Float32Array;
  readonly bytes: Uint8Array;
  dirty = true;
  private events: { x: number; y: number; t0: number }[] = [];

  constructor() {
    this.w = this.wM * this.tpm;
    this.h = this.hM * this.tpm;
    this.cur = new Float32Array(this.w * this.h);
    this.bytes = new Uint8Array(this.w * this.h);
    this.reset();
  }

  reset(): void {
    this.cur.fill(0);
    // everything from the surface down to the district floor is known; the deep rock and the far west are not
    this.rect(-44, 43, -18.5, 2, 1, 3.5);
    this.rect(-49, -44, -17, -11, 1, 2.5);
    this.rect(-62, -49, -16.5, -11.5, tokens.fow.hint, 3);
    this.events = [];
    this.dirty = true;
  }

  private rect(x0: number, x1: number, y0: number, y1: number, v: number, soft: number): void {
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        const x = this.x0 + (i + 0.5) / this.tpm, y = this.y0 + (j + 0.5) / this.tpm;
        const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
        const d = Math.hypot(dx, dy);
        const a = v * (1 - smooth(0, soft, d));
        const k = j * this.w + i;
        if (a > this.cur[k]) this.cur[k] = a;
      }
  }

  private circle(cx: number, cy: number, r: number, soft: number): void {
    const R = r + soft;
    const i0 = Math.max(0, Math.floor((cx - R - this.x0) * this.tpm)), i1 = Math.min(this.w - 1, Math.ceil((cx + R - this.x0) * this.tpm));
    const j0 = Math.max(0, Math.floor((cy - R - this.y0) * this.tpm)), j1 = Math.min(this.h - 1, Math.ceil((cy + R - this.y0) * this.tpm));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + (i + 0.5) / this.tpm, y = this.y0 + (j + 0.5) / this.tpm;
        const d = Math.hypot(x - cx, (y - cy) * 1.25);
        const a = 1 - smooth(r - soft, r, d);
        const k = j * this.w + i;
        if (a > this.cur[k]) { this.cur[k] = a; this.dirty = true; }
      }
  }

  reveal(x: number, y: number, now: number): void {
    this.events.push({ x, y, t0: now });
  }

  /** Grow the running reveals; returns true if the texture must be re-uploaded. */
  update(now: number): boolean {
    const F = tokens.fow;
    this.events = this.events.filter((e) => {
      const t = Math.min(1, (now - e.t0) / F.revealSeconds);
      const ease = 1 - (1 - t) * (1 - t) * (1 - t);
      this.circle(e.x, e.y, Math.max(0.5, F.revealRadius * ease), F.revealSoft);
      return t < 1;
    });
    if (!this.dirty) return false;
    for (let k = 0; k < this.cur.length; k++) this.bytes[k] = Math.round(this.cur[k] * 255);
    this.dirty = false;
    return true;
  }

  at(x: number, y: number): number {
    if (y > -0.5) return 1;
    const i = Math.floor((x - this.x0) * this.tpm), j = Math.floor((y - this.y0) * this.tpm);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return 0;
    return this.cur[j * this.w + i];
  }
}

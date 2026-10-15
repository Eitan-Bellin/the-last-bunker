/**
 * [ux-redesign W4] The number on a HUD tile counts up (or down) when it jumps by more than JUMP_SHARE in one go, over 300..1000 ms by
 * the size of the jump; small changes (the steady trickle of production) keep the gentle roll the HUD always had. While goods fly to a
 * tile the number may wait for them (`hold`). Pure arithmetic: the HUD calls `step` from its own update and writes only when the text
 * changes, so an idle tile costs no DOM writes.
 */
import { MS } from '../kit/tokens';

/** A change bigger than this share of the shown value counts up instead of rolling. */
export const JUMP_SHARE = 0.05;
/** Shortest count (--dur-screen, 300 ms) and the longest (a doubling or more). */
export const COUNT_MIN_MS = MS['dur-screen'];
export const COUNT_MAX_MS = 1000;

interface Tween { from: number; to: number; t0: number; ms: number }

/** easeOutCubic (the --ease-out token's curve). */
function easeOut(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** How long a jump from `from` to `to` counts (ms). */
export function countMs(from: number, to: number): number {
  const share = Math.abs(to - from) / Math.max(1, Math.abs(from));
  return Math.round(COUNT_MIN_MS + (COUNT_MAX_MS - COUNT_MIN_MS) * Math.min(1, share));
}

export class CountUp<K> {
  private tweens = new Map<K, Tween>();
  private holds = new Map<K, number>();
  /** Reduced motion: jumps show at once (no counting). */
  instant = false;

  /** Keep showing the old number for `ms` (goods are on their way to the tile). */
  hold(key: K, ms: number, now = performance.now()): void {
    if (ms <= 0) { this.holds.delete(key); return; }
    this.holds.set(key, Math.max(this.holds.get(key) ?? 0, now + ms));
  }

  /** Releases a hold early (the first particle landed). */
  release(key: K): void {
    this.holds.delete(key);
  }

  /**
   * The number to show this frame. `shown` is what is on the tile, `target` the real amount, `dt` seconds since the last call
   * (for the gentle roll of small changes).
   */
  step(key: K, shown: number, target: number, now: number, dt: number): number {
    const holdUntil = this.holds.get(key);
    if (holdUntil !== undefined) {
      if (now < holdUntil && target > shown) return shown;
      this.holds.delete(key);
    }
    const tw = this.tweens.get(key);
    if (tw) {
      // Production keeps ticking while it counts: follow the moving target without restarting.
      if (Math.abs(target - tw.to) <= JUMP_SHARE * Math.max(1, Math.abs(tw.to))) tw.to = target;
      else { this.tweens.delete(key); return this.step(key, shown, target, now, dt); }
      const k = (now - tw.t0) / tw.ms;
      if (k >= 1) { this.tweens.delete(key); return target; }
      return tw.from + (tw.to - tw.from) * easeOut(Math.max(0, k));
    }
    const diff = target - shown;
    if (Math.abs(diff) < 0.5) return target;
    if (!this.instant && Math.abs(diff) > JUMP_SHARE * Math.max(1, Math.abs(shown))) {
      this.tweens.set(key, { from: shown, to: target, t0: now, ms: countMs(shown, target) });
      return shown;
    }
    if (this.instant && Math.abs(diff) > JUMP_SHARE * Math.max(1, Math.abs(shown))) return target;
    return shown + diff * Math.min(1, dt * 9);
  }

  /** Something is counting or waiting (the HUD may skip work otherwise). */
  get busy(): boolean {
    return this.tweens.size > 0 || this.holds.size > 0;
  }
}

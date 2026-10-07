/**
 * [plan4:UX-24] iOS never tells a web page that Low Power Mode is on, but it shows: the system then caps requestAnimationFrame at
 * 30 Hz. This watches the rhythm of requestAnimationFrame itself (not the game's own pictures, which the engine paces on purpose):
 * if, over a 20 second stretch of a visible page, more than 60 % of the gaps sit around 33 ms, the phone is probably saving power.
 * The result is only ever a suggestion ("battery saver?"); nothing is switched on behind the player's back.
 * Touch devices only, and the sampler stops for good once it has decided (one more rAF callback per picture is not free).
 */

/** A 20 s stretch is judged once it holds this many samples (a page that was throttled to nothing proves nothing). */
const MIN_SAMPLES = 200;
const WINDOW_MS = 20_000;
/** Gaps between 28 and 40 ms are "a 30 Hz rhythm"; a 60 Hz display gives 16.7, a 120 Hz one 8.3. */
const LOW = 28;
const HIGH = 40;

/** True when most of the gaps look like a 30 Hz cap. Pure, so a test can feed it numbers. */
export function looksLikeLowPowerMode(gapsMs: readonly number[]): boolean {
  if (gapsMs.length < MIN_SAMPLES) return false;
  let slow = 0;
  for (const g of gapsMs) if (g >= LOW && g <= HIGH) slow++;
  return slow / gapsMs.length > 0.6;
}

let started = false;
let suspected = false;

/** Whether the watcher has seen a 30 Hz rhythm (stays true once seen). */
export function lowPowerSuspected(): boolean {
  return suspected;
}

export function startPowerWatch(): void {
  if (started || typeof requestAnimationFrame !== 'function') return;
  started = true;
  let gaps: number[] = [];
  let windowStart = 0;
  let last = 0;
  const tick = (t: number): void => {
    if (document.hidden) {
      // A page in the background is throttled by design: start the stretch over when it comes back.
      gaps = [];
      windowStart = 0;
      last = 0;
    } else {
      if (last > 0 && t - last < 200) gaps.push(t - last);
      if (!windowStart) windowStart = t;
      last = t;
      if (t - windowStart >= WINDOW_MS) {
        if (looksLikeLowPowerMode(gaps)) suspected = true;
        gaps = [];
        windowStart = 0;
      }
    }
    if (!suspected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

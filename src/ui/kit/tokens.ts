/**
 * [ux-redesign W1] The few design tokens TypeScript needs, mirrored from src/styles/tokens.css (the source of truth).
 * tools/sim/tokens-test.mjs fails when a value here and its CSS variable drift apart.
 * Visual motion stays in CSS (so reduced motion can zero it there); these are the timings of gestures and timers.
 */

/** Milliseconds; the key is the CSS variable without the leading dashes. */
export const MS = {
  'dur-press': 60,
  'dur-release': 150,
  'dur-popup-in': 250,
  'dur-popup-out': 180,
  'dur-screen': 300,
  'dur-toast': 200,
  'toast-hold': 2500,
  stagger: 40,
  'dur-shake': 200,
  debounce: 350,
  'long-press': 450,
} as const;

/** Pixels. */
export const PX = {
  'hit-min': 48,
} as const;

/** A resource amount under this share of its cap is "low" (amber); under DANGER_RATIO it is "danger" (red, pulsing). */
export const LOW_RATIO = 0.3;
export const DANGER_RATIO = 0.15;
/** A badge shows at most this number, then "99+". */
export const BADGE_MAX = 99;
/** How far (px) a finger may drift during a long press before it counts as a drag. */
export const LONG_PRESS_SLOP = 10;
/** A timer that is still not on the page after this many ticks was never shown: it stops. */
export const NEVER_ATTACHED_TICKS = 5;
/** One second, for timers. */
export const SECOND_MS = 1000;

/** The colour token of a resource (`--res-<id>` in tokens.css; one per id in src/data/resources.ts). */
export function resourceColor(id: string): string {
  return `var(--res-${id})`;
}

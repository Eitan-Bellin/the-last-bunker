/**
 * Short vibration feedback. Browsers refuse it (and log an error) until the player has touched the page once,
 * so ask first: no console errors, and no pointless calls.
 */
export function vibrate(pattern: number | number[]): void {
  try {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate?.(pattern);
  } catch {
    // no haptics on this device
  }
}

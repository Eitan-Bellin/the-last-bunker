/** A phone or tablet (the finger is the main pointer): these get the cooler graphics defaults. Cached, it never changes. */
let touch: boolean | null = null;

export function isTouchDevice(): boolean {
  if (touch === null) {
    try {
      touch = window.matchMedia('(pointer: coarse)').matches;
    } catch {
      touch = false;
    }
  }
  return touch;
}

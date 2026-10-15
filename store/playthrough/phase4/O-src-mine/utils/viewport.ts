/**
 * The window size, kept up to date by events instead of being asked for. Reading `innerWidth` / `innerHeight` makes the browser bring
 * layout up to date first when anything in the page changed (the HUD changes every picture), and the rooms asked it several times
 * a picture: ~1 ms a picture on a laptop, ~4 ms on a mid-range phone. Use `viewport.w` / `viewport.h` in per-picture code.
 */
export const viewport = { w: window.innerWidth, h: window.innerHeight };

const update = (): void => {
  viewport.w = window.innerWidth;
  viewport.h = window.innerHeight;
};
window.addEventListener('resize', update);
window.addEventListener('orientationchange', update);

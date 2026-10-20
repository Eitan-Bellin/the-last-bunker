/**
 * [plan4:UX-5] How much of the screen the HUD really covers, measured (not guessed) by HUD.ts with a ResizeObserver.
 *
 * Why: the camera used to assume fixed bands (`HUD_TOP = 150`, `HUD_BOTTOM = 72`), but the HUD grows with the text size (2x2
 * resources at 1.25+), has its objective strip just above the nav, and sits inside safe areas. `CameraController` can subscribe
 * here (a later wave) instead of keeping its own constants. The numbers are CSS px measured from the screen edge:
 *  - top: from the top edge to the bottom of the status row (resources + info chips)
 *  - bottom: from the bottom edge to the top of the nav console (includes the home-bar safe area)
 *  - objective: extra px the objective strip takes just above the nav (0 when it is hidden)
 * Also published as `window.__hudInsets` and as the CSS variables --hud-top-h / --nav-h (sheets pad themselves by --nav-h).
 */
export interface HudInsets {
  top: number;
  bottom: number;
  objective: number;
}

type Listener = (insets: Readonly<HudInsets>) => void;

const current: HudInsets = { top: 0, bottom: 0, objective: 0 };
const listeners = new Set<Listener>();

declare global {
  interface Window { __hudInsets?: Readonly<HudInsets>; }
}

export function getHudInsets(): Readonly<HudInsets> {
  return current;
}

/** Calls `fn` on every change (not for the current value: read it with getHudInsets). Returns the unsubscribe. */
export function subscribeHudInsets(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Called by the HUD whenever its parts resize. Rounds to whole px so sub-pixel jitter does not wake the listeners. */
export function setHudInsets(next: Partial<HudInsets>): void {
  let changed = false;
  for (const k of ['top', 'bottom', 'objective'] as const) {
    const v = next[k];
    if (v === undefined) continue;
    const r = Math.max(0, Math.round(v));
    if (current[k] !== r) { current[k] = r; changed = true; }
  }
  if (!changed) return;
  window.__hudInsets = current;
  const root = document.documentElement.style;
  root.setProperty('--hud-top-h', `${current.top}px`);
  root.setProperty('--nav-h', `${current.bottom}px`);
  root.setProperty('--obj-h', `${current.objective}px`);
  for (const l of [...listeners]) {
    try { l(current); } catch { /* one bad listener must not stop the others */ }
  }
}

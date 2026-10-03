import type { Sfx } from './sfx';

/**
 * A tiny global hook so UI components can make their own sounds (tabs, dialogs, toggles)
 * without each needing the audio engine passed in. The app registers the player at startup.
 */
let player: ((name: Sfx, volume?: number) => void) | null = null;
const last = new Map<Sfx, number>();

export function setUiSound(p: (name: Sfx, volume?: number) => void): void {
  player = p;
}

/** Plays a UI sound; `minGapMs` keeps chatty sounds (notifications) from piling up. */
export function uiSound(name: Sfx, volume?: number, minGapMs = 0): void {
  const now = performance.now();
  if (minGapMs && now - (last.get(name) ?? -1e9) < minGapMs) return;
  last.set(name, now);
  player?.(name, volume);
}

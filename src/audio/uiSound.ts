import type { Sfx } from './sfx';

/**
 * A tiny global hook so UI components can make their own sounds (tabs, dialogs, toggles)
 * without each needing the audio engine passed in. The app registers the player at startup.
 */
let player: ((name: Sfx, volume?: number, rate?: number) => void) | null = null;
const last = new Map<Sfx, number>();

export function setUiSound(p: (name: Sfx, volume?: number, rate?: number) => void): void {
  player = p;
}

/** Plays a UI sound; `minGapMs` keeps chatty sounds (notifications) from piling up. */
export function uiSound(name: Sfx, volume?: number, minGapMs = 0): void {
  const now = performance.now();
  if (minGapMs && now - (last.get(name) ?? -1e9) < minGapMs) return;
  last.set(name, now);
  player?.(name, volume, soundRate(name, now));
}

// ───────────────────────────── [ux-redesign W4] pitch: variation and the collect combo ─────────────────────────────

/** The interface's own small sounds: each play is pitched up to ±VARIATION so a run of taps never sounds machine-gunned. */
const UI_SOUNDS = new Set<Sfx>([
  'click', 'tab', 'switch', 'open', 'modalOpen', 'confirm', 'cancel', 'notify', 'assign', 'unassign', 'whoosh', 'type', 'error',
  'collect', 'coin', 'drip', 'place', 'tick',
]);
const VARIATION = 0.05;
/** Collecting again within COMBO_MS raises the pitch one step (COMBO_STEP, about a semitone) up to COMBO_MAX steps. */
const COMBO_SOUNDS = new Set<Sfx>(['collect', 'coin', 'drip']);
export const COMBO_MS = 1500;
const COMBO_STEP = 0.06;
const COMBO_MAX = 6;
let comboAt = -1e9;
let combo = 0;

/** The current combo step (0 = none), for the debug tool and tests. */
export function comboStep(): number {
  return combo;
}

/**
 * The playback rate for one play of `name`: 1 for the big story sounds (the engine keeps its own slight variation for them),
 * 0.95..1.05 for interface sounds, and for collect sounds one step higher for every collection within 1.5 s of the last one.
 * Several collect sounds in the same instant (a bubble's two sounds) share one step.
 */
export function soundRate(name: Sfx, now = performance.now()): number | undefined {
  if (!UI_SOUNDS.has(name)) return undefined;
  let rate = 1 + (Math.random() * 2 - 1) * VARIATION;
  if (COMBO_SOUNDS.has(name)) {
    const gap = now - comboAt;
    if (gap > COMBO_MS) combo = 0;
    else if (gap > 50) combo = Math.min(COMBO_MAX, combo + 1);
    comboAt = now;
    rate = (1 + combo * COMBO_STEP) * (1 + (Math.random() * 2 - 1) * VARIATION * 0.3);
  }
  return rate;
}

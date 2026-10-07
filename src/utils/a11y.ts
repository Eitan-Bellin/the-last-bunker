/**
 * [plan4:AC-1] The single source of the accessibility preferences.
 *
 * Everything that reacts to them (CSS, the canvas, haptics, audio) reads or subscribes here instead of asking the
 * media queries / the save itself, so a setting only has to be implemented once. It is a *device* preference first
 * (localStorage, applied before the game loads, so there is no flash of the wrong text size or contrast), and the app
 * mirrors it into `state.settings.a11y` so it travels with a save backup (see `hydrateA11y`).
 */
import { defaultA11y, type A11ySettings } from '../core/GameState';

export type { A11ySettings } from '../core/GameState';

const KEY = 'lastbunker_a11y';
/** The text size used to be its own device preference; honour it once so nobody's chosen size resets. */
const LEGACY_TEXT_KEY = 'lastbunker_textsize';
const LEGACY_TEXT: Record<string, number> = { normal: 1.1, large: 1.25, xlarge: 1.4 };
/** The steps the menu cycles through (1.0 stays valid in a save, it is just not offered: 1.1 is the designed default). */
export const TEXT_SCALES = [1.1, 1.25, 1.4, 1.6] as const;

type Listener = (s: Readonly<A11ySettings>) => void;

let current: A11ySettings = defaultA11y();
let started = false;
let mql: MediaQueryList | null = null;
let hasStoredPref = false;
const listeners = new Set<Listener>();

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Accepts anything (an old save, a hand-edited file) and returns a complete, valid block. */
export function sanitizeA11y(raw: unknown): A11ySettings {
  const d = defaultA11y();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const scale = typeof r.textScale === 'number' ? r.textScale : d.textScale;
  return {
    motion: pick(r.motion, ['auto', 'reduced', 'full'] as const, d.motion),
    flash: pick(r.flash, ['safe', 'normal'] as const, d.flash),
    textScale: ([1.0, ...TEXT_SCALES] as number[]).includes(scale) ? (scale as A11ySettings['textScale']) : d.textScale,
    contrast: pick(r.contrast, ['normal', 'high'] as const, d.contrast),
    colorMode: pick(r.colorMode, ['none', 'deuter', 'protan', 'tritan'] as const, d.colorMode),
    haptics: pick(r.haptics, ['off', 'light', 'strong'] as const, d.haptics),
    oneHand: pick(r.oneHand, ['off', 'right', 'left'] as const, d.oneHand),
    largeTargets: bool(r.largeTargets, d.largeTargets),
    popups: pick(r.popups, ['all', 'important', 'off'] as const, d.popups),
    captions: bool(r.captions, d.captions),
    announce: bool(r.announce, d.announce),
    powerSaver: bool(r.powerSaver, d.powerSaver),
    playInSilent: bool(r.playInSilent, d.playInSilent),
  };
}

/** `motion: 'auto'` follows the operating system, live. */
export function reducedMotion(): boolean {
  if (current.motion === 'reduced') return true;
  if (current.motion === 'full') return false;
  try {
    return !!(mql ?? window.matchMedia?.('(prefers-reduced-motion: reduce)'))?.matches;
  } catch {
    return false;
  }
}

/** [plan4:AC-2] With reduced motion a camera glide becomes a quick cut this long (ms); read it with `snapCamera()`. */
export const SNAP_MS = 120;
/** True when camera glides (focus on a room, zoom to an alert, recentre) should be cuts of `SNAP_MS` instead of eased travel. */
export function snapCamera(): boolean {
  return reducedMotion();
}

/** Puts the settings on <html>: the stylesheets key off these attributes and --fs, nothing else. */
function apply(): void {
  const root = document.documentElement;
  root.dataset.motion = reducedMotion() ? 'reduced' : 'full';
  root.dataset.contrast = current.contrast;
  root.dataset.color = current.colorMode;
  root.dataset.onehand = current.oneHand;
  root.dataset.large = current.largeTargets ? 'on' : 'off';
  root.style.setProperty('--fs', String(current.textScale));
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
    hasStoredPref = true;
  } catch {
    // storage blocked: the choice lasts for this session (and travels with the save)
  }
}

function emit(): void {
  for (const l of [...listeners]) {
    try { l(current); } catch { /* one bad listener must not stop the others */ }
  }
}

/** Idempotent: reads the stored preference, applies it and starts following the OS reduced-motion setting. */
export function initA11y(): void {
  if (started) return;
  started = true;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      current = sanitizeA11y(JSON.parse(stored));
      hasStoredPref = true;
    } else {
      const legacy = localStorage.getItem(LEGACY_TEXT_KEY);
      if (legacy && LEGACY_TEXT[legacy]) current = { ...current, textScale: LEGACY_TEXT[legacy] as A11ySettings['textScale'] };
    }
  } catch {
    // defaults
  }
  try {
    mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    // Live: the player can flip the OS setting while the game is open.
    mql.addEventListener('change', () => { apply(); emit(); });
  } catch {
    mql = null;
  }
  apply();
}

export function getA11y(): Readonly<A11ySettings> {
  initA11y();
  return current;
}

export function setA11y(patch: Partial<A11ySettings>): void {
  initA11y();
  current = sanitizeA11y({ ...current, ...patch });
  persist();
  apply();
  emit();
}

/**
 * A save was loaded. This device's own preference wins when it has one (a phone's text size should not change because
 * a backup from another phone was restored); a device that never chose anything takes the save's block.
 */
export function hydrateA11y(fromSave: unknown): void {
  initA11y();
  if (hasStoredPref) return;
  if (fromSave && typeof fromSave === 'object') {
    current = sanitizeA11y(fromSave);
    apply();
    emit();
  }
}

/** Calls `fn` on every change; returns the unsubscribe. Not called for the current value: read it with getA11y. */
export function subscribeA11y(fn: Listener): () => void {
  initA11y();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// [plan4:AC-5] Flash budget (photosensitivity): the whole game may flash at most 3 times a second, whatever the effects do.
// ---------------------------------------------------------------------------------------------------------------------------------
/** Start times (s) of the last three granted flashes: a ring, so asking costs no allocation. */
const flashRing = new Float64Array(3).fill(-1e9);
let flashHead = 0;
/** For the debug/QA tool: how many flashes were granted and how many refused since the page started. */
export const flashStats = { granted: 0, denied: 0 };

/** The player asked for no flashes at all: every effect shows a steady tint (and its icon) instead. */
export function flashSafe(): boolean {
  return current.flash === 'safe';
}

/**
 * Asks to start a flash (a lightning stroke, an electric arc, a beacon beat). Returns true at most 3 times in any second across all
 * effects, and never in `flash: 'safe'`. `now` is in seconds and defaults to the wall clock; a test passes its virtual clock (or sets `window.__flashNow`).
 */
export function flashOk(_id: string, now: number = (globalThis as { __flashNow?: number }).__flashNow ?? performance.now() / 1000): boolean {
  if (current.flash === 'safe') { flashStats.denied++; return false; }
  // The oldest of the last three starts must be a second old or more.
  if (now - flashRing[flashHead] < 1) { flashStats.denied++; return false; }
  flashRing[flashHead] = now;
  flashHead = (flashHead + 1) % 3;
  flashStats.granted++;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// [plan4:AC-6] Status colours (good / warning / bad / info) per colour-vision mode. One table for the canvas (statusTint) and the
// stylesheets (--ok --warn --bad --info in a11y.css carry the same values): no hex for "good" or "bad" lives anywhere else.
// Colour is never the only signal: AC-7 adds an icon or a pattern next to every state.
// ---------------------------------------------------------------------------------------------------------------------------------
export type StatusKind = 'ok' | 'warn' | 'bad' | 'info';
type ColorMode = A11ySettings['colorMode'];

const STATUS: Record<ColorMode, Record<StatusKind, number>> = {
  none: { ok: 0x7dff9e, warn: 0xffb547, bad: 0xff5555, info: 0x6fc3ff },
  // Red-green deficiencies: blue / yellow / dark magenta separate on the blue-yellow axis they still see.
  deuter: { ok: 0x4aa3ff, warn: 0xffc83d, bad: 0xe0457b, info: 0x8fe0ff },
  protan: { ok: 0x4aa3ff, warn: 0xffc83d, bad: 0xe0457b, info: 0x8fe0ff },
  // Blue-yellow deficiency: teal / salmon / red / lilac separate on the red-green axis.
  tritan: { ok: 0x3ed0a8, warn: 0xff9f6b, bad: 0xff3d5a, info: 0xc7a6ff },
};

/** The colour (0xRRGGBB) of a state for Pixi tints and fills, in the player's colour mode. */
export function statusTint(kind: StatusKind): number {
  return STATUS[current.colorMode][kind];
}

/** The same colour as a CSS string, for the few DOM places that cannot use the --ok/--warn/--bad/--info tokens. */
export function statusCss(kind: StatusKind): string {
  return `#${statusTint(kind).toString(16).padStart(6, '0')}`;
}

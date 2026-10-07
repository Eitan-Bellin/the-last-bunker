import { getA11y, subscribeA11y } from '../utils/a11y';

// [plan4:ST-12 #3] Screen-space world text. The canvas text used to have a fixed world size (room names: 10 px), so at the old fit zoom (0.54 on a
// phone) a name was ~5 px tall on the glass. The size is now chosen in screen px and converted back to world units for the current zoom:
//   world size = clamp(11 / zoom, 8, 22), times the player's text size (a11y `--fs`, up to 1.4x, relative to the designed default 1.1).
// Below LABEL_ICON_ZOOM a room tag shows only its colour chip and worker lamps, below LABEL_HIDE_ZOOM nothing (the city map takes over then).
// One module-level state, shared by the room tags, the number popups and anyone else who wants text that stays readable; it is recomputed at most
// 10 times a second and only when the zoom (or the text size) changed, so a pinch costs a handful of scale writes, not one per picture.

export type LabelMode = 'full' | 'icon' | 'hidden';

/** Font size the room tags are drawn at (RoomViews.nameStyle); the tag container is scaled by size / BASE. */
export const LABEL_BASE_FONT = 10;
export const LABEL_SCREEN_PX = 11;
export const LABEL_MIN_WORLD = 8;
export const LABEL_MAX_WORLD = 22;
export const LABEL_ICON_ZOOM = 0.7;
export const LABEL_HIDE_ZOOM = 0.45;
/** Text size the screen px above were designed for (a11y TEXT_SCALES default); the setting scales them, capped at 1.4. */
const DESIGN_TEXT_SCALE = 1.1;
const MAX_TEXT_SCALE = 1.4;
const MIN_INTERVAL_MS = 100;

export interface LabelState {
  /** World font size of a room tag right now. */
  size: number;
  /** Scale to give a tag container drawn at LABEL_BASE_FONT. */
  k: number;
  mode: LabelMode;
  /** Bumped on every change: views compare it with their own stamp instead of being notified one by one. */
  rev: number;
}

export const labelState: LabelState = { size: LABEL_BASE_FONT, k: 1, mode: 'full', rev: 0 };

let textK = 1;
let lastZoom = -1;
let lastAt = -1e9;
let started = false;
let dirty = true;

function readText(): void {
  textK = Math.min(MAX_TEXT_SCALE, getA11y().textScale) / DESIGN_TEXT_SCALE;
}

/** The pure part: world font size for a zoom (and a text-size factor). */
export function labelWorldSize(zoom: number, textFactor = 1): number {
  return Math.max(LABEL_MIN_WORLD, Math.min(LABEL_MAX_WORLD, (LABEL_SCREEN_PX * textFactor) / Math.max(0.05, zoom)));
}

/** The pure part: what a tag shows at a zoom (`prev` adds hysteresis so a zoom hovering at a threshold does not flicker). */
export function labelModeFor(zoom: number, prev: LabelMode = 'full'): LabelMode {
  if (zoom < (prev === 'hidden' ? LABEL_HIDE_ZOOM * 1.05 : LABEL_HIDE_ZOOM)) return 'hidden';
  if (zoom < (prev === 'full' ? LABEL_ICON_ZOOM : LABEL_ICON_ZOOM * 1.04)) return 'icon';
  return 'full';
}

/**
 * Call every picture with the camera zoom; returns true when the shared state changed (zoom moved, text size changed).
 * Cheap when nothing moved (two compares); at most one real update per 100 ms.
 */
export function updateLabelScale(zoom: number, now: number): boolean {
  if (!started) {
    started = true;
    readText();
    subscribeA11y(() => { readText(); dirty = true; });
  }
  if (!dirty && Math.abs(zoom - lastZoom) < lastZoom * 0.01) return false;
  if (!dirty && now - lastAt < MIN_INTERVAL_MS) return false;
  dirty = false;
  lastZoom = zoom;
  lastAt = now;
  const size = labelWorldSize(zoom, textK);
  const mode = labelModeFor(zoom, labelState.mode);
  if (size === labelState.size && mode === labelState.mode) return false;
  labelState.size = size;
  labelState.k = size / LABEL_BASE_FONT;
  labelState.mode = mode;
  labelState.rev++;
  return true;
}

/**
 * Scale for floating world numbers (production popups, drawn at 14 px): never smaller than drawn, and grown so they stay about 13 px
 * on the glass when the camera is zoomed out. Uses the same text-size factor as the tags.
 */
export function popupScale(zoom: number): number {
  return Math.max(1, Math.min(1.7, (13 * textK) / (14 * Math.max(0.05, zoom))));
}

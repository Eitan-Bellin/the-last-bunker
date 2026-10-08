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
// [plan4:polish] was 8: zoomed in past 1.4 the tags then grew with the zoom (18 px on the glass at 2.3x) and long names spilled over the next room.
// 3.2 keeps them at their 11 screen px up to the camera's 3x zoom limit (and a little beyond).
export const LABEL_MIN_WORLD = 3.2;
/** [plan4:polish] The smallest a tag may be drawn on the glass when it has to shrink to fit its room (the readability floor). */
export const LABEL_FLOOR_SCREEN_PX = 10;
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
  /** [plan4:polish] The camera zoom the state was computed for (the tags fit themselves to their room with it). */
  zoom: number;
  /** Bumped on every change: views compare it with their own stamp instead of being notified one by one. */
  rev: number;
  /** [airy:B1] 0 (close, full painting) .. 1 (mid zoom, simplified: category colour, dim art, no lamp cones / dust). */
  clarity: number;
}

export const labelState: LabelState = { size: LABEL_BASE_FONT, k: 1, mode: 'full', zoom: 1, rev: 0, clarity: 0 };

/** [airy:B1] Mid-zoom simplification: none from this zoom up, full from CLARITY_FULL_ZOOM down (the far map takes over below 0.42). */
export const CLARITY_NONE_ZOOM = 0.95;
export const CLARITY_FULL_ZOOM = 0.6;
/** The pure part: how simplified the rooms are drawn at a zoom (smoothstep, 0..1). */
export function clarityFor(zoom: number): number {
  const t = Math.max(0, Math.min(1, (CLARITY_NONE_ZOOM - zoom) / (CLARITY_NONE_ZOOM - CLARITY_FULL_ZOOM)));
  return t * t * (3 - 2 * t);
}

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
  labelState.zoom = Math.max(0.05, zoom);
  const clarity = clarityFor(zoom);
  const clarityMoved = Math.abs(clarity - labelState.clarity) > 0.004;
  if (clarityMoved) labelState.clarity = clarity;
  if (size === labelState.size && mode === labelState.mode) return clarityMoved;
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

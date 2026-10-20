import type { Container } from 'pixi.js';

// [plan4:ST-12 #4] Touch targets of at least 44 screen px. A hit rectangle drawn in world units shrinks with the zoom (a person was 20 world px
// wide: 11 px on a phone at the old 0.54 zoom), so the real size is max(drawn size, 44 / zoom). The camera publishes its zoom here once per
// picture (one assignment); the areas read it only when a pointer event asks "is this point inside?", so nothing is recomputed per frame,
// nothing allocates, and a zoom change needs no notification. Empty-slot pads and rooms keep their own (large) areas.

/** Smallest touch target in screen px (Apple HIG / WCAG 2.5.5). */
export const MIN_HIT_PX = 44;

/** Current camera zoom (world to screen), written by BunkerRenderer every picture. */
export const hitState = { zoom: 1 };

/** The pure helper: a w x h world rectangle grown (about its centre) so that it measures at least `minPx` screen px each way. */
export function slop(w: number, h: number, zoom: number, scale = 1, minPx = MIN_HIT_PX): { w: number; h: number } {
  const m = minPx / Math.max(0.05, zoom * scale);
  return { w: Math.max(w, m), h: Math.max(h, m) };
}

/**
 * A Pixi `hitArea` (anything with contains()) whose size follows `slop`. `owner` is the container the area belongs to: its own scale
 * (people are drawn at 0.94-1.06 by depth) counts towards the screen size. Mutate with `set` when the drawn rectangle changes.
 */
export class SlopArea {
  x: number;
  y: number;
  w: number;
  h: number;
  private owner: Container | null;
  private minPx: number;

  constructor(x: number, y: number, w: number, h: number, owner: Container | null = null, minPx = MIN_HIT_PX) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.owner = owner;
    this.minPx = minPx;
  }

  set(x: number, y: number, w: number, h: number): this {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    return this;
  }

  contains(px: number, py: number): boolean {
    const s = slop(this.w, this.h, hitState.zoom, this.owner ? this.owner.scale.x : 1, this.minPx);
    return Math.abs(px - (this.x + this.w / 2)) <= s.w / 2 && Math.abs(py - (this.y + this.h / 2)) <= s.h / 2;
  }
}

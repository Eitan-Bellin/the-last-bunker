import { Container, type Graphics } from 'pixi.js';
import { BASE_EAST, type Position } from '../core/GameState';
import { statusTint } from '../utils/a11y';
import { ROOM_H, SLAB, SLOT_W, floorAtY, floorTop, slotAtX, slotX } from './geom';

// [plan4 X-1] Split out of BunkerRenderer.ts with no change in behaviour: the empty-slot tap pad (one tappable area that works out
// which slot was hit) and the green highlight of the slots where the room being placed fits.

/** What the placement layer needs from the renderer. */
export interface PlacementHost {
  /** The camera is dragging: a tap that ends a drag is not a tap on a slot. */
  isDragging(): boolean;
  /** A tap on an empty slot. */
  onTileClick(pos: Position): void;
}

/** Dash length (world px) of the frame around a slot that can take the room. */
const DASH = 7;

/** Traces a dashed rectangle outline into the pending path (the caller strokes it). Highlights are built once per placement, not per frame. */
export function dashedRect(g: Graphics, x: number, y: number, w: number, h: number, dash: number, gap: number): void {
  const edge = (x0: number, y0: number, x1: number, y1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      g.moveTo(x0 + ux * d, y0 + uy * d).lineTo(x0 + ux * e, y0 + uy * e);
    }
  };
  edge(x, y, x + w, y);
  edge(x + w, y, x + w, y + h);
  edge(x + w, y + h, x, y + h);
  edge(x, y + h, x, y);
}

export class PlacementController {
  private readonly host: PlacementHost;
  /** Holds the tap pad (rebuilt with the structure). */
  private readonly slotLayer: Container;
  /** Draws the valid-slot highlight. */
  private readonly highlightLayer: Graphics;
  /** [plan4:X-2] How far each floor reaches (slots x in [-w, e)); the classic 12 east until the renderer passes the saved layout. */
  private extentOf: (floor: number) => { w: number; e: number } = () => ({ w: 0, e: BASE_EAST });
  /** [plan4:ST-19] How many floors the pad covers (for slotAtWorld). */
  private floorCount = 0;

  constructor(host: PlacementHost, slotLayer: Container, highlightLayer: Graphics) {
    this.host = host;
    this.slotLayer = slotLayer;
    this.highlightLayer = highlightLayer;
  }

  /** Replaces the tap pad for a bunker of `floors` floors. */
  rebuildPad(floors: number, extentOf?: (floor: number) => { w: number; e: number }): void {
    if (extentOf) this.extentOf = extentOf;
    this.floorCount = floors;
    this.slotLayer.removeChildren().forEach(c => c.destroy());
    // [perf] The empty slots are one tappable area that works out which slot was hit, not 12 objects per floor (288 at 24 floors).
    const pad = new Container();
    const slotAt = (px: number, py: number): Position | null => this.slotAtWorld(px, py);
    pad.hitArea = { contains: (px: number, py: number) => slotAt(px, py) !== null };
    pad.eventMode = 'static';
    pad.cursor = 'pointer';
    pad.on('pointertap', e => {
      if (this.host.isDragging()) return;
      const p = pad.toLocal(e.global);
      const pos = slotAt(p.x, p.y);
      if (pos) this.host.onTileClick(pos);
    });
    this.slotLayer.addChild(pad);
  }

  /** [plan4:ST-19] The slot a world point falls in (null over the shaft, a slab, a gallery or outside what the floors reach). */
  slotAtWorld(px: number, py: number): Position | null {
    const s = slotAtX(px);
    const { floor: f, offset } = floorAtY(py);
    if (s === null || f < 0 || f >= this.floorCount || offset >= ROOM_H) return null;
    const ext = this.extentOf(f);
    if (s < -ext.w || s >= ext.e) return null;
    return { x: s, y: 0, floor: f };
  }

  /** [plan4:ST-19] Is a world point anywhere inside the bunker's outline (slots, shaft, slabs): a tap there is not a tap on "empty space". */
  insideBunker(px: number, py: number): boolean {
    if (this.floorCount <= 0) return false;
    let w = 0, e = BASE_EAST;
    for (let f = 0; f < this.floorCount; f++) { const x = this.extentOf(f); if (x.w > w) w = x.w; if (x.e > e) e = x.e; }
    return px >= slotX(-w) - 8 && px <= slotX(e) + 4 && py >= floorTop(0) - 6 && py <= floorTop(this.floorCount - 1) + ROOM_H + SLAB;
  }

  setHighlight(isValid: ((pos: Position) => boolean) | null, levels: number, floors: number): void {
    const g = this.highlightLayer;
    g.clear();
    if (!isValid) return;
    const H = levels * ROOM_H + (levels - 1) * SLAB;
    // [plan4:AC-6/7] The colour follows the player's colour mode, and a valid slot is a DASHED frame (an unavailable one would be dotted),
    // so the answer does not depend on telling green from red.
    const ok = statusTint('ok');
    for (let f = 0; f < floors; f++) {
      const ext = this.extentOf(f);
      for (let s = -ext.w; s < ext.e; s++) {
        if (!isValid({ x: s, y: 0, floor: f })) continue;
        const x = slotX(s), y = floorTop(f);
        g.rect(x + 2, y + 2, SLOT_W - 4, H - 4).fill({ color: ok, alpha: 0.18 });
        dashedRect(g, x + 2, y + 2, SLOT_W - 4, H - 4, DASH, DASH * 0.6);
        g.stroke({ color: ok, alpha: 0.85, width: 1.5 });
        g.moveTo(x + SLOT_W / 2 - 6, y + ROOM_H / 2).lineTo(x + SLOT_W / 2 + 6, y + ROOM_H / 2).stroke({ color: ok, width: 2 });
        g.moveTo(x + SLOT_W / 2, y + ROOM_H / 2 - 6).lineTo(x + SLOT_W / 2, y + ROOM_H / 2 + 6).stroke({ color: ok, width: 2 });
      }
    }
  }

  /** Clears the highlight (a new scene). */
  clearHighlight(): void {
    this.highlightLayer.clear();
  }
}

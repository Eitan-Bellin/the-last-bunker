import { Container, type Graphics } from 'pixi.js';
import { BASE_EAST, type Position } from '../core/GameState';
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

export class PlacementController {
  private readonly host: PlacementHost;
  /** Holds the tap pad (rebuilt with the structure). */
  private readonly slotLayer: Container;
  /** Draws the valid-slot highlight. */
  private readonly highlightLayer: Graphics;
  /** [plan4:X-2] How far each floor reaches (slots x in [-w, e)); the classic 12 east until the renderer passes the saved layout. */
  private extentOf: (floor: number) => { w: number; e: number } = () => ({ w: 0, e: BASE_EAST });

  constructor(host: PlacementHost, slotLayer: Container, highlightLayer: Graphics) {
    this.host = host;
    this.slotLayer = slotLayer;
    this.highlightLayer = highlightLayer;
  }

  /** Replaces the tap pad for a bunker of `floors` floors. */
  rebuildPad(floors: number, extentOf?: (floor: number) => { w: number; e: number }): void {
    if (extentOf) this.extentOf = extentOf;
    this.slotLayer.removeChildren().forEach(c => c.destroy());
    // [perf] The empty slots are one tappable area that works out which slot was hit, not 12 objects per floor (288 at 24 floors).
    const pad = new Container();
    const slotAt = (px: number, py: number): Position | null => {
      const s = slotAtX(px);
      const { floor: f, offset } = floorAtY(py);
      if (s === null || f < 0 || f >= floors || offset >= ROOM_H) return null;
      const ext = this.extentOf(f);
      if (s < -ext.w || s >= ext.e) return null;
      return { x: s, y: 0, floor: f };
    };
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

  setHighlight(isValid: ((pos: Position) => boolean) | null, levels: number, floors: number): void {
    const g = this.highlightLayer;
    g.clear();
    if (!isValid) return;
    const H = levels * ROOM_H + (levels - 1) * SLAB;
    for (let f = 0; f < floors; f++) {
      const ext = this.extentOf(f);
      for (let s = -ext.w; s < ext.e; s++) {
        if (!isValid({ x: s, y: 0, floor: f })) continue;
        const x = slotX(s), y = floorTop(f);
        g.rect(x + 2, y + 2, SLOT_W - 4, H - 4).fill({ color: 0x44ff88, alpha: 0.18 });
        g.rect(x + 2, y + 2, SLOT_W - 4, H - 4).stroke({ color: 0x7affb0, alpha: 0.8, width: 1.5 });
        g.moveTo(x + SLOT_W / 2 - 6, y + ROOM_H / 2).lineTo(x + SLOT_W / 2 + 6, y + ROOM_H / 2).stroke({ color: 0x7affb0, width: 2 });
        g.moveTo(x + SLOT_W / 2, y + ROOM_H / 2 - 6).lineTo(x + SLOT_W / 2, y + ROOM_H / 2 + 6).stroke({ color: 0x7affb0, width: 2 });
      }
    }
  }

  /** Clears the highlight (a new scene). */
  clearHighlight(): void {
    this.highlightLayer.clear();
  }
}

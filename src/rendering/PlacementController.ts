import { Container, type Graphics } from 'pixi.js';
import type { Position } from '../core/GameState';
import { SLOTS_PER_FLOOR } from '../systems/BuildingSystem';
import { FLOOR_H, ROOM_H, SLAB, SLOT_W, floorTop, slotX } from './layout';

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

  constructor(host: PlacementHost, slotLayer: Container, highlightLayer: Graphics) {
    this.host = host;
    this.slotLayer = slotLayer;
    this.highlightLayer = highlightLayer;
  }

  /** Replaces the tap pad for a bunker of `floors` floors. */
  rebuildPad(floors: number): void {
    this.slotLayer.removeChildren().forEach(c => c.destroy());
    // [perf] The empty slots are one tappable area that works out which slot was hit, not 12 objects per floor (288 at 24 floors).
    const pad = new Container();
    const slotAt = (px: number, py: number): Position | null => {
      const s = Math.floor((px - slotX(0)) / SLOT_W);
      const f = Math.floor((py - floorTop(0)) / FLOOR_H);
      if (s < 0 || s >= SLOTS_PER_FLOOR || f < 0 || f >= floors || py - floorTop(f) >= ROOM_H) return null;
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
      for (let s = 0; s < SLOTS_PER_FLOOR; s++) {
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

import { Container, Graphics, type FederatedPointerEvent, type Texture } from 'pixi.js';
import type { BuildingType, Position } from '../core/GameState';
import { getDef, roomSlots } from '../data/buildingDefs';
import { ArtLibrary } from '../art/ArtLibrary';
import { artEntry, buildingArtKey } from '../art/registry';
import { statusTint, reducedMotion } from '../utils/a11y';
import { SLOT_W, buildingH, floorTop, slotX } from './geom';
import { hashString, seeded } from './draw';
import { buildPaintedRoom } from './paintedRoom';
import { buildRoomVisual } from './roomArt';
import { buildSurfaceBlock } from './surfaceRow'; // plan4:ST-16
import { dashedRect } from './PlacementController';
import { depthGains } from './structure';

// [plan4:ST-19] The ghost of the room being placed: the room's own painting (or its drawn stand-in) at alpha 0.6 on the chosen spot, in a green
// dashed frame when it can stand there and a red solid frame with a cross when it cannot (so the answer is not colour alone). It glides to a new
// spot instead of jumping, and "shakes" when a spot is refused (no shake under reduced motion).

/** Painting alpha of the ghost. */
const GHOST_ALPHA = 0.6;
/** Seconds a refusal shakes. */
const SHAKE_SECONDS = 0.32;

export class PlacementGhost {
  /** Goes into the world container (above the rooms). */
  readonly layer = new Container();
  private readonly root = new Container();
  private readonly art = new Container();
  private readonly mark = new Graphics();
  private type: BuildingType | null = null;
  private pos: Position = { x: 0, y: 0, floor: 0 };
  private ok = true;
  private w = 0;
  private h = 0;
  /** Where the ghost is drawn right now (it glides to its spot). */
  private curX = 0;
  private curY = 0;
  private shakeT = 0;
  private artKey: string | null = null;
  /** The painting the ghost shows now (null while it wears the drawn stand-in): the library must not release it, and a new copy replaces it. */
  private paintedTex: Texture | null = null;
  private artWait = 0;
  private markSig = '';
  /** The player pressed on the ghost (the renderer starts a drag). */
  onDown: ((e: FederatedPointerEvent, grabX: number, grabY: number) => void) | null = null;

  constructor() {
    this.layer.eventMode = 'passive';
    this.layer.visible = false;
    this.root.addChild(this.art, this.mark);
    this.art.alpha = GHOST_ALPHA;
    this.art.eventMode = 'none';
    this.mark.eventMode = 'none';
    this.root.eventMode = 'static';
    this.root.cursor = 'grab';
    this.root.on('pointerdown', (e: FederatedPointerEvent) => {
      const p = this.layer.toLocal(e.global);
      this.onDown?.(e, p.x - this.curX, p.y - this.curY);
    });
    this.layer.addChild(this.root);
  }

  get active(): boolean { return this.layer.visible; }

  get spot(): Position | null { return this.layer.visible ? this.pos : null; }

  /** The painting in use (the renderer's memory sweep must leave it alone), or null. */
  get paintingKey(): string | null {
    return this.layer.visible && this.paintedTex ? this.artKey : null;
  }

  /** World rectangle the ghost occupies (at its target spot). */
  rect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.layer.visible || !this.type) return null;
    return { x: slotX(this.pos.x), y: floorTop(this.pos.floor), w: this.w, h: this.h };
  }

  /** Shows the ghost of `type` on a spot (`jump` = no glide: first appearance). */
  show(type: BuildingType, pos: Position, ok: boolean): void {
    const fresh = !this.layer.visible || this.type !== type;
    this.pos = { x: pos.x, y: 0, floor: pos.floor };
    if (this.type !== type) this.buildArt(type);
    this.type = type;
    this.ok = ok;
    this.w = roomSlots(type) * SLOT_W;
    this.h = buildingH(type);
    this.root.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= this.w && y >= 0 && y <= this.h };
    if (fresh || reducedMotion()) {
      this.curX = slotX(pos.x);
      this.curY = floorTop(pos.floor);
    }
    this.layer.visible = true;
    this.drawMark();
    this.place(0);
  }

  hide(): void {
    this.layer.visible = false;
    this.type = null;
    this.artKey = null;
    this.paintedTex = null;
    this.art.removeChildren().forEach(c => c.destroy({ children: true }));
  }

  /** Refused spot: a short horizontal shake. */
  shake(): void {
    if (!reducedMotion()) this.shakeT = SHAKE_SECONDS;
  }

  /** Per picture: glide, shake, and swap the stand-in for the painting once it has loaded. */
  update(dt: number): void {
    if (!this.layer.visible || !this.type) return;
    // The library gave the painting up and loaded it again (a memory sweep, a lost context): the ghost must hold the live copy.
    if (this.paintedTex && this.artKey && ArtLibrary.get(this.artKey) !== this.paintedTex) this.buildArt(this.type);
    if (this.artWait > 0 && (this.artWait -= dt) <= 0) {
      const key = buildingArtKey(this.type, 0);
      if (key && ArtLibrary.get(key)) this.buildArt(this.type);
      else this.artWait = 0.4;
    }
    this.place(dt);
  }

  private place(dt: number): void {
    const tx = slotX(this.pos.x), ty = floorTop(this.pos.floor);
    if (dt > 0 && !reducedMotion()) {
      const k = 1 - Math.exp(-dt * 20);
      this.curX += (tx - this.curX) * k;
      this.curY += (ty - this.curY) * k;
      if (Math.abs(tx - this.curX) < 0.3) this.curX = tx;
      if (Math.abs(ty - this.curY) < 0.3) this.curY = ty;
    } else if (dt > 0) {
      this.curX = tx;
      this.curY = ty;
    }
    let sx = 0;
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      sx = Math.sin(this.shakeT * 70) * 5 * (this.shakeT / SHAKE_SECONDS);
    }
    this.root.position.set(this.curX + sx, this.curY);
  }

  /** True while the ghost still moves (the engine keeps drawing at the motion rate). */
  get moving(): boolean {
    return this.layer.visible && (this.shakeT > 0 || Math.abs(slotX(this.pos.x) - this.curX) > 0.3 || Math.abs(floorTop(this.pos.floor) - this.curY) > 0.3);
  }

  private buildArt(type: BuildingType): void {
    this.art.removeChildren().forEach(c => c.destroy({ children: true }));
    this.paintedTex = null;
    const w = roomSlots(type) * SLOT_W, h = buildingH(type);
    const outdoors = getDef(type)?.place?.floors === 'surface'; // plan4:ST-16 a surface-only room is a structure outdoors, never an interior painting
    const key = outdoors ? null : buildingArtKey(type, 0);
    const tex = key ? ArtLibrary.get(key) : null;
    const rnd = seeded(hashString(`ghost-${type}`));
    let container: Container;
    if (tex && key) {
      const bal = ArtLibrary.balanceFor(key);
      const d = depthGains(floorTop(this.pos.floor) + h / 2);
      const gains = [bal[0] * d[0], bal[1] * d[1], bal[2] * d[2]].map(x => Math.min(1, x)) as [number, number, number];
      container = buildPaintedRoom(tex, artEntry(key)!, w, false, false, false, rnd, h, gains).container;
      this.paintedTex = tex;
      this.artWait = 0;
    } else {
      container = (outdoors ? buildSurfaceBlock(type, w, false, hashString(`ghost-${type}`)) : buildRoomVisual(type, w, false, false, rnd)).container; // plan4:ST-16
      this.artWait = key ? 0.4 : 0; // the painting is on its way: swap it in when it arrives
    }
    this.artKey = key ?? '';
    this.art.addChild(container);
  }

  /** The frame: green dashes when valid, red solid with a cross when not. Redrawn only when the answer or the size changes. */
  private drawMark(): void {
    const sig = `${this.ok}|${this.w}|${this.h}`;
    if (sig === this.markSig) return;
    this.markSig = sig;
    const g = this.mark;
    g.clear();
    const { w, h } = this;
    if (this.ok) {
      const c = statusTint('ok');
      dashedRect(g, 1.5, 1.5, w - 3, h - 3, 7, 4);
      g.stroke({ color: c, alpha: 0.95, width: 2 });
      return;
    }
    const c = statusTint('bad');
    g.rect(0, 0, w, h).fill({ color: c, alpha: 0.28 });
    g.rect(1.5, 1.5, w - 3, h - 3).stroke({ color: c, alpha: 0.95, width: 2.5 });
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.16;
    g.moveTo(cx - r, cy - r).lineTo(cx + r, cy + r).moveTo(cx + r, cy - r).lineTo(cx - r, cy + r).stroke({ color: c, alpha: 1, width: 4, cap: 'round' });
  }
}

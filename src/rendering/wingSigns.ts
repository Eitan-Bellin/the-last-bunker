import { Container, Graphics, Rectangle } from 'pixi.js';
import { BASE_EAST, ROOM_H, floorTop, slotX, type Ext } from './geom';
import { richLine } from './richText';
import { GFX } from './gfxFeatures';
import { VIEW } from './perfFx';
import { steelTag } from './signage';
import type { WingOption } from './wingsApi';

/**
 * [plan4:ST-4] Dig signs at the open ends of the floors: a small steel plate under a strip of hazard tape with "+2" and the price, planted in the casing at
 * the end of a floor that can still grow (the east end, and the west end: beside the shaft while the floor has no wing). A tap calls `onDig(floor, side)`.
 * Cheap by design: a sign is built the first time its floor comes into view and kept; only signs inside the camera's rectangle are shown, a plain
 * visibility toggle per picture over at most two per floor.
 */

const SIGN_W = 26;
const SIGN_H = 33;
/** What a resource's price tag shows (the names of the HUD's icon tokens). */
const ICON: Record<string, string> = { data: 'chart', influence: 'crown', seedCores: 'clover' };

interface Sign {
  key: string;
  floor: number;
  side: 'w' | 'e';
  x: number;
  y: number;
  label: string;
  node: Container | null;
  shown: boolean;
}

export class WingSigns {
  readonly container = new Container();
  private signs = new Map<string, Sign>();
  /** The same signs as an array: the per-picture loop must not allocate an iterator. */
  private list: Sign[] = [];
  private options: WingOption[] = [];
  onDig: ((floor: number, side: 'w' | 'e') => void) | null = null;

  private readonly isDragging: () => boolean;

  constructor(isDragging: () => boolean) {
    this.isDragging = isDragging;
    this.container.label = 'wingSigns';
    this.container.isRenderGroup = true;
    this.container.eventMode = 'passive';
  }

  /** The signs that exist: one per option, at the open end of its floor. Rebuilt only for options that changed. */
  set(options: readonly WingOption[], exts: readonly Ext[]): void {
    const keep = new Set<string>();
    // [airy2:D3] With the stair annex beside the shaft (airy, no west wing anywhere) the sign moves out to the rock west of it.
    const westX = GFX.airy && exts.length > 0 && exts.every(e => e.w === 0) ? -64 : -15;
    this.options = options.slice();
    for (const o of options) {
      const ext = exts[o.floor] ?? { w: 0, e: BASE_EAST };
      const key = `${o.floor}${o.side}`;
      const x = o.side === 'e' ? slotX(ext.e) + 7 : ext.w > 0 ? slotX(-ext.w) - 7 : westX;
      const y = floorTop(o.floor) + ROOM_H * 0.4;
      const cost = Object.entries(o.cost).slice(0, 2).map(([k, v]) => `[[${ICON[k] ?? k}]] ${v}`).join('  ');
      const label = `${x}|${y}|+${o.steps}|${cost}|${o.block ?? ''}`;
      keep.add(key);
      const old = this.signs.get(key);
      if (old && old.label === label) continue;
      old?.node?.destroy({ children: true });
      this.signs.set(key, { key, floor: o.floor, side: o.side, x, y, label, node: null, shown: false });
    }
    for (const [key, s] of this.signs) {
      if (keep.has(key)) continue;
      s.node?.destroy({ children: true });
      this.signs.delete(key);
    }
    this.list = [...this.signs.values()];
  }

  private build(s: Sign, o: WingOption): Container {
    const root = new Container();
    root.position.set(s.x, s.y);
    const g = new Graphics();
    // A steel plate under a strip of hazard tape (the tape is on top, slightly crooked, as it was hung by hand).
    steelTag(g, -SIGN_W / 2, -SIGN_H / 2, SIGN_W, SIGN_H, { rivets: 4 });
    const tape = new Graphics();
    tape.rect(-SIGN_W / 2 - 1, -4, SIGN_W + 2, 5).fill(0xd9a441);
    for (let x = -SIGN_W / 2 - 2; x < SIGN_W / 2 + 2; x += 6) tape.poly([x, -4, x + 3, -4, x - 0.5, 1, x - 3.5, 1]).fill(0x1a1612);
    tape.position.y = -SIGN_H / 2 + 1;
    tape.rotation = s.side === 'e' ? -0.05 : 0.05;
    const plus = richLine(`+${o.steps}`, { fontFamily: 'Rubik, sans-serif', fontSize: 11, fontWeight: '700', fill: 0xffd447 }, 11, false, 4);
    plus.position.set(0, -SIGN_H / 2 + 14);
    const price = richLine(Object.entries(o.cost).slice(0, 2).map(([k, v]) => `[[${ICON[k] ?? k}]] ${v}`).join('  '), { fontFamily: 'Rubik, sans-serif', fontSize: 6.5, fontWeight: '700', fill: 0xf2e6c8 }, 7, false, 4);
    price.position.set(0, -SIGN_H / 2 + 25);
    const maxW = SIGN_W - 3;
    const pw = (price as Container & { lineWidth?: number }).lineWidth ?? 0;
    if (pw > maxW) price.scale.set(maxW / pw);
    root.addChild(g, tape, plus, price);
    root.alpha = o.block ? 0.62 : 1;
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(-24, -SIGN_H / 2 - 6, 48, SIGN_H + 12);
    root.on('pointertap', () => {
      if (!this.isDragging()) this.onDig?.(s.floor, s.side);
    });
    return root;
  }

  /** Per picture: build the signs whose floor came into view and show exactly the ones in the camera's rectangle. */
  update(hidden: boolean): void {
    this.container.visible = !hidden;
    if (hidden) return;
    const { x0, y0, x1, y1 } = VIEW;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      const show = s.y + SIGN_H > y0 && s.y - SIGN_H < y1 && s.x + SIGN_W > x0 && s.x - SIGN_W < x1;
      if (show && !s.node) {
        const o = this.options.find(q => q.floor === s.floor && q.side === s.side);
        if (!o) continue;
        s.node = this.build(s, o);
        this.container.addChild(s.node);
      }
      if (s.node && show !== s.shown) {
        s.shown = show;
        s.node.visible = show;
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

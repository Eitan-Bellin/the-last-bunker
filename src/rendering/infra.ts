import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { GameState } from '../core/GameState';
import { glowTexture } from '../art/ArtLibrary';
import { i18n } from '../i18n/I18nManager';
import { GFX, gfxLevel } from './gfxFeatures';
import { BASE_EAST, ROOMS_X, ROOM_H, SHAFT_GAP, SLAB, SLAB_CLASSIC, SLOT_W, floorTop, slotX, type Ext } from './geom';
import { VIEW } from './perfFx';
import { hashString } from './draw';
import { occupancy } from './occupancy';
import { DOOR_H, DOOR_W, openingsOfFloor } from './openings';
import { LIP, PIPES_H, PIPES_Y, depthGains, type KitState } from './structure';
import { reducedMotion, statusTint } from '../utils/a11y'; // plan4:AC-2/AC-6
import { bulkheadLeafTexture, fanTexture, sealedSignTexture, stairsTexture, strapsTexture, ventTexture } from './infraArt';
import type { Animated } from './world';

/** [airy:A6] The stairwell and vent art are baked 116 tall (a 16 slab): a taller slab stretches them, so the pieces placed by hand on them move with it. */
const ART_K = (ROOM_H + SLAB) / (ROOM_H + SLAB_CLASSIC);

/**
 * [plan4:ST-14/ST-15/ST-17] The bunker's infrastructure drawn from the raw shape of the state, so it works before (and without) the systems that build it:
 *  - bulkhead doors: `state.layout.doors['floor:boundary']` = 'open' | 'closed' | 'sealed', and every `layout.infra` item of kind 'bulkhead'. A heavy steel
 *    leaf in a steel frame, swinging shut or open in 0.5 s (cosmetic; snaps at Low), a red lamp (breathing slowly, never a hard flash) while closed, a green
 *    one while open, welded straps and a SEALED sign when sealed;
 *  - stairwells (`infra` kind 'stairwell', `floors` levels from `floor`): a switchback of steel flights in a slot, handrail, a red emergency lamp that breathes;
 *  - ventilation stacks (`infra` kind 'ventStack'): a round duct through the slot and the slabs, a fan in a cowl on the top level that spins with the power;
 *  - feed lines (ST-17): on every level with a wing, a red power cable and a blue water cable under the ceiling bundle from the shaft to the end of the rooms,
 *    with a junction box at every doorway; a closed or sealed bulkhead cuts both lines at its door: beyond it they go dead (dark, with a red LED).
 * One layer, rebuilt on its own whenever the set of doors / infra items changes (`sync`, called every picture with the live state, is a few string compares);
 * the state of each door is read every picture. Only what is in the camera's view is touched.
 */

type DoorState = 'open' | 'closed' | 'sealed';

const strCache = new Map<string, number>();
/** Hash of a short string, remembered (the same few ids, kinds and door keys every picture). */
const strN = (s: string): number => {
  let v = strCache.get(s);
  if (v === undefined) { v = hashString(s); strCache.set(s, v); }
  return v;
};
const mixN = (h: number, v: number): number => Math.imul(h ^ (v | 0), 16777619) >>> 0;
type InfraItem = GameState['layout']['infra'][number];

interface Ctx {
  floors: number;
  exts: readonly Ext[];
  st: KitState;
  /** The light the infrastructure sits in (0..1): the era's ambient, as for the rest of the structure. */
  ambient: number;
}

interface DoorView {
  key: string;
  floor: number;
  slot: number;
  x: number;
  y0: number;
  y1: number;
  leaf: Sprite;
  straps: Sprite;
  sign: Sprite;
  lamp: Sprite;
  glow: Sprite;
  /** Closing progress: 0 = open, 1 = closed (animates toward the state's target in 0.5 s). */
  p: number;
  state: DoorState;
  hinge: number;
}

interface Section { s: Sprite; glow?: Sprite; floor: number; y0: number; y1: number; ph: number }
interface Fan { s: Sprite; floor: number; y0: number; y1: number; angle: number }
interface LineSet { floor: number; g: Graphics; y0: number; y1: number }

/** The door passage the frames of frontChunks cut (9.6 wide, 45 high from the floor line). */
const PASS_W = DOOR_W;
const PASS_H = DOOR_H;
const TURN_S = 0.5;
const parseKey = (key: string): { floor: number; slot: number } | null => {
  const i = key.indexOf(':');
  if (i < 0) return null;
  const floor = Number(key.slice(0, i)), slot = Number(key.slice(i + 1));
  return Number.isFinite(floor) && Number.isFinite(slot) ? { floor, slot } : null;
};

export class InfraLayer implements Animated {
  readonly container = new Container();
  private ctx: Ctx | null = null;
  private state: Pick<GameState, 'layout' | 'buildings' | 'ruins' | 'currentFloors'> | null = null;
  private sig = -1;
  private doorSig = -1;
  private doors: DoorView[] = [];
  private sections: Section[] = [];
  private fans: Fan[] = [];
  private lines: LineSet[] = [];
  private lastT = 0;
  private lastPower = 1;

  constructor() {
    this.container.label = 'infra';
    this.container.eventMode = 'none';
  }

  /** Tells the layer what it is drawn for (after the structure was rebuilt) and builds it. */
  set(state: Pick<GameState, 'layout' | 'buildings' | 'ruins' | 'currentFloors'>, ctx: Ctx): void {
    this.ctx = ctx;
    this.state = state;
    this.rebuild();
  }

  /** Every picture: rebuild when the set of doors or infra items changed, redraw the feed lines when a door changed state. */
  sync(state: Pick<GameState, 'layout' | 'buildings' | 'ruins' | 'currentFloors'>): void {
    this.state = state;
    if (!this.ctx) return;
    const sig = this.structureSig();
    if (sig !== this.sig) this.rebuild();
    else {
      const ds = this.doorStatesSig();
      if (ds !== this.doorSig) {
        this.doorSig = ds;
        this.drawLines();
      }
    }
  }

  /**
   * What the layer is built from, as one number (this runs every picture, so no strings are made): the level count and kit, the switches, the infra items, the
   * keys of the doors, the reach of every floor (the wings decide where the feed lines run) and how many rooms stand.
   */
  private structureSig(): number {
    const l = this.state?.layout;
    const c = this.ctx;
    if (!l || !c) return 0;
    let h = mixN(mixN(mixN(2166136261, c.floors), strN(c.st)), (GFX.bulkheads ? 1 : 0) | (GFX.branches ? 2 : 0) | (gfxLevel() === 'low' ? 4 : 0));
    for (const it of l.infra) h = mixN(mixN(mixN(mixN(mixN(mixN(h, strN(it.id)), strN(it.kind)), it.floor + 8), it.x + 64), (it.floors ?? 1) + 1), 7);
    for (const k in l.doors) h = mixN(h, strN(k));
    for (let i = 0; i < c.exts.length; i++) h = mixN(mixN(h, c.exts[i].w + 64), c.exts[i].e + 64);
    return mixN(h, this.state!.buildings.length);
  }

  /** The states of the doors as one number (read every picture; a change redraws the feed lines). */
  private doorStatesSig(): number {
    const d = this.state?.layout?.doors;
    let h = 2166136261;
    if (!d) return h;
    for (const k in d) h = mixN(mixN(h, strN(k)), strN(d[k]));
    return h;
  }

  private clear(): void {
    this.container.removeChildren().forEach(c => c.destroy({ children: true }));
    this.doors = [];
    this.sections = [];
    this.fans = [];
    this.lines = [];
  }

  private rebuild(): void {
    this.clear();
    if (!this.ctx || !this.state) return;
    this.sig = this.structureSig();
    this.doorSig = this.doorStatesSig();
    const { floors, st, ambient } = this.ctx;
    const l = this.state.layout;
    const lit = Math.min(0.95, ambient * (st === 'R' ? 1.8 : st === 'F' ? 1.25 : 1) * 0.95);
    const tintAt = (y: number, v = lit): number => {
      const [r, g, b] = depthGains(y);
      const c = (k: number) => Math.round(255 * Math.max(0, Math.min(1, v * k)));
      return (c(r) << 16) | (c(g) << 8) | c(b);
    };
    const glow = glowTexture();
    if (GFX.bulkheads) {
      const items = l.infra.filter(it => it.floor >= 0 && it.floor < floors);
      // Stairwells and vent stacks first (behind the doors).
      for (const it of items) {
        if (it.kind === 'stairwell') this.addStairwell(it, tintAt, glow);
        else if (it.kind === 'ventStack') this.addVent(it, tintAt);
      }
      // Bulkhead doors: every key of layout.doors plus every infra bulkhead (a door without a state is open).
      const keys = new Set<string>();
      for (const k in l.doors) keys.add(k);
      for (const it of items) if (it.kind === 'bulkhead') keys.add(`${it.floor}:${it.x}`);
      for (const k of keys) {
        const p = parseKey(k);
        if (p && p.floor >= 0 && p.floor < floors) this.addDoor(k, p.floor, p.slot, tintAt, glow);
      }
    }
    if (GFX.branches) this.addLines();
    this.drawLines();
  }

  // ------------------------------------------------------------------------------------------------ stairwell and vent stack

  private addStairwell(it: InfraItem, tintAt: (y: number, v?: number) => number, glow: Texture): void {
    const n = Math.max(1, Math.min(24, it.floors ?? 1));
    const tex = stairsTexture();
    for (let i = 0; i < n; i++) {
      const f = it.floor + i;
      if (f >= (this.ctx?.floors ?? 0)) break;
      const top = floorTop(f);
      const s = new Sprite(tex);
      s.position.set(slotX(it.x), top);
      s.width = SLOT_W;
      s.height = ROOM_H + SLAB;
      s.tint = tintAt(top + ROOM_H / 2, 0.8);
      // The red emergency lamp breathes: an additive glow over the lens (the lens sits at 9.4, 19.3 of the section).
      const g = new Sprite(glow);
      g.anchor.set(0.5);
      g.tint = 0xff4a38;
      g.blendMode = 'add';
      g.width = 44;
      g.height = 34;
      g.alpha = 0.4;
      g.position.set(slotX(it.x) + 9.4, top + 19.3 * ART_K);
      this.container.addChild(s, g);
      this.sections.push({ s, glow: g, floor: f, y0: top, y1: top + ROOM_H + SLAB, ph: (it.x * 1.7 + f * 0.9) % 6.28 });
    }
  }

  private addVent(it: InfraItem, tintAt: (y: number, v?: number) => number): void {
    const n = Math.max(1, Math.min(24, it.floors ?? 1));
    for (let i = 0; i < n; i++) {
      const f = it.floor + i;
      if (f >= (this.ctx?.floors ?? 0)) break;
      const top = floorTop(f);
      const first = i === 0;
      const s = new Sprite(ventTexture(first));
      s.position.set(slotX(it.x), top);
      s.width = SLOT_W;
      s.height = ROOM_H + SLAB;
      s.tint = tintAt(top + ROOM_H / 2);
      this.container.addChild(s);
      this.sections.push({ s, floor: f, y0: top, y1: top + ROOM_H + SLAB, ph: 0 });
      if (first) {
        const fan = new Sprite(fanTexture());
        fan.anchor.set(0.5);
        fan.position.set(slotX(it.x) + 23, top + 24 * ART_K);
        fan.width = fan.height = 20;
        fan.tint = tintAt(top + 24 * ART_K);
        this.container.addChild(fan);
        this.fans.push({ s: fan, floor: f, y0: top, y1: top + ROOM_H, angle: (it.x * 0.7) % 6.28 });
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ bulkhead doors

  private addDoor(key: string, floor: number, slot: number, tintAt: (y: number, v?: number) => number, glow: Texture): void {
    const x = slotX(slot);
    const top = floorTop(floor);
    const floorY = top + ROOM_H - LIP;
    const y1 = floorY, y0 = floorY - PASS_H;
    const tint = tintAt(top + ROOM_H / 2, 0.9);
    // The frame: the dark passage with the warm light of the rooms behind it, heavy jambs, a deep lintel with the lamp housing, a sill plate.
    const fr = new Graphics();
    const steel = (c: number) => {
      const [r, g, b] = depthGains(top + ROOM_H / 2);
      const k = 0.55 + 0.45 * Math.min(1, (this.ctx?.ambient ?? 0.5) * 1.6);
      const ch = (sh: number, v: number) => Math.round(Math.min(255, ((c >> sh) & 255) * v * k));
      return (ch(16, r) << 16) | (ch(8, g) << 8) | ch(0, b);
    };
    fr.rect(x - PASS_W / 2, y0, PASS_W, PASS_H).fill(0x110e0a);
    for (let k = 0; k < 6; k++) fr.rect(x - PASS_W / 2, y0 + PASS_H * (0.3 + k * 0.115), PASS_W, PASS_H * (0.7 - k * 0.115)).fill({ color: k < 3 ? 0x2c2012 : 0xffb868, alpha: k < 3 ? 0.16 : 0.07 });
    fr.rect(x - 7.6, y0 - 6, 3, PASS_H + 6).fill(steel(0x7e8488));
    fr.rect(x + 4.6, y0 - 6, 3, PASS_H + 6).fill(steel(0x6c7276));
    fr.rect(x - 7.6, y0 - 6, 0.9, PASS_H + 6).fill({ color: 0xffffff, alpha: 0.18 });
    fr.rect(x - 9, y0 - 8.4, 18, 8).fill(steel(0x80868a));
    fr.rect(x - 9, y0 - 8.4, 18, 1.2).fill({ color: 0xffffff, alpha: 0.22 });
    fr.rect(x - 9, y0 - 1.6, 18, 1.2).fill({ color: 0x000000, alpha: 0.42 });
    fr.rect(x - 9, y1 - 2.2, 18, 2.2).fill(steel(0x30363a));
    for (const bx of [-7.8, 7.8]) {
      fr.circle(x + bx, y0 - 4.6, 0.7).fill(steel(0x2a2e30));
      fr.circle(x + bx, y1 - 1.1, 0.7).fill(steel(0x1a1c1e));
    }
    fr.roundRect(x - 3.2, y0 - 7.2, 6.4, 4.4, 0.8).fill(0x14120f);
    this.container.addChild(fr);

    const leaf = new Sprite(bulkheadLeafTexture());
    leaf.position.set(x - PASS_W / 2, y0);
    leaf.width = PASS_W;
    leaf.height = PASS_H;
    leaf.tint = tint;
    const straps = new Sprite(strapsTexture());
    straps.position.set(x - PASS_W / 2, y0);
    straps.width = PASS_W;
    straps.height = PASS_H;
    straps.tint = tint;
    straps.visible = false;
    const sign = new Sprite(sealedSignTexture(i18n.t('bulkhead.sealed')));
    sign.anchor.set(0.5);
    sign.position.set(x, y0 + PASS_H * 0.5);
    sign.width = 14;
    sign.height = 5.2;
    sign.rotation = -0.05;
    sign.tint = tint;
    sign.visible = false;
    const lamp = new Sprite(glow);
    lamp.anchor.set(0.5);
    lamp.position.set(x, y0 - 5);
    lamp.width = lamp.height = 4;
    const lg = new Sprite(glow);
    lg.anchor.set(0.5);
    lg.blendMode = 'add';
    lg.position.set(x, y0 - 5);
    lg.width = 30;
    lg.height = 26;
    this.container.addChild(leaf, straps, sign, lg, lamp);
    const dv: DoorView = { key, floor, slot, x, y0, y1, leaf, straps, sign, lamp, glow: lg, p: 0, state: 'open', hinge: x - PASS_W / 2 };
    // Born in its state (no swing when the picture is first built).
    dv.state = this.readDoor(key);
    dv.p = dv.state === 'open' ? 0 : 1;
    this.poseDoor(dv, 0, true);
    this.doors.push(dv);
  }

  private readDoor(key: string): DoorState {
    const v = this.state?.layout?.doors?.[key];
    return v === 'closed' || v === 'sealed' ? v : 'open';
  }

  /** Puts a door's sprites in the pose of its progress (and its lamp in the colour of its state). */
  private poseDoor(d: DoorView, t: number, instant = false): void {
    const e = d.p < 0.5 ? 2 * d.p * d.p : 1 - Math.pow(-2 * d.p + 2, 2) / 2;
    // The leaf swings on its left hinge: seen from the front it narrows to a sliver against the jamb when open.
    d.leaf.scale.x = (0.1 + 0.9 * e) * (PASS_W / d.leaf.texture.width * 1);
    d.leaf.x = d.hinge;
    const closedish = d.state !== 'open';
    d.straps.visible = d.state === 'sealed' && d.p > 0.95;
    d.straps.scale.x = d.leaf.scale.x * (d.straps.texture.width / d.leaf.texture.width);
    d.straps.x = d.hinge;
    d.sign.visible = d.state === 'sealed' && d.p > 0.95;
    if (closedish) {
      // Red, breathing slowly (never a hard flash).
      const breathe = instant || gfxLevel() === 'low' || reducedMotion() ? 0.6 /* plan4:AC-2 steady */ : 0.5 + 0.5 * Math.sin(t * 1.6 + d.x * 0.01);
      d.lamp.tint = statusTint('bad'); // plan4:AC-6 (the leaf pose and the SEALED sign carry the state too)
      d.lamp.alpha = 0.7 + 0.3 * breathe;
      d.glow.tint = statusTint('bad');
      d.glow.alpha = d.state === 'sealed' ? 0.5 : 0.22 + 0.2 * breathe;
    } else {
      d.lamp.tint = statusTint('ok');
      d.lamp.alpha = 0.75;
      d.glow.tint = statusTint('ok');
      d.glow.alpha = 0.1;
    }
  }

  // ------------------------------------------------------------------------------------------------ feed lines (ST-17)

  private addLines(): void {
    if (!this.ctx || !this.state) return;
    const { floors, exts } = this.ctx;
    const withDoor = new Set<number>(); // a floor with a bulkhead has its feed line drawn too, so a shut door can cut it
    for (const k in this.state.layout.doors) { const p = parseKey(k); if (p) withDoor.add(p.floor); }
    for (const it of this.state.layout.infra) if (it.kind === 'bulkhead') withDoor.add(it.floor);
    for (let f = 0; f < floors; f++) {
      const e = exts[f] ?? { w: 0, e: BASE_EAST };
      if (e.w <= 0 && e.e <= BASE_EAST && !withDoor.has(f)) continue; // only the levels with a wing or a door have their own feed lines
      const g = new Graphics();
      const top = floorTop(f);
      this.container.addChild(g);
      this.lines.push({ floor: f, g, y0: top, y1: top + ROOM_H });
    }
  }

  /** Redraws every feed line from the doors' states: live up to the first closed/sealed door away from the shaft, dead beyond it. */
  private drawLines(): void {
    if (!this.ctx || !this.state || !this.lines.length) return;
    const { floors, exts } = this.ctx;
    const grid = occupancy(this.state.buildings, this.state.ruins, floors, exts as Ext[]);
    for (const ln of this.lines) {
      const f = ln.floor;
      const g = ln.g;
      g.clear();
      const ext = exts[f] ?? { w: 0, e: BASE_EAST };
      const row = grid[f];
      if (!row) continue;
      const cell = (s: number) => row[s + ext.w] ?? null;
      const top = floorTop(f);
      const yR = top + PIPES_Y + PIPES_H + 2.4, yB = yR + 3.4;
      const ops = openingsOfFloor(grid, f);
      const cutX: number[] = [];
      for (const o of ops) if (o.kind === 'room' && this.readDoor(`${f}:${o.slot}`) !== 'open') cutX.push(o.x);
      for (const k in this.state.layout.doors) {
        const p = parseKey(k);
        if (p && p.floor === f && this.readDoor(k) !== 'open') cutX.push(slotX(p.slot));
      }
      // East part and west part of the floor each run from the shaft out to the end of the last room; a cut makes everything beyond dead.
      const runs: { dir: 1 | -1; x0: number; x1: number }[] = [];
      let last = -1;
      for (let s = ext.e - 1; s >= 0; s--) if (cell(s)) { last = s; break; }
      if (last >= 0) runs.push({ dir: 1, x0: ROOMS_X - 2, x1: slotX(last + 1) - 2 });
      let first = 1;
      for (let s = -ext.w; s < 0; s++) if (cell(s)) { first = s; break; }
      if (first < 0) runs.push({ dir: -1, x0: -SHAFT_GAP + 2, x1: slotX(first) + 2 });
      for (const r of runs) {
        // Cuts along this run, nearest the shaft first.
        const cuts = cutX.filter(x => (r.dir > 0 ? x > r.x0 && x < r.x1 : x < r.x0 && x > r.x1)).sort((a, b) => (r.dir > 0 ? a - b : b - a));
        const stops = [r.x0, ...cuts.flatMap(x => [x - r.dir * 2.2, x + r.dir * 2.2]), r.x1];
        const supports = ops.map(o => o.x).filter(x => (r.dir > 0 ? x > r.x0 && x < r.x1 : x < r.x0 && x > r.x1));
        for (let i = 0; i + 1 < stops.length; i += 2) {
          const a = stops[i], b = stops[i + 1];
          const live = i === 0;
          this.cable(g, a, b, yR, live ? 0xd2442e : 0x3c3a38, live ? 0xff9a80 : 0x6a6662);
          this.cable(g, a, b, yB, live ? 0x3c80c0 : 0x383a3c, live ? 0x9ad0ff : 0x626870);
          // Clips where the cables cross a column.
          for (const sx of supports) {
            if (sx <= Math.min(a, b) || sx >= Math.max(a, b)) continue;
            g.rect(sx - 1.1, yR - 1.2, 2.2, yB - yR + 3.4).fill(0x2c2e30);
            g.rect(sx - 1.1, yR - 1.2, 2.2, 0.6).fill({ color: 0xffffff, alpha: 0.25 });
          }
        }
        // Junction boxes at every doorway: a LED shows live (green) or dead (red).
        for (const sx of supports) {
          const live = !cuts.some(c => (r.dir > 0 ? c < sx : c > sx));
          g.roundRect(sx - 2.8, yB + 2.2, 5.6, 4.4, 0.8).fill(0x23262a);
          g.rect(sx - 2.8, yB + 2.2, 5.6, 0.6).fill({ color: 0xffffff, alpha: 0.2 });
          g.circle(sx, yB + 4.6, 0.75).fill(live ? 0x58d070 : 0xe04030);
        }
        // The cut itself: two clamped cable ends and a dead red LED on the door frame.
        for (const cx of cuts) {
          for (const sgn of [-1, 1]) {
            g.rect(cx + sgn * 2.2 - 0.9, yR - 1.4, 1.8, yB - yR + 3.8).fill(0x30343a);
            g.circle(cx + sgn * 2.2, yR + 0.1, 0.55).fill(0x14100e);
            g.circle(cx + sgn * 2.2, yB + 0.1, 0.55).fill(0x14100e);
          }
          g.circle(cx, yR + (yB - yR) / 2, 0.9).fill(0xe04030);
        }
      }
    }
  }

  /** One cable run: a body with a lit top edge, sagging a little in the middle. */
  private cable(g: Graphics, x0: number, x1: number, y: number, col: number, hi: number): void {
    const lo = Math.min(x0, x1), hiX = Math.max(x0, x1);
    if (hiX - lo < 1) return;
    const sag = Math.min(1.1, (hiX - lo) * 0.012);
    g.moveTo(lo, y).quadraticCurveTo((lo + hiX) / 2, y + sag * 2, hiX, y).stroke({ color: col, width: 1.5, cap: 'round' });
    g.moveTo(lo, y - 0.5).quadraticCurveTo((lo + hiX) / 2, y + sag * 2 - 0.5, hiX, y - 0.5).stroke({ color: hi, width: 0.45, alpha: 0.5, cap: 'round' });
  }

  // ------------------------------------------------------------------------------------------------ per picture

  animate(t: number, power: number): void {
    const dt = this.lastT ? Math.min(0.1, Math.max(0, t - this.lastT)) : 0;
    this.lastT = t;
    this.lastPower = power;
    const low = gfxLevel() === 'low';
    for (const d of this.doors) {
      if (d.y1 < VIEW.y0 - 40 || d.y0 > VIEW.y1 + 40) continue;
      const want = this.readDoor(d.key);
      if (want !== d.state) d.state = want;
      const target = want === 'open' ? 0 : 1;
      if (d.p !== target) {
        d.p = low || reducedMotion() ? target : /* plan4:AC-2 quick cut */ target > d.p ? Math.min(target, d.p + dt / TURN_S) : Math.max(target, d.p - dt / TURN_S);
      }
      this.poseDoor(d, t);
    }
    for (const s of this.sections) {
      if (!s.glow || s.y1 < VIEW.y0 - 40 || s.y0 > VIEW.y1 + 40) continue;
      s.glow.alpha = low || reducedMotion() ? 0.3 : /* plan4:AC-2 */ 0.2 + 0.16 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.ph));
    }
    for (const f of this.fans) {
      if (f.y1 < VIEW.y0 - 40 || f.y0 > VIEW.y1 + 40) continue;
      // The fan turns with the power (a dead bunker coasts to a stop); a few turns a second at full power.
      f.angle += reducedMotion() ? 0 : dt * (power /* plan4:AC-2 fans stand still */ > 0.3 ? 5.5 * power : 0.4);
      f.s.rotation = f.angle;
    }
    for (const l of this.lines) l.g.visible = !(l.y1 < VIEW.y0 - 40 || l.y0 > VIEW.y1 + 40);
  }
}

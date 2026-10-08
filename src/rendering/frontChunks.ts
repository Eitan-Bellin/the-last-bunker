import { Container, Graphics, Sprite, TilingSprite, type Texture } from 'pixi.js';
import type { BuildingInstance } from '../core/GameState';
import { glowTexture } from '../art/ArtLibrary';
import { roomFlicker } from './paintedRoom';
import { GFX, gfxLevel } from './gfxFeatures';
import { DOOR_H, DOOR_W, openingsOfFloor, type Opening } from './openings';
import {
  ceilingPanelTexture, floorNumberTexture, floorStyles, heavySlabTexture, kindLight, latticeTexture, mulTint, perforatedSlabTexture, pipeColumnTexture, type FloorStyle,
} from './floorIdentity';
import { VIEW } from './perfFx';
import type { Pier } from './airyArt';
import { VOID_W, TOWER_W, voidBoundaries } from './voids';
import { PIER_AO, PIER_W, clusterSpan, pierKey, piersOfFloor } from './airyArt'; // [airy:A2]
import { beamTexture, deckTexture, railTexture, seamBack, slotSlice, towerTexture } from './circulation'; // [airy2:D1]
import { BASE_EAST, CORR_BEAM, CORR_DECK, CORR_LANE, CORR_RAIL, FLOOR_H, ROOMS_X, ROOM_H, SHAFT_GAP, SLAB, SLOT_W, TOPSOIL, floorAtY, floorH, floorTop, slotX, type Ext } from './layout';
import {
  AO_CONTACT, AO_SIDE, COLUMN_SPILL_W, COLUMN_W, KIT_LIFT, LIP, PIPES_H, PIPES_Y, SLAB_DRAW,
  cellAt, depthGains, gridSegments, hallSpans, inSpan, kitTex, lampParts, lightOf, nightLight, shadeAt, slabExt, softTexture,
  type Grid, type KitState, type Lit, type WorldLamp,
} from './structure';
import type { Animated } from './world';

/**
 * [plan4:ST-7] The structure in front of the rooms (slab profiles, columns, the pipe bundle under each ceiling, ambient occlusion, the light the lamps throw on
 * them) in chunks of 4 slots x 3 floors instead of one piece for the whole bunker.
 *
 * - A chunk is a render group of its own, built lazily the first time it comes near the camera (a window of one screen height and 3/4 of a screen width around
 *   the view, like the rooms), at most `MAX_BUILDS` per picture (the ones in view first), and given back after `PARK_AFTER_MS` outside that window.
 * - Every chunk keeps a signature of what it was built from (the cells of its slots and their neighbours, the halls and extents of its floors, the lamps that reach
 *   it, the era's kit and ambient): when the bunker changes, only the chunks whose signature changed are dropped and rebuilt, where one number used to rebuild all.
 * - Culling is on both axes: a chunk outside the camera's rectangle is hidden, and the per-picture lamp animation only touches the chunks in view.
 * A chunk is cut at slot boundaries (4 slots = 184 u) east of the shaft and west of it; the shaft's own strip (x -6 .. 64) is chunk 0. A floor group is 3 floors, the
 * slab under the last floor of a group belongs to it (the roof slab to the first group). A bunker's look does not change: pieces are placed exactly as before, only the
 * odd random choices (the contact shadow's strength, which column feet get a guide light) come from a hash of the piece's place instead of one running sequence.
 */

/** [plan4:ST-11] The look of a floor when the `floorId` switch is off: untinted, warm lamps, plain pieces. */
const PLAIN_STYLE: FloorStyle = { kind: 'living', tint: 0xffffff, light: 0xffc878, band: 0xc9a25a, col: 0, slab: 0, ceil: 0, key: '' };

export const CHUNK_SLOTS = 4;
export const CHUNK_FLOORS = 3;
const CW = CHUNK_SLOTS * SLOT_W;
const PARK_AFTER_MS = 8000;
const MAX_BUILDS_DEFAULT = 3;
/** Chunks built per picture; `?chunkbuilds=N` raises it (the perf runner on a slow software GL needs the picture settled before it measures). */
let maxBuilds = MAX_BUILDS_DEFAULT;
try {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('chunkbuilds') : null;
  if (q && +q > 0) maxBuilds = Math.min(200, +q);
} catch {
  // no location: the default stands
}

/** Chunk column of a world x: 0 = the shaft's strip, 1.. east of it, -1.. west of it. */
const cxOfX = (x: number): number => (x >= ROOMS_X ? 1 + Math.floor((x - ROOMS_X) / CW) : x >= -SHAFT_GAP ? 0 : Math.floor((x + SHAFT_GAP) / CW));
const chunkX0 = (cx: number): number => (cx >= 1 ? ROOMS_X + (cx - 1) * CW : cx === 0 ? -SHAFT_GAP : -SHAFT_GAP + cx * CW);
const chunkX1 = (cx: number): number => (cx >= 1 ? ROOMS_X + cx * CW : cx === 0 ? ROOMS_X : -SHAFT_GAP + (cx + 1) * CW);

/** A repeatable pseudo-random number in [0, 1) from a floor and an x (so a chunk builds the same whenever it is built). */
function hr(f: number, x: number): number {
  let h = Math.imul(f + 101, 374761393) ^ Math.imul(Math.round(x * 4) + 7919, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Chunk {
  cx: number;
  cy: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  sig: string;
  /** The chunk's own piece of each of its row's three layers (shadows, the structure, the additive light), null while it is not built. */
  container: Container | null;
  parts: Container[];
  lit: Lit[];
  spills: { s: Sprite; a: number; room: number }[];
  guides: { s: Sprite; a: number }[];
  markers: { s: Sprite; ph: number }[];
  /** The `epoch` the lit pieces were last tinted for. */
  stamp: number;
  shown: boolean;
  lastSeen: number;
}

export class FrontChunks implements Animated {
  readonly container = new Container();
  /**
   * One render group per floor group, with the same three layers the whole-bunker structure had (shadows under, the structure, additive light over): a chunk puts a
   * plain container into each, so the pieces of neighbouring chunks batch together as the bands did (a render group per chunk would cost a batch per chunk).
   */
  private rows = new Map<number, { group: Container; ao: Container; main: Container; spill: Container }>();
  private chunks = new Map<number, Chunk>();
  private list: Chunk[] = [];
  private grid!: Grid;
  private buildings: BuildingInstance[] = [];
  private floors = 0;
  private lamps: WorldLamp[] = [];
  private lampsByFloor: WorldLamp[][] = [];
  private ambient = 0.5;
  private st: KitState = 'F';
  private globalSig = '';
  /** [plan4:ST-11] The look of every floor (empty while the `floorId` switch is off: every floor then draws the plain way). */
  private styles: FloorStyle[] = [];
  /** [plan4:ST-11] The overlays (lattice, girders, panels) are for Medium and High only. */
  private full = true;
  // The rooms whose lamps light the structure; their flicker is read back every picture.
  private roomIds: string[] = [];
  private roomIdx = new Map<string, number>();
  private flicker: number[] = [1];
  private epoch = 1;
  private lastPower = -1;
  private lastNight = -1;
  /** Statistics for tests and the perf probe. */
  built = 0;

  constructor() {
    this.container.label = 'frontChunks';
    this.container.eventMode = 'none';
  }

  /** How many chunks exist right now (built) and how many are described. */
  get counts(): { built: number; total: number; shown: number } {
    let built = 0, shown = 0;
    for (const c of this.list) if (c.container) { built++; if (c.shown) shown++; }
    return { built, total: this.list.length, shown };
  }

  private roomIndex = (id?: string): number => (id ? this.roomIdx.get(id) ?? this.roomIds.length : this.roomIds.length);

  /**
   * Describes the bunker; keeps every chunk whose signature did not change (built or not), drops the rest. Cheap: a signature is a short string per
   * chunk, no drawing happens here.
   */
  set(grid: Grid, buildings: BuildingInstance[], floors: number, lamps: WorldLamp[], ambient: number, st: KitState): void {
    this.grid = grid;
    this.buildings = buildings;
    this.floors = floors;
    this.lamps = lamps;
    this.ambient = ambient;
    this.st = st;
    // [plan4:ST-11] Floor identity: a kind per floor, so a change of the rooms may restyle a floor (the signature below carries each style's key).
    this.styles = GFX.floorId ? floorStyles(buildings, floors) : [];
    this.full = gfxLevel() !== 'low';
    this.lampsByFloor = Array.from({ length: floors }, () => []);
    for (const l of lamps) {
      const f = floorAtY(l.y).floor;
      if (f >= 0 && f < floors) this.lampsByFloor[f].push(l);
    }
    const ids = [...new Set(lamps.map(l => l.room).filter((r): r is string => !!r))];
    this.roomIds = ids;
    this.roomIdx = new Map(ids.map((r, i) => [r, i]));
    this.flicker = new Array(ids.length + 1).fill(1);
    const gsig = `${st}|${this.full ? 1 : 0}${GFX.openings ? 'o' : ''}${GFX.airy ? 'a' + voidBoundaries(grid).join('.') : ''}|${ambient.toFixed(3)}|${kitTex('pipes', st)?.uid}.${kitTex('slab', st)?.uid}.${kitTex('column', st)?.uid}`;
    const all = gsig !== this.globalSig;
    this.globalSig = gsig;

    // Which chunks the bunker needs: the floor groups, and for every group the columns its floors reach.
    const want = new Map<number, Chunk>();
    const groups = Math.ceil(floors / CHUNK_FLOORS);
    for (let cy = 0; cy < groups; cy++) {
      let lo = 0, hi = 0;
      const fa = cy * CHUNK_FLOORS, fb = Math.min(floors, fa + CHUNK_FLOORS);
      for (let f = fa; f < fb; f++) {
        const e = grid.ext[f];
        lo = Math.min(lo, cxOfX(slotX(-e.w) + 0.01));
        hi = Math.max(hi, cxOfX(slotX(e.e) - 0.01));
      }
      for (let cx = lo; cx <= hi; cx++) {
        const key = cy * 8192 + (cx + 4096);
        const sig = this.signature(cx, cy);
        const old = this.chunks.get(key);
        if (old && !all && old.sig === sig) {
          want.set(key, old);
          continue;
        }
        if (old) this.drop(old);
        const yTop = floorTop(fa) - 8, yBot = floorTop(fb - 1) + ROOM_H + SLAB + 8;
        want.set(key, {
          cx, cy, x0: chunkX0(cx) - 30, x1: chunkX1(cx) + 30, y0: cy === 0 ? TOPSOIL - SLAB - 8 : yTop, y1: yBot, sig, container: null, parts: [],
          lit: [], spills: [], guides: [], markers: [], stamp: 0, shown: false, lastSeen: 0,
        });
      }
    }
    for (const [key, c] of this.chunks) if (!want.has(key)) this.drop(c);
    this.chunks = want;
    this.list = [...want.values()];
    this.epoch++;
  }

  /** Forgets every chunk (the bunker is drawn without the painted kit). */
  clear(): void {
    for (const c of this.list) this.drop(c);
    for (const row of this.rows.values()) row.group.destroy({ children: true });
    this.rows.clear();
    this.chunks.clear();
    this.list = [];
    this.globalSig = '';
  }

  private drop(c: Chunk): void {
    if (c.container) {
      for (const part of c.parts) part.destroy({ children: true });
      c.parts = [];
      c.container = null;
    }
    c.lit = [];
    c.spills = [];
    c.guides = [];
    c.markers = [];
  }

  /** What a chunk's drawing depends on, as a short string. */
  private signature(cx: number, cy: number): string {
    const { grid, buildings, floors } = this;
    const fa = cy * CHUNK_FLOORS, fb = Math.min(floors, fa + CHUNK_FLOORS);
    const x0 = chunkX0(cx), x1 = chunkX1(cx);
    const parts: string[] = [];
    // The slots a chunk covers (the shaft strip: the two slots against the shaft), and one more on each side: a column depends on both its neighbours.
    const sLo = (cx >= 1 ? CHUNK_SLOTS * (cx - 1) : cx === 0 ? -1 : CHUNK_SLOTS * cx) - 1;
    const sHi = (cx >= 1 ? CHUNK_SLOTS * cx : cx === 0 ? 1 : CHUNK_SLOTS * cx + CHUNK_SLOTS) + 1;
    for (let f = fa - 1; f < fb; f++) {
      if (f < 0) continue;
      const e = grid.ext[f];
      parts.push(`${f}:${e.w},${e.e}${f >= fa ? this.styles[f]?.key ?? '' : ''}`);
      if (f >= fa) {
        let row = '';
        for (let sl = sLo; sl <= sHi; sl++) row += (GFX.airy ? pierKey(grid, f, sl) : cellAt(grid, f, sl)?.key ?? '-') + ','; // [airy:A2] a seam depends on the building ids
        parts.push(row);
      }
      for (const [a, b] of hallSpans(buildings, f)) if (b > x0 - 30 && a < x1 + 30) parts.push(`h${f}:${a}-${b}`);
    }
    // Slab lines under the group's floors depend on the extents of the floor below the group too.
    if (fb < floors) parts.push(`n${fb}:${grid.ext[fb].w},${grid.ext[fb].e}`);
    const ya = floorTop(fa) - 200, yb = floorTop(Math.max(fa, fb - 1)) + ROOM_H + 200;
    let lamps = '';
    for (const l of this.lamps) if (l.x > x0 - l.reach * 1.7 && l.x < x1 + l.reach * 1.7 && l.y > ya && l.y < yb) lamps += `${Math.round(l.x)}.${Math.round(l.y)}.${l.power}.${l.color}.${l.room ?? ''};`;
    return parts.join('|') + '#' + lamps;
  }

  /** Per picture: build what came near the camera (a few a picture), show what is in view, give back what stayed away. */
  update(now: number): void {
    const w = VIEW.x1 - VIEW.x0, h = VIEW.y1 - VIEW.y0;
    const zx0 = VIEW.x0 - w * 0.75, zx1 = VIEW.x1 + w * 0.75, zy0 = VIEW.y0 - h, zy1 = VIEW.y1 + h;
    // Build what is needed: the chunks in view first, then the ones in the window, nearest the middle of the view first (a few a picture).
    const cxm = (VIEW.x0 + VIEW.x1) / 2, cym = (VIEW.y0 + VIEW.y1) / 2;
    for (let n = 0; n < maxBuilds; n++) {
      let best: Chunk | null = null;
      let bestD = Infinity;
      for (let i = 0; i < this.list.length; i++) {
        const c = this.list[i];
        if (c.container) continue;
        const inView = c.x1 > VIEW.x0 && c.x0 < VIEW.x1 && c.y1 > VIEW.y0 && c.y0 < VIEW.y1;
        if (!inView && !(c.x1 > zx0 && c.x0 < zx1 && c.y1 > zy0 && c.y0 < zy1)) continue;
        const d = Math.abs((c.x0 + c.x1) / 2 - cxm) + Math.abs((c.y0 + c.y1) / 2 - cym) * 1.5 + (inView ? 0 : 1e6);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (!best) break;
      this.build(best);
      best.lastSeen = now;
    }
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      if (!c.container) continue;
      const inView = c.x1 > VIEW.x0 && c.x0 < VIEW.x1 && c.y1 > VIEW.y0 && c.y0 < VIEW.y1;
      const inZone = c.x1 > zx0 && c.x0 < zx1 && c.y1 > zy0 && c.y0 < zy1;
      if (inZone) c.lastSeen = now;
      else if (now - c.lastSeen > PARK_AFTER_MS) {
        this.drop(c);
        continue;
      }
      if (inView !== c.shown) {
        c.shown = inView;
        for (const part of c.parts) part.visible = inView;
      }
    }
  }

  animate(t: number, power: number): void {
    const night = nightLight.k;
    let changed = Math.abs(power - this.lastPower) >= 0.01 || Math.abs(night - this.lastNight) >= 0.01;
    for (let i = 0; i < this.roomIds.length; i++) {
      const v = roomFlicker.get(this.roomIds[i]) ?? 1;
      if (v !== this.flicker[i]) {
        this.flicker[i] = v;
        changed = true;
      }
    }
    if (changed) {
      this.lastPower = power;
      this.lastNight = night;
      this.epoch++;
    }
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      if (!c.container || !c.shown) continue;
      for (const sp of c.spills) sp.s.alpha = sp.a * power * this.flicker[sp.room];
      for (const g of c.guides) {
        const a = g.a * night * (0.5 + 0.5 * power);
        g.s.alpha = a;
        g.s.visible = a > 0.004;
      }
      for (const m of c.markers) m.s.alpha = (0.42 + 0.14 * Math.sin(t * 1.1 + m.ph)) * (0.6 + 0.4 * power); // one slow breath, no hard flicker
      if (c.stamp !== this.epoch) {
        c.stamp = this.epoch;
        for (const l of c.lit) l.node.tint = mulTint(shadeAt(lightOf(l.base, l.parts, power, this.flicker, night), l.y), l.mul ?? 0xffffff); // [plan4:ST-11] floor tint
      }
    }
  }

  /** Draws one chunk (the old whole-bunker build, restricted to this chunk's floors and columns). */
  private build(c: Chunk): void {
    const { grid, buildings, floors, ambient, st } = this;
    const root = new Container();
    root.eventMode = 'none';
    root.label = 'frontChunk';
    const { cx, cy } = c;
    const fa = cy * CHUNK_FLOORS, fb = Math.min(floors, fa + CHUNK_FLOORS);
    const slabTex = kitTex('slab', st), colTex = kitTex('column', st), pipeTex = kitTex('pipes', st);
    const lift = KIT_LIFT[st];
    // [plan4:ST-11] Floor identity: the style of each floor, the overlays only at Medium and High, and the tint of the floor being drawn (set per floor below).
    const idOn = this.styles.length > 0;
    const full = idOn && this.full;
    const styleOf = (f: number): FloorStyle => this.styles[f] ?? PLAIN_STYLE;
    let mul = 0xffffff;
    const glow = glowTexture();
    const lit: Lit[] = c.lit = [];
    const spills: Chunk['spills'] = c.spills = [];
    const guides: Chunk['guides'] = c.guides = [];
    const markers: Chunk['markers'] = c.markers = [];
    const spill = new Container();
    const ao = new Container();
    const fixtures = new Graphics();
    const timbers = new Container();
    const doors = new Container(); // [plan4:ST-13] doorways cut through the columns between rooms
    const flicker = this.flicker;
    const roomIndex = this.roomIndex;
    // Only the lamps that can reach this chunk matter to the pieces in it.
    const ya = floorTop(fa) - 120, yb = floorTop(Math.max(fa, fb - 1)) + ROOM_H + 120;
    const near = this.lamps.filter(l => l.x > c.x0 - l.reach * 1.7 && l.x < c.x1 + l.reach * 1.7 && l.y > ya && l.y < yb);
    // A piece belongs to the chunk of its middle; one hanging past the end of a floor (the wall end of a slab, the last stub of a pipe) to the last chunk of that floor.
    const mine = (x: number, ext: Ext = { w: 0, e: BASE_EAST }) => cxOfX(Math.min(Math.max(x, ext.w > 0 ? slotX(-ext.w) + 0.01 : 0), slotX(ext.e) - 0.01)) === cx;
    // A column belongs to the chunk of the room it stands against (an east-facing end to the one on its right).
    const mineCol = (col: { x: number; l: boolean; r: boolean }) => cxOfX(col.x + (col.r && !col.l ? 0.01 : -0.01)) === cx;

    const add = (tex: Texture, x: number, y: number, w: number, h: number, scale: number, ccx: number, ccy: number, lampGain = 1, baseGain = 1, into: Container = root) => {
      const t = new TilingSprite({ texture: tex, width: w, height: h });
      t.position.set(x, y);
      t.tileScale.set(scale);
      // Keep the pattern continuous across segments.
      t.tilePosition.set(-x, 0);
      const parts = lampParts(ccx, ccy, near, roomIndex);
      for (let i = 1; i < parts.length; i += 2) parts[i] *= lampGain;
      const node: Lit = { node: t, base: Math.min(0.9, ambient * lift * baseGain), parts, y: ccy, mul };
      lit.push(node);
      t.tint = mulTint(shadeAt(lightOf(node.base, node.parts, 1, flicker), ccy), mul);
      into.addChild(t);
      return t;
    };
    const addLit = (tex: Texture, x: number, y: number, w: number, h: number, ccx: number, ccy: number, lampGain: number, baseGain: number, into: Container = root) => {
      const sp = new Sprite(tex);
      sp.position.set(x, y);
      sp.width = w;
      sp.height = h;
      const parts = lampParts(ccx, ccy, near, roomIndex);
      for (let i = 1; i < parts.length; i += 2) parts[i] *= lampGain;
      const node: Lit = { node: sp, base: Math.min(0.9, ambient * lift * baseGain), parts, y: ccy, mul };
      lit.push(node);
      sp.tint = mulTint(shadeAt(lightOf(node.base, node.parts, 1, flicker), ccy), mul);
      into.addChild(sp);
    };
    // [plan4:ST-11] The floor-identity overlays (ceiling panels, slab girders and plates, column variants, number tags) are plain sprites: kept together in two layers
    // above the tiling sprites they dress, so the batcher draws them in a call or two (a sprite between two tiling sprites would cost a draw call of its own).
    const ovl1 = new Container(), ovl2 = new Container();
    const shade = (tex: Texture, x: number, y: number, w: number, h: number, alpha: number, flipX = false) => {
      const s = new Sprite(tex);
      s.tint = 0x000000;
      s.alpha = alpha;
      s.width = w;
      s.height = h;
      s.position.set(x, y);
      if (flipX) {
        s.scale.x *= -1;
        s.x += w;
      }
      ao.addChild(s);
    };

    // Pipe bundle under every ceiling (none where a hall from the level above passes through).
    if (pipeTex) {
      const panelTex = full ? ceilingPanelTexture() : null;
      for (let f = fa; f < fb; f++) {
        const spans = hallSpans(buildings, f - 1);
        const y = floorTop(f) + PIPES_Y;
        const sty = styleOf(f);
        mul = sty.tint;
        const { w: ew, e: ee } = grid.ext[f];
        const runs: [number, number][] = gridSegments(64 - 26, slotX(ee) + 6, SLOT_W / 2);
        if (ew > 0) runs.push(...gridSegments(slotX(-ew) - 6, 20, SLOT_W / 2, true));
        for (const [x, x1] of runs) {
          const w = x1 - x;
          if (!mine((x + x1) / 2, grid.ext[f]) || inSpan(x, x1, spans)) continue;
          add(pipeTex, x, y, w, PIPES_H, PIPES_H / pipeTex.height, x + w / 2, y + PIPES_H / 2);
          // [plan4:ST-11] A covered ceiling: pale panels hung under the bundle (the pipes show above them).
          if (panelTex && sty.ceil === 1) addLit(panelTex, x, y + 2.5, w, PIPES_H - 2.5, x + w / 2, y + PIPES_H / 2, 1, 1, ovl1);
        }
      }
    }

    // The tint of a hand-coloured piece at depth y (timber, steel plates), as the lit pieces get it.
    const woodAt = (col: number, y: number) => {
      const [r, g, b] = depthGains(y);
      const ch = (sh: number, k: number) => Math.round(Math.min(255, ((col >> sh) & 255) * k * (0.55 + 0.45 * ambient * lift)));
      return (ch(16, r) << 16) | (ch(8, g) << 8) | ch(0, b);
    };
    const airy = GFX.airy; // [airy:A2] piers between all rooms, cluster bulkheads, walkway ledges
    const ledgeLayer = new Container();
    const railLayer = new Container(); // [airy2:D1]
    const voidLayer = new Container(); // [airy2:D3] rock shafts between clusters: above the slab tilings, under the deck that bridges them
    const towerLayer = new Container(); // [airy2:D3] stair towers, in front of the voids
    const brackets = new Graphics();

    // Shadow under each slab and pipe run falls into the room below; a dark contact line where the room floor meets the slab lip.
    const fadeV = softTexture('fadeV');
    const drop = softTexture('drop');
    for (let f = fa; f < fb; f++) {
      const top = floorTop(f);
      const above = hallSpans(buildings, f - 1);
      const below = hallSpans(buildings, f);
      let run0 = -1;
      let run1 = -1;
      const flush = () => {
        if (run1 > run0) shade(drop, run0, top + PIPES_Y + PIPES_H, run1 - run0, 15, 0.36);
        run0 = run1 = -1;
      };
      const { w: ew, e: ee } = grid.ext[f];
      for (const half of [gridSegments(ROOMS_X, slotX(ee), SLOT_W), ...(ew > 0 ? [gridSegments(slotX(-ew), -SHAFT_GAP, SLOT_W, true)] : [])]) {
        for (const [x0, x1] of half) {
          if (!mine((x0 + x1) / 2, grid.ext[f])) { flush(); continue; }
          if (!inSpan(x0, x1, above)) {
            if (run0 < 0) run0 = x0;
            run1 = x1;
          } else flush();
          if (!inSpan(x0, x1, below)) shade(fadeV, x0, top + ROOM_H - LIP - AO_CONTACT, x1 - x0, AO_CONTACT, 0.62 + hr(f, x0) * 0.15);
        }
        flush();
      }
    }

    if (slabTex) {
      const scale = SLAB_DRAW / slabTex.height;
      const lip = softTexture('lip');
      const endFade = softTexture('fadeH');
      // The roof slab under the topsoil (first group only), then one under every level of the group.
      const lines: { y: number; spans: [number, number][]; ext: Ext; f: number; piers: Pier[]; lo: number; hi: number }[] = [];
      if (cy === 0) lines.push({ y: TOPSOIL - SLAB - LIP, spans: [], ext: slabExt(grid.ext, floors, 0), f: 0, piers: [], lo: 0, hi: 0 });
      for (let f = fa; f < fb; f++) lines.push({ y: floorTop(f) + ROOM_H - LIP, spans: hallSpans(buildings, f), ext: slabExt(grid.ext, floors, f + 1), f, piers: airy ? piersOfFloor(grid, f, true) : [], lo: slotX(-grid.ext[f].w), hi: slotX(grid.ext[f].e) });
      const heavyTex = full ? heavySlabTexture() : null;
      const perfTex = full ? perforatedSlabTexture() : null;
      for (const line of lines) {
        const sty = styleOf(line.f);
        mul = sty.tint;
        const sx0 = (line.ext.w > 0 ? slotX(-line.ext.w) : 0) - 12, sx1 = slotX(line.ext.e) + 12;
        for (const [x, x1] of gridSegments(sx0, sx1, SLOT_W, line.ext.w > 0)) {
          const w = x1 - x;
          if (!mine((x + x1) / 2, line.ext) || inSpan(x, x1, line.spans)) continue;
          add(slabTex, x, line.y, w, SLAB_DRAW, scale, x + w / 2, line.y + SLAB_DRAW / 2);
          // The nosing catches the lamps of the room standing on it.
          addLit(lip, x, line.y, w, 6, x + w / 2, line.y - 6, 1.5, 0.95);
          // [plan4:ST-11] Slab variants: heavy girders under reactors and generators, perforated plate on the working and deep levels (the roof slab stays plain).
          if (line.y > TOPSOIL && sty.slab === 1 && heavyTex) addLit(heavyTex, x, line.y, w, SLAB_DRAW, x + w / 2, line.y + SLAB_DRAW / 2, 1, 0.9, ovl1);
          else if (line.y > TOPSOIL && sty.slab === 2 && perfTex) {
            for (let px = x; px < x1 - 0.5; px += SLOT_W / 2) addLit(perfTex, px, line.y, Math.min(SLOT_W / 2, x1 - px), SLAB_DRAW, px + SLOT_W / 4, line.y + SLAB_DRAW / 2, 1, 0.9, ovl1);
          }
          // [airy2:D1] The front corridor: a receding deck, the beam face of the slab edge on brackets, a conduit in the zone colour under it, the railing on the front edge.
          if (airy && line.y > TOPSOIL) {
            const yb = line.y + LIP; // the room's floor line
            const dy = yb + 1;
            const ccx = x + w / 2;
            addLit(slotSlice(deckTexture(), w), x, dy, w, CORR_DECK, ccx, dy + CORR_DECK / 2, 1.3, 1.5, ledgeLayer);
            // The cross seams lean toward the middle of the cluster (one-point perspective).
            const [ca, cb] = clusterSpan(line.piers, ccx, line.lo, line.hi);
            const vpx = (ca + cb) / 2;
            for (let sx = x; sx < x1 - 0.5; sx += 11.5) {
              const bx = seamBack(sx, vpx);
              brackets.poly([bx - 0.3, dy + 4, bx + 0.3, dy + 4, sx + 0.55, dy + CORR_DECK - 1, sx - 0.55, dy + CORR_DECK - 1]).fill({ color: 0x0a0a0c, alpha: 0.42 });
              brackets.poly([bx + 0.4, dy + 4, bx + 0.8, dy + 4, sx + 1.3, dy + CORR_DECK - 1, sx + 0.7, dy + CORR_DECK - 1]).fill({ color: 0xf0ecd8, alpha: 0.1 });
            } // plain sprites batch; a tiling sprite per slot would not
            addLit(slotSlice(beamTexture(), w), x, dy + CORR_DECK, w, CORR_BEAM, ccx, dy + CORR_DECK + CORR_BEAM / 2, 1.2, 1);
            addLit(slotSlice(railTexture(), w), x, dy + CORR_DECK - CORR_RAIL, w, CORR_RAIL, ccx, dy + CORR_DECK - CORR_RAIL / 2, 1.2, 1.05, railLayer);
            const by = dy + CORR_DECK + CORR_BEAM;
            const bc = woodAt(0x34363a, by);
            for (const bx of [x + 6, x1 - 6]) brackets.poly([bx - 2.5, by, bx + 2.5, by, bx - 2.5, by + 5]).fill(bc);
            const cy = by - 3.4;
            void cy;
            brackets.rect(x, by - 0.6, w, 1.2).fill({ color: 0x000000, alpha: 0.35 });
          }
        }
        // The slab ends bear into the casing walls: a soft dark where they enter.
        for (const [ex, flip] of [[sx0, false], [sx1 - 5, true]] as [number, boolean][]) {
          if (!mine(flip ? sx1 - 30 : sx0 + 30, line.ext)) continue;
          const cap = new Sprite(endFade);
          cap.tint = 0x000000;
          cap.alpha = 0.6;
          cap.width = 5;
          cap.height = SLAB_DRAW;
          cap.position.set(ex, line.y);
          if (flip) {
            cap.scale.x *= -1;
            cap.x += 5;
          }
          root.addChild(cap);
        }
      }
    }

    root.addChild(voidLayer);
    root.addChild(ovl1); // [plan4:ST-11] ceiling panels and slab overlays, above the pipe and slab tilings
    ledgeLayer.addChild(brackets);
    root.addChild(ledgeLayer); // [airy:A3]
    root.addChild(railLayer); // [airy2:D1]
    root.addChild(towerLayer);
    root.addChild(railLayer); // [airy2:D1]
    // Warm night guide lights at the column feet (fixture always there, lit only at night).
    const guide = (x: number, floorY: number, kl?: FloorStyle) => {
      const fy = floorY - 13;
      // [plan4:ST-11] The kind's lamp colour tints the night guide lights (red on the deepest levels).
      const gt = (c: number) => (kl ? kindLight(c, kl.light, kl.kind === 'deep-b' ? 0.75 : 0.3) : c);
      fixtures.rect(x - 2.4, fy - 1.3, 4.8, 2.8).fill(0x1e1c1a);
      fixtures.rect(x - 1.7, fy - 0.5, 3.4, 1.3).fill(0x6a4420);
      for (const [tint, w, h, y, a] of [[0xffc878, 6, 3.5, fy + 0.2, 0.9], [0xff9a3c, 30, 22, fy + 5, 0.42], [0xff9040, 46, 8, floorY + 0.5, 0.38]]) {
        const g = new Sprite(glow);
        g.anchor.set(0.5);
        g.tint = gt(tint);
        g.width = w;
        g.height = h;
        g.position.set(x, y);
        g.alpha = 0;
        g.visible = false;
        spill.addChild(g);
        guides.push({ s: g, a });
      }
    };
    const streak = softTexture('streak');

    // The dug end of a wing: a timber post with a cap beam and a diagonal brace instead of a steel column, and a soft marker lamp.
    // The west landing door: where the shaft meets the west wing the column becomes a steel doorframe, a lit passage and a door leaf ajar.
    const doorFrame = (x: number, top: number) => {
      const my = top + ROOM_H / 2;
      const dg = new Graphics();
      timbers.addChild(dg);
      const y0 = top + PIPES_Y + PIPES_H - 3, y1 = top + ROOM_H - LIP + 1;
      const steel = (col: number) => woodAt(col, my);
      dg.rect(x - 4.8, y0 + 6, 9.6, y1 - y0 - 6).fill(0x120f0b);
      dg.rect(x - 4.8, y0 + 6 + (y1 - y0 - 6) * 0.4, 9.6, (y1 - y0 - 6) * 0.6).fill({ color: 0x9a6a30, alpha: 0.4 });
      dg.poly([x - 4.8, y0 + 8, x - 0.4, y0 + 10.5, x - 0.4, y1 - 1, x - 4.8, y1]).fill(steel(0x6a6e72));
      dg.poly([x - 4.8, y0 + 8, x - 3.6, y0 + 8.6, x - 3.6, y1 - 0.4, x - 4.8, y1]).fill({ color: 0xd8d8d0, alpha: 0.22 });
      dg.circle(x - 1.8, y0 + (y1 - y0) * 0.55, 0.9).fill(0x1c1d1e);
      dg.rect(x - 6.6, y0, 2.4, y1 - y0).fill(steel(0x8a8f94));
      dg.rect(x + 4.2, y0, 2.4, y1 - y0).fill(steel(0x7a7f84));
      dg.rect(x - 6.6, y0, 0.8, y1 - y0).fill({ color: 0xffffff, alpha: 0.16 });
      dg.rect(x - 7.6, y0 - 1.5, 15.2, 7.5).fill(steel(0x8a8f94));
      dg.rect(x - 7.6, y0 - 1.5, 15.2, 1.1).fill({ color: 0xffffff, alpha: 0.2 });
      dg.rect(x - 7.6, y0 + 4.6, 15.2, 1.4).fill({ color: 0x000000, alpha: 0.4 });
      dg.circle(x, y0 + 2.2, 1.5).fill(0x2a1e10);
      dg.circle(x, y0 + 2.2, 1.0).fill(0x6cff7a);
      for (const bx of [x - 6, x + 6]) dg.circle(bx, y0 + 1, 0.6).fill(0x2a2a28);
      const glowS = new Sprite(glow);
      glowS.anchor.set(0.5);
      glowS.tint = 0xffb868;
      glowS.blendMode = 'add';
      glowS.alpha = 0.3;
      glowS.width = 30;
      glowS.height = 40;
      glowS.position.set(x + 2, y0 + (y1 - y0) * 0.65);
      spill.addChild(glowS);
    };
    const timberEnd = (x: number, top: number, dir: 1 | -1) => {
      const my = top + ROOM_H / 2;
      const tg = new Graphics(); // one per end
      timbers.addChild(tg);
      const post = (px: number, w: number, y0: number, y1: number) => {
        tg.rect(px - w / 2, y0, w, y1 - y0).fill(woodAt(0x5a4228, my));
        tg.rect(px - w / 2 + (dir > 0 ? 0 : w - 1.6), y0, 1.6, y1 - y0).fill({ color: woodAt(0x9a7a4c, my), alpha: 0.75 });
        for (let g = 0; g < 3; g++) tg.rect(px - w / 2 + 1.2 + g * (w / 3.2), y0 + 1, 0.5, y1 - y0 - 2).fill({ color: 0x1c140c, alpha: 0.4 });
      };
      const yTop = top + PIPES_Y + PIPES_H - 3, yBot = top + ROOM_H - LIP + 2;
      post(x, 7.5, yTop, yBot);
      // Cap beam into the room and a brace under it.
      const bx0 = dir > 0 ? x - 3 : x - 18, bx1 = dir > 0 ? x + 18 : x + 3;
      tg.rect(bx0, yTop - 1, bx1 - bx0, 5.5).fill(woodAt(0x654a2c, my));
      tg.rect(bx0, yTop - 1, bx1 - bx0, 1.4).fill({ color: woodAt(0xa88458, my), alpha: 0.7 });
      tg.rect(bx0, yTop + 3.6, bx1 - bx0, 1.2).fill({ color: 0x000000, alpha: 0.35 });
      const bxA = x + dir * 3, bxB = x + dir * 15;
      tg.poly([bxA, yTop + 26, bxA + dir * 2.6, yTop + 26, bxB + dir * 2.6, yTop + 5, bxB, yTop + 5]).fill(woodAt(0x4e3a22, my));
      // A footing plate, wedges and a stack of shoring boards at the foot.
      tg.rect(x - 6, yBot - 3, 12, 4).fill(0x26282a);
      tg.rect(x - 6, yBot - 3, 12, 1).fill({ color: 0x8a8f94, alpha: 0.35 });
      for (let k = 0; k < 3; k++) tg.rect(x + dir * (6 + k * 2.6), yBot - 2 - k * 1.8, 6, 1.7).fill(woodAt(0x6a5030, my));
      // The marker lamp: a caged bulb on the beam, with a halo.
      const lx = x + dir * 8, ly = yTop + 9;
      tg.rect(lx - 2.6, ly - 2.4, 5.2, 5).fill(0x15130f);
      tg.rect(lx - 1.8, ly - 1.6, 3.6, 3.2).fill(0xb87430);
      tg.rect(lx - 2.6, ly - 2.4, 5.2, 0.7).fill({ color: 0x8a8a80, alpha: 0.4 });
      const halo = new Sprite(glow);
      halo.anchor.set(0.5);
      halo.tint = 0xffa24a;
      halo.blendMode = 'add';
      halo.width = 44;
      halo.height = 34;
      halo.alpha = 0.5;
      halo.position.set(lx, ly);
      spill.addChild(halo);
      markers.push({ s: halo, ph: (x * 0.013 + top * 0.007) % 6.28 });
    };

    // [plan4:ST-13] A doorway cut through a column: steel jambs and a lintel, a dark passage with the warm light of the rooms behind it, and the door of the
    // style the rooms ask for (sliding leaf half open, blast hatch ajar, plastic curtain, bare opening). A stub (the end step of a wing) is a short corridor.
    // The passage is DOOR_W x DOOR_H units (a person is about 56 high): taller and wider than the plan's 14 x 50 sketch so a walker fits through.
    const doorway = (dg: Graphics, x: number, top: number, op: Opening, sty: FloorStyle, dir: 1 | -1) => {
      const my = top + ROOM_H / 2;
      const floorY = top + ROOM_H - LIP;
      const pw = DOOR_W, hw = pw / 2, jw = 2.6, hgt = DOOR_H + 5;
      const y0 = floorY - hgt;
      const steel = (c: number) => woodAt(c, my);
      const warm = idOn ? kindLight(0xffb868, sty.light, 0.3) : 0xffb868;
      const ph = hgt - 5;
      const py = y0 + 5;
      // The passage: dark, a little warmer toward the floor where the neighbouring room's lamps reach.
      dg.rect(x - hw, py, pw, ph).fill(0x0c0907);
      // A soft rise of warm light toward the floor from stacked translucent bands (a gradient fill would need a texture of its own).
      for (let k = 0; k < 6; k++) dg.rect(x - hw, py + ph * (0.3 + k * 0.115), pw, ph * (0.7 - k * 0.115)).fill({ color: k < 3 ? 0x2c2012 : warm, alpha: k < 3 ? 0.16 : 0.07 });
      if (op.style === 'slide') {
        // The leaf slid half way into the wall; a slit window, a handle, vertical slats.
        dg.rect(x + 0.4, py, hw - 0.4, ph - 1.5).fill(steel(0x62686c));
        for (let k = 0; k < 3; k++) dg.rect(x + 1.4 + k * 1.7, py + 2, 0.5, ph - 6).fill({ color: 0x000000, alpha: 0.28 });
        dg.rect(x + 0.4, py, 0.9, ph - 1.5).fill({ color: 0xffffff, alpha: 0.16 });
        dg.rect(x + 1.6, py + 8, 3.4, 4).fill(0x0e1210);
        dg.rect(x + 1.6, py + 8, 3.4, 4).fill({ color: warm, alpha: 0.4 });
        dg.rect(x + 0.7, py + ph * 0.55, 0.8, 3.4).fill(steel(0xc8c8c0));
      } else if (op.style === 'blast') {
        // A round hatch standing ajar against the left jamb, its wheel and the hazard stripe on the lintel.
        dg.ellipse(x - hw + 2.6, py + ph * 0.5, 2.2, ph * 0.5 - 0.6).fill(steel(0x6a7074));
        dg.ellipse(x - hw + 2.1, py + ph * 0.5, 0.8, ph * 0.5 - 3).fill({ color: 0xffffff, alpha: 0.18 });
        dg.circle(x - hw + 2.6, py + ph * 0.5, 1.3).fill(steel(0x2a2e30));
        dg.circle(x - hw + 2.6, py + ph * 0.5, 0.55).fill(steel(0x9a9e98));
        for (let k = 0; k < 5; k++) dg.rect(x - hw - jw + k * 3.9 + 0.5, y0 + 4.2, 2, 1.3).fill(steel(k % 2 ? 0x1a1816 : 0xd9a441));
      } else if (op.style === 'curtain') {
        // Strips of plastic hanging from a rail, a little more opaque at the hem.
        for (let k = 0; k < 5; k++) {
          dg.rect(x - hw + 0.3 + k * 2.7, py, 2.4, ph - 2).fill({ color: 0xcfe0d4, alpha: 0.3 });
          dg.rect(x - hw + 0.3 + k * 2.7, py + ph - 8, 2.4, 6).fill({ color: 0xcfe0d4, alpha: 0.16 });
          dg.rect(x - hw + 1.3 + k * 2.7, py, 0.4, ph - 2).fill({ color: 0xffffff, alpha: 0.2 });
        }
        dg.rect(x - hw, py - 0.4, pw, 1).fill(steel(0x5a5e60));
      }
      // Jambs, lintel, the little status lamp (green: the way is open) and the foot plates.
      dg.rect(x - hw - jw, y0, jw, hgt).fill(steel(0x8a8f94));
      dg.rect(x + hw, y0, jw, hgt).fill(steel(0x7a7f84));
      dg.rect(x - hw - jw, y0, 0.8, hgt).fill({ color: 0xffffff, alpha: 0.16 });
      dg.rect(x - hw - jw - 0.8, y0 - 1.5, pw + 2 * jw + 1.6, 6.5).fill(steel(0x8a8f94));
      dg.rect(x - hw - jw - 0.8, y0 - 1.5, pw + 2 * jw + 1.6, 1.1).fill({ color: 0xffffff, alpha: 0.2 });
      dg.rect(x - hw - jw - 0.8, y0 + 3.7, pw + 2 * jw + 1.6, 1.3).fill({ color: 0x000000, alpha: 0.4 });
      dg.circle(x, y0 + 1.6, 1.3).fill(0x2a1e10);
      dg.circle(x, y0 + 1.6, 0.85).fill(0x58c866);
      dg.rect(x - hw - jw - 0.8, floorY - 2.4, pw + 2 * jw + 1.6, 2.4).fill(steel(0x34383a));
      if (op.kind === 'stub') {
        // The short corridor beyond: a concrete lintel beam across it, a grated floor strip and a caged lamp.
        const len = (op.run ?? 1) * SLOT_W;
        const edge = hw + jw + 0.8;
        const cx0 = dir > 0 ? x + edge : x - edge - (len - edge), cw = len - edge;
        dg.rect(cx0, top + PIPES_Y + PIPES_H, cw, 7).fill(steel(0x5e5a52));
        dg.rect(cx0, top + PIPES_Y + PIPES_H, cw, 1).fill({ color: 0xe8e0d0, alpha: 0.22 });
        dg.rect(cx0, top + PIPES_Y + PIPES_H + 7, cw, 4).fill({ color: 0x000000, alpha: 0.28 });
        dg.rect(cx0, floorY - 2.6, cw, 2.6).fill(steel(0x44463f));
        for (let gx = cx0 + 2; gx < cx0 + cw - 1; gx += 3.4) dg.rect(gx, floorY - 2, 1.5, 1.2).fill({ color: 0x0a0908, alpha: 0.6 });
        const lx = cx0 + cw / 2, ly = top + PIPES_Y + PIPES_H + 10;
        dg.rect(lx - 2.4, ly - 2.2, 4.8, 4.6).fill(0x15130f);
        dg.rect(lx - 1.6, ly - 1.4, 3.2, 3).fill(0xb87430);
        const lg = new Sprite(glow);
        lg.anchor.set(0.5);
        lg.tint = warm;
        lg.width = Math.min(cw + 24, 80);
        lg.height = 56;
        lg.alpha = 0.4;
        lg.position.set(lx, ly + 18);
        spill.addChild(lg);
      }
      const g2 = new Sprite(glow);
      g2.anchor.set(0.5);
      g2.tint = warm;
      g2.width = 30;
      g2.height = 46;
      g2.alpha = 0.2;
      g2.position.set(x, floorY - 22);
      spill.addChild(g2);
    };

    // [airy2:D3] A void between two clusters: a shaft of cut rock the full height of the floor, concrete jambs with a shadow, strata, a cable and a warm far light; the
    // deck of the corridor bridges it (drawn above this layer). `last` extends it to the next floor's top, and floor 0's up to the roof.
    const voidShaft = (x: number, f: number) => {
      const top = floorTop(f);
      const y0 = f === 0 ? TOPSOIL - SLAB - 4 : top - 1;
      const y1 = (f + 1 < this.floors ? floorTop(f + 1) : top + FLOOR_H) + 1;
      const x0 = x - VOID_W / 2, w = VOID_W;
      const g = new Graphics();
      const my = top + ROOM_H / 2;
      g.rect(x0, y0, w, y1 - y0).fill(woodAt(0x120f0c, my));
      // strata: slanted bands of rock in a few browns, thicker toward the middle of the floor
      const bands = [0x2c241c, 0x1a1511, 0x3a2f24, 0x221b15, 0x463a2c];
      let k = 0;
      for (let y = y0; y < y1; k++) {
        const h = 3 + hr(f + 211, y + x) * 8;
        const tilt = (hr(f + 7, y + x) - 0.5) * 5;
        const hh = Math.min(h, y1 - y);
        g.poly([x0, y + tilt * 0.3, x0 + w, y - tilt * 0.3, x0 + w, y + hh - tilt * 0.3, x0, y + hh + tilt * 0.3]).fill({ color: woodAt(bands[k % bands.length], my), alpha: 0.85 });
        y += h + hr(f + 5, y) * 3;
      }
      // the far light: the shaft glows warm toward its floor and the bottom is lost in the dark
      for (let i = 0; i < 5; i++) g.rect(x0, top + ROOM_H - 40 + i * 8, w, 9).fill({ color: 0xffa860, alpha: 0.025 * (i + 1) });
      // cables hanging across
      for (const [sag, ay] of [[7, top + 14], [10, top + 30]] as [number, number][]) {
        g.moveTo(x0, ay).quadraticCurveTo(x, ay + sag * 2, x0 + w, ay).stroke({ color: woodAt(0x1a1816, my), width: 1.6 });
        g.moveTo(x0, ay - 0.5).quadraticCurveTo(x, ay + sag * 2 - 0.5, x0 + w, ay - 0.5).stroke({ color: 0xb8a888, width: 0.4, alpha: 0.25 });
      }
      // jambs: sawn concrete faces with a lit arris, and the shadow they throw
      for (const side of [-1, 1] as const) {
        const jx = side < 0 ? x0 - 3.2 : x0 + w - 0.8;
        g.rect(jx, y0, 4, y1 - y0).fill(woodAt(0x6a665c, my));
        g.rect(side < 0 ? jx + 3 : jx, y0, 1, y1 - y0).fill({ color: 0x000000, alpha: 0.55 });
        g.rect(side < 0 ? jx : jx + 3, y0, 1, y1 - y0).fill({ color: 0xf0e8d8, alpha: 0.2 });
        shade(softTexture('fadeH'), side < 0 ? x0 - 3.2 - 10 : x0 + w + 3.2, y0, 10, y1 - y0, 0.55, side < 0);
      }
      voidLayer.addChild(g);
      // a pale shaft of light falling from above through the void (the stair tower catches it)
      const lg = new Sprite(glow);
      lg.anchor.set(0.5);
      lg.tint = 0xb8d0e0;
      lg.width = w * 1.2;
      lg.height = (y1 - y0) * 0.9;
      lg.alpha = 0.1;
      lg.position.set(x, (y0 + y1) / 2);
      spill.addChild(lg);
    };
    // [airy2:D3] A storey of the stair tower standing in front of the void.
    const towerStorey = (x: number, f: number) => {
      const yb = floorTop(f) + ROOM_H;
      const sp = new Sprite(towerTexture());
      sp.position.set(x - TOWER_W / 2, yb + CORR_LANE);
      sp.width = TOWER_W;
      sp.height = floorH(f);
      const ccx = x, ccy = yb + floorH(f) / 2;
      const parts = lampParts(ccx, ccy, near, roomIndex);
      for (let i = 1; i < parts.length; i += 2) parts[i] *= 0.7;
      const node: Lit = { node: sp, base: Math.min(0.9, ambient * lift * 1.25), parts, y: ccy, mul };
      lit.push(node);
      sp.tint = mulTint(shadeAt(lightOf(node.base, node.parts, 1, flicker), ccy), mul);
      towerLayer.addChild(sp);
      // the caged lamp on the left post
      const lg = new Sprite(glow);
      lg.anchor.set(0.5);
      lg.tint = 0xffc070;
      lg.width = 34;
      lg.height = 34;
      lg.position.set(x - TOWER_W / 2 + 5.7, yb + CORR_LANE + 58 * floorH(f) / 144);
      spill.addChild(lg);
      spills.push({ s: lg, a: 0.4, room: roomIndex() });
    };

    if (colTex) {
      const fadeH = softTexture('fadeH');
      const blob = softTexture('blob');
      for (let f = fa; f < fb; f++) {
        const top = floorTop(f);
        const row = grid[f];
        const { w: ew, e: ee } = grid.ext[f];
        // [airy:A2] `tier` (see airyArt.piersOfFloor): the walls and the classic columns are 1; thin seams (0) and cluster bulkheads (2) exist only with the airy flag.
        const xs: { x: number; l: boolean; r: boolean; open: boolean; door?: boolean; tier: 0 | 1 | 2 }[] = [
          { x: ROOMS_X, l: false, r: true, open: false, tier: 1 }, { x: slotX(ee), l: true, r: false, open: ee > BASE_EAST, tier: 1 },
        ];
        for (const p of piersOfFloor(grid, f, airy)) xs.push({ x: p.x, l: true, r: true, open: false, tier: p.tier });
        if (ew > 0) xs.push({ x: slotX(-ew), l: false, r: true, open: true, tier: 1 }, { x: -SHAFT_GAP, l: true, r: false, open: false, door: true, tier: 1 });
        const ceil = top + PIPES_Y + PIPES_H;
        const floorY = top + ROOM_H - LIP;
        const above = hallSpans(buildings, f - 1);
        const below = hallSpans(buildings, f);
        const floorLamps = this.lampsByFloor[f] ?? [];
        const sty = styleOf(f);
        mul = sty.tint;
        const ops = new Map<number, Opening>();
        if (GFX.openings) for (const o of openingsOfFloor(grid, f)) if (o.side !== 'w') ops.set(Math.round(o.x), o); // the west landing keeps its own door frame
        let dgf: Graphics | null = null;
        const latticeTex = full && sty.col === 1 ? latticeTexture() : null;
        const pipeColTex = full && sty.col === 2 ? pipeColumnTexture() : null;
        for (const col of xs) {
          const x = col.x;
          if (!mineCol(col)) continue;
          // [airy:A2] Piers are wider than the classic 9-unit column (the walls, the shaft door and the classic default stay at COLUMN_W).
          const wall = !col.l || !col.r || col.door;
          const isVoid = airy && col.tier === 2 && !wall;
          const cw = isVoid ? VOID_W : airy && !wall ? PIER_W[col.tier] : COLUMN_W;
          const aoW = airy && !wall ? PIER_AO[col.tier] : AO_SIDE;
          const cscale = cw / colTex.width;
          if (isVoid) {
            voidShaft(x, f);
          } else if (col.open) {
            const dir = x < 0 ? 1 : -1;
            timberEnd(x, top, dir);
            // [plan4:ST-11] The floor's number on the post at the end of a wing.
            if (idOn) addLit(floorNumberTexture(f, sty.band), x - dir * 5 - 8, ceil + 17, 16, 9, x, top + ROOM_H / 2, 0.4, 0.8, ovl2);
          } else if (col.door) doorFrame(x, top);
          else {
            // The lamps hang inside the rooms, so the column's front face only catches grazing light: half the lamp light and a little less ambient.
            const cc = add(colTex, x - cw / 2, top - 1, cw, ROOM_H + 2, cscale, x, top + ROOM_H / 2, 0.5, 0.8);
            cc.tilePosition.set(0, 0);
            // [plan4:ST-11] Column variants: lattice-laced steel or a structural pipe laid over the kit column; the east wall column carries the floor's number.
            const over = latticeTex ?? pipeColTex;
            if (over) addLit(over, x - cw / 2, top - 1, cw, ROOM_H + 2, x, top + ROOM_H / 2, 0.5, 0.8, ovl2);
            if (idOn && !col.r) addLit(floorNumberTexture(f, sty.band), x - 9, ceil + 7, 16, 9, x, top + ROOM_H / 2, 0.4, 0.8, ovl2);
          }
          // Base and cap plates where the column meets the slabs.
          const plates = new Graphics();
          for (const py of [top + PIPES_Y + PIPES_H - 1, top + ROOM_H - LIP - 4]) {
            plates.rect(x - cw / 2 - 1.5, py, cw + 3, 4).fill(0x26282a);
            plates.rect(x - cw / 2 - 1.5, py, cw + 3, 1).fill({ color: 0x8a8f94, alpha: 0.35 });
          }
          // [plan4:ST-11] The kind's paint band just under the cap plate of every steel column.
          if (idOn && !col.open && !col.door) {
            plates.rect(x - cw / 2, ceil + 3, cw, 3.2).fill(woodAt(sty.band, top + ROOM_H / 2));
            plates.rect(x - cw / 2, ceil + 3, cw, 0.7).fill({ color: 0xffffff, alpha: 0.22 });
          }
          if (!isVoid) root.addChild(plates);
          const op = !col.open && !col.door && !isVoid ? ops.get(Math.round(x)) : undefined;
          if (op) {
            if (!dgf) { dgf = new Graphics(); doors.addChild(dgf); }
            doorway(dgf, x, top, op, sty, op.kind === 'stub' && op.rightId === null ? 1 : -1);
          }
          for (const side of [-1, 1] as const) {
            const edge = x + side * cw / 2;
            // The outer walls only have a room on their inner side.
            if (side < 0 ? !col.l : !col.r) continue;
            // Ambient occlusion: the room darkens toward the column, most of all in the corners.
            shade(fadeH, side < 0 ? edge - aoW : edge, ceil, aoW, floorY - ceil, 0.55, side < 0);
            const cxx = edge + side * 2;
            if (!inSpan(cxx - 1, cxx + 1, above)) shade(blob, cxx - 14, ceil - 9, 28, 24, 0.62);
            if (!inSpan(cxx - 1, cxx + 1, below)) shade(blob, cxx - 14, floorY - 15, 28, 24, 0.68);
            // Light from the lamps on this side catches the column face.
            let strength = 0;
            let best: WorldLamp | null = null;
            let bestV = 0;
            for (const l of floorLamps) {
              if (Math.sign(l.x - x) !== side) continue;
              const R = l.reach * 0.9;
              const d = Math.abs(l.x - x);
              if (d >= R) continue;
              const v = l.power * (1 - d / R) ** 2;
              strength += v;
              if (v > bestV) {
                bestV = v;
                best = l;
              }
            }
            if (!best || strength < 0.05) continue;
            const s = new Sprite(streak);
            s.anchor.set(0.5, 0);
            s.tint = idOn ? kindLight(best.color, sty.light, 0.25) : best.color;
            s.width = COLUMN_SPILL_W;
            s.height = floorY - ceil + 6;
            s.position.set(x + side * (cw / 2 - 2), ceil - 3);
            spill.addChild(s);
            spills.push({ s, a: 0.3 * Math.min(1, strength * 3), room: roomIndex(best.room) });
          }
          if (!(airy && col.tier === 0) && !inSpan(x - 1, x + 1, below) && hr(f + 977, x) < 0.75) guide(x, floorY, idOn ? sty : undefined);
        }
        // [airy2:D3] The stair tower is one tall stair through every floor, in front of the rock where there is one and in front of a bridging room where there is not. A storey
        // runs from the lane of floor f-1 to the lane of floor f, so it is drawn with floor f (in this chunk row, above the void strip of floor f-1 and under none of the next).
        if (airy && f >= 1) for (const sl of voidBoundaries(grid)) {
          const vx = slotX(sl);
          if (sl >= Math.min(ee, grid.ext[f - 1].e) || !mineCol({ x: vx, l: true, r: true })) continue;
          towerStorey(vx, f - 1);
        }
      }
      root.addChild(ovl2);
      root.addChild(fixtures);
      root.addChild(timbers);
      root.addChild(doors);
    }

    for (let f = fa; f < fb; f++) {
      for (const l of this.lampsByFloor[f] ?? []) {
        if (!l.ceiling || !mine(l.x, grid.ext[f])) continue;
        const top = floorTop(f);
        const room = roomIndex(l.room);
        const ceilGlow = new Sprite(glow);
        ceilGlow.anchor.set(0.5);
        ceilGlow.tint = idOn ? kindLight(l.color, styleOf(f).light, 0.3) : l.color; // [plan4:ST-11]
        ceilGlow.width = l.reach * 0.95;
        ceilGlow.height = 22;
        ceilGlow.position.set(l.x, top + PIPES_Y + PIPES_H / 2);
        spill.addChild(ceilGlow);
        spills.push({ s: ceilGlow, a: 0.3 * l.power, room });
        const pool = new Sprite(glow);
        pool.anchor.set(0.5);
        pool.tint = idOn ? kindLight(l.color, styleOf(f).light, 0.3) : l.color; // [plan4:ST-11]
        pool.width = l.reach * 0.85;
        pool.height = 12;
        pool.position.set(l.x, top + ROOM_H);
        spill.addChild(pool);
        spills.push({ s: pool, a: 0.2 * l.power, room });
      }
    }
    ao.visible = root.visible = spill.visible = false;
    c.container = root;
    c.parts = [ao, root, spill];
    c.shown = false;
    c.stamp = 0;
    let row = this.rows.get(c.cy);
    if (!row) {
      const group = new Container();
      group.label = 'frontRow';
      group.eventMode = 'none';
      group.isRenderGroup = true;
      const rao = new Container(), rmain = new Container(), rspill = new Container();
      rspill.blendMode = 'add';
      group.addChild(rao, rmain, rspill);
      row = { group, ao: rao, main: rmain, spill: rspill };
      this.rows.set(c.cy, row);
      this.container.addChild(group);
    }
    row.ao.addChild(ao);
    row.main.addChild(root);
    row.spill.addChild(spill);
    this.built++;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.chunks.clear();
    this.list = [];
  }
}

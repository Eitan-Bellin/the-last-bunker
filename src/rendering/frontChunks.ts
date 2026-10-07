import { Container, Graphics, Sprite, TilingSprite, type Texture } from 'pixi.js';
import type { BuildingInstance } from '../core/GameState';
import { glowTexture } from '../art/ArtLibrary';
import { roomFlicker } from './paintedRoom';
import { VIEW } from './perfFx';
import { BASE_EAST, ROOMS_X, ROOM_H, SHAFT_GAP, SLAB, SLOT_W, TOPSOIL, floorAtY, floorTop, slotX, type Ext } from './layout';
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
    this.lampsByFloor = Array.from({ length: floors }, () => []);
    for (const l of lamps) {
      const f = floorAtY(l.y).floor;
      if (f >= 0 && f < floors) this.lampsByFloor[f].push(l);
    }
    const ids = [...new Set(lamps.map(l => l.room).filter((r): r is string => !!r))];
    this.roomIds = ids;
    this.roomIdx = new Map(ids.map((r, i) => [r, i]));
    this.flicker = new Array(ids.length + 1).fill(1);
    const gsig = `${st}|${ambient.toFixed(3)}|${kitTex('pipes', st)?.uid}.${kitTex('slab', st)?.uid}.${kitTex('column', st)?.uid}`;
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
          cx, cy, x0: chunkX0(cx) - 22, x1: chunkX1(cx) + 22, y0: cy === 0 ? TOPSOIL - SLAB - 8 : yTop, y1: yBot, sig, container: null, parts: [],
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
      parts.push(`${f}:${e.w},${e.e}`);
      if (f >= fa) {
        let row = '';
        for (let sl = sLo; sl <= sHi; sl++) row += (cellAt(grid, f, sl)?.key ?? '-') + ',';
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
        for (const l of c.lit) l.node.tint = shadeAt(lightOf(l.base, l.parts, power, this.flicker, night), l.y);
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
    const glow = glowTexture();
    const lit: Lit[] = c.lit = [];
    const spills: Chunk['spills'] = c.spills = [];
    const guides: Chunk['guides'] = c.guides = [];
    const markers: Chunk['markers'] = c.markers = [];
    const spill = new Container();
    const ao = new Container();
    const fixtures = new Graphics();
    const timbers = new Container();
    const flicker = this.flicker;
    const roomIndex = this.roomIndex;
    // Only the lamps that can reach this chunk matter to the pieces in it.
    const ya = floorTop(fa) - 120, yb = floorTop(Math.max(fa, fb - 1)) + ROOM_H + 120;
    const near = this.lamps.filter(l => l.x > c.x0 - l.reach * 1.7 && l.x < c.x1 + l.reach * 1.7 && l.y > ya && l.y < yb);
    // A piece belongs to the chunk of its middle; one hanging past the end of a floor (the wall end of a slab, the last stub of a pipe) to the last chunk of that floor.
    const mine = (x: number, ext: Ext = { w: 0, e: BASE_EAST }) => cxOfX(Math.min(Math.max(x, ext.w > 0 ? slotX(-ext.w) + 0.01 : 0), slotX(ext.e) - 0.01)) === cx;
    // A column belongs to the chunk of the room it stands against (an east-facing end to the one on its right).
    const mineCol = (col: { x: number; l: boolean; r: boolean }) => cxOfX(col.x + (col.r && !col.l ? 0.01 : -0.01)) === cx;

    const add = (tex: Texture, x: number, y: number, w: number, h: number, scale: number, ccx: number, ccy: number, lampGain = 1, baseGain = 1) => {
      const t = new TilingSprite({ texture: tex, width: w, height: h });
      t.position.set(x, y);
      t.tileScale.set(scale);
      // Keep the pattern continuous across segments.
      t.tilePosition.set(-x, 0);
      const parts = lampParts(ccx, ccy, near, roomIndex);
      for (let i = 1; i < parts.length; i += 2) parts[i] *= lampGain;
      const node: Lit = { node: t, base: Math.min(0.9, ambient * lift * baseGain), parts, y: ccy };
      lit.push(node);
      t.tint = shadeAt(lightOf(node.base, node.parts, 1, flicker), ccy);
      root.addChild(t);
      return t;
    };
    const addLit = (tex: Texture, x: number, y: number, w: number, h: number, ccx: number, ccy: number, lampGain: number, baseGain: number) => {
      const sp = new Sprite(tex);
      sp.position.set(x, y);
      sp.width = w;
      sp.height = h;
      const parts = lampParts(ccx, ccy, near, roomIndex);
      for (let i = 1; i < parts.length; i += 2) parts[i] *= lampGain;
      const node: Lit = { node: sp, base: Math.min(0.9, ambient * lift * baseGain), parts, y: ccy };
      lit.push(node);
      sp.tint = shadeAt(lightOf(node.base, node.parts, 1, flicker), ccy);
      root.addChild(sp);
    };
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
      for (let f = fa; f < fb; f++) {
        const spans = hallSpans(buildings, f - 1);
        const y = floorTop(f) + PIPES_Y;
        const { w: ew, e: ee } = grid.ext[f];
        const runs: [number, number][] = gridSegments(64 - 26, slotX(ee) + 6, SLOT_W / 2);
        if (ew > 0) runs.push(...gridSegments(slotX(-ew) - 6, 20, SLOT_W / 2, true));
        for (const [x, x1] of runs) {
          const w = x1 - x;
          if (!mine((x + x1) / 2, grid.ext[f]) || inSpan(x, x1, spans)) continue;
          add(pipeTex, x, y, w, PIPES_H, PIPES_H / pipeTex.height, x + w / 2, y + PIPES_H / 2);
        }
      }
    }

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
      const lines: { y: number; spans: [number, number][]; ext: Ext }[] = [];
      if (cy === 0) lines.push({ y: TOPSOIL - SLAB - LIP, spans: [], ext: slabExt(grid.ext, floors, 0) });
      for (let f = fa; f < fb; f++) lines.push({ y: floorTop(f) + ROOM_H - LIP, spans: hallSpans(buildings, f), ext: slabExt(grid.ext, floors, f + 1) });
      for (const line of lines) {
        const sx0 = (line.ext.w > 0 ? slotX(-line.ext.w) : 0) - 12, sx1 = slotX(line.ext.e) + 12;
        for (const [x, x1] of gridSegments(sx0, sx1, SLOT_W, line.ext.w > 0)) {
          const w = x1 - x;
          if (!mine((x + x1) / 2, line.ext) || inSpan(x, x1, line.spans)) continue;
          add(slabTex, x, line.y, w, SLAB_DRAW, scale, x + w / 2, line.y + SLAB_DRAW / 2);
          // The nosing catches the lamps of the room standing on it.
          addLit(lip, x, line.y, w, 6, x + w / 2, line.y - 6, 1.5, 0.95);
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

    // Warm night guide lights at the column feet (fixture always there, lit only at night).
    const guide = (x: number, floorY: number) => {
      const fy = floorY - 13;
      fixtures.rect(x - 2.4, fy - 1.3, 4.8, 2.8).fill(0x1e1c1a);
      fixtures.rect(x - 1.7, fy - 0.5, 3.4, 1.3).fill(0x6a4420);
      for (const [tint, w, h, y, a] of [[0xffc878, 6, 3.5, fy + 0.2, 0.9], [0xff9a3c, 30, 22, fy + 5, 0.42], [0xff9040, 46, 8, floorY + 0.5, 0.38]]) {
        const g = new Sprite(glow);
        g.anchor.set(0.5);
        g.tint = tint;
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
    const woodAt = (col: number, y: number) => {
      const [r, g, b] = depthGains(y);
      const ch = (sh: number, k: number) => Math.round(Math.min(255, ((col >> sh) & 255) * k * (0.55 + 0.45 * ambient * lift)));
      return (ch(16, r) << 16) | (ch(8, g) << 8) | ch(0, b);
    };
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

    if (colTex) {
      const scale = COLUMN_W / colTex.width;
      const fadeH = softTexture('fadeH');
      const blob = softTexture('blob');
      for (let f = fa; f < fb; f++) {
        const top = floorTop(f);
        const row = grid[f];
        const { w: ew, e: ee } = grid.ext[f];
        const xs: { x: number; l: boolean; r: boolean; open: boolean; door?: boolean }[] = [
          { x: ROOMS_X, l: false, r: true, open: false }, { x: slotX(ee), l: true, r: false, open: ee > BASE_EAST },
        ];
        for (let i = 1; i < row.length; i++) {
          const sl = i - ew;
          if (sl === 0) continue; // the shaft stands between the last west slot and slot 0
          const a = row[i - 1], b = row[i];
          if ((a || b) && a?.key !== b?.key) xs.push({ x: slotX(sl), l: true, r: true, open: false });
        }
        if (ew > 0) xs.push({ x: slotX(-ew), l: false, r: true, open: true }, { x: -SHAFT_GAP, l: true, r: false, open: false, door: true });
        const ceil = top + PIPES_Y + PIPES_H;
        const floorY = top + ROOM_H - LIP;
        const above = hallSpans(buildings, f - 1);
        const below = hallSpans(buildings, f);
        const floorLamps = this.lampsByFloor[f] ?? [];
        for (const col of xs) {
          const x = col.x;
          if (!mineCol(col)) continue;
          if (col.open) timberEnd(x, top, x < 0 ? 1 : -1);
          else if (col.door) doorFrame(x, top);
          else {
            // The lamps hang inside the rooms, so the column's front face only catches grazing light: half the lamp light and a little less ambient.
            const cc = add(colTex, x - COLUMN_W / 2, top - 1, COLUMN_W, ROOM_H + 2, scale, x, top + ROOM_H / 2, 0.5, 0.8);
            cc.tilePosition.set(0, 0);
          }
          // Base and cap plates where the column meets the slabs.
          const plates = new Graphics();
          for (const py of [top + PIPES_Y + PIPES_H - 1, top + ROOM_H - LIP - 4]) {
            plates.rect(x - COLUMN_W / 2 - 1.5, py, COLUMN_W + 3, 4).fill(0x26282a);
            plates.rect(x - COLUMN_W / 2 - 1.5, py, COLUMN_W + 3, 1).fill({ color: 0x8a8f94, alpha: 0.35 });
          }
          root.addChild(plates);
          for (const side of [-1, 1] as const) {
            const edge = x + side * COLUMN_W / 2;
            // The outer walls only have a room on their inner side.
            if (side < 0 ? !col.l : !col.r) continue;
            // Ambient occlusion: the room darkens toward the column, most of all in the corners.
            shade(fadeH, side < 0 ? edge - AO_SIDE : edge, ceil, AO_SIDE, floorY - ceil, 0.55, side < 0);
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
            s.tint = best.color;
            s.width = COLUMN_SPILL_W;
            s.height = floorY - ceil + 6;
            s.position.set(x + side * (COLUMN_W / 2 - 2), ceil - 3);
            spill.addChild(s);
            spills.push({ s, a: 0.3 * Math.min(1, strength * 3), room: roomIndex(best.room) });
          }
          if (!inSpan(x - 1, x + 1, below) && hr(f + 977, x) < 0.75) guide(x, floorY);
        }
      }
      root.addChild(fixtures);
      root.addChild(timbers);
    }

    for (let f = fa; f < fb; f++) {
      for (const l of this.lampsByFloor[f] ?? []) {
        if (!l.ceiling || !mine(l.x, grid.ext[f])) continue;
        const top = floorTop(f);
        const room = roomIndex(l.room);
        const ceilGlow = new Sprite(glow);
        ceilGlow.anchor.set(0.5);
        ceilGlow.tint = l.color;
        ceilGlow.width = l.reach * 0.95;
        ceilGlow.height = 22;
        ceilGlow.position.set(l.x, top + PIPES_Y + PIPES_H / 2);
        spill.addChild(ceilGlow);
        spills.push({ s: ceilGlow, a: 0.3 * l.power, room });
        const pool = new Sprite(glow);
        pool.anchor.set(0.5);
        pool.tint = l.color;
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

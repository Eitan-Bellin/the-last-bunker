import { Container, FillPattern, Graphics, Matrix, NineSliceSprite, Rectangle, Sprite, Texture, TilingSprite, type FillGradient } from 'pixi.js';
import type { BuildingInstance, Ruin } from '../core/GameState';
import { isDistrict, isHall, roomSlots } from '../data/buildingDefs';
import { ArtLibrary, glowTexture } from '../art/ArtLibrary';
import { BASE_EAST, BUILDING_W, FLOOR_H, ROOMS_W, ROOMS_X, ROOM_H, SHAFT_GAP, SHAFT_W, SLAB, SLOT_W, TOPSOIL, floorAtY, floorFrac, floorTop, galleryCount, galleryExt, galleryTop, slotX, type Ext } from './layout';
import { ERAS } from '../data/eras';
import { GFX } from './gfxFeatures';
import { roomFlicker } from './paintedRoom';
import { seeded, vGradient } from './draw';
import type { Animated } from './world';

/**
 * Graphics overhaul (G1+): the bunker's structure built from the painted kit instead of flat shapes —
 * concrete casing, slab profiles, riveted steel columns between rooms, a pipe bundle under every ceiling,
 * excavated bays in empty slots, and lamp light that falls on all of it.
 * On by default; the old flat look stays behind ?gfx1 (and ?gfx2 brings the new one back).
 */

const FLAG_KEY = 'lastbunker_gfx2';

export function gfx2Enabled(): boolean {
  const p = new URLSearchParams(location.search);
  // The painted look is the default since the overhaul shipped; ?gfx1 keeps the old one (remembered), ?gfx2 returns.
  try {
    if (p.has('gfx2')) localStorage.setItem(FLAG_KEY, '1');
    if (p.has('gfx1')) localStorage.setItem(FLAG_KEY, '0');
    return localStorage.getItem(FLAG_KEY) !== '0';
  } catch {
    return !p.has('gfx1');
  }
}

/** Kit state by era: the Remnant is wrecked (R), the Restoration patched up (F), the Colony and Undercity cared for (L). */
export type KitState = 'R' | 'F' | 'L';

export function kitState(era: number): KitState {
  return era <= 0 ? 'R' : era === 1 ? 'F' : 'L';
}

const MATERIALS = ['wall', 'slab', 'column', 'pipes'] as const;
export type Material = typeof MATERIALS[number];

export const KIT_KEYS = [
  ...MATERIALS.flatMap(m => ['F', 'R', 'L'].map(st => `kit/${m}-${st}`)), 'kit/bay-A-wide', 'kit/bay-A-narrow',
];

/** The material in the era's state, falling back to the restored look while it loads. */
export function kitTex(m: Material, st: KitState): Texture | null {
  return ArtLibrary.get(`kit/${m}-${st}`) ?? ArtLibrary.get(`kit/${m}-F`);
}

/** True once the base kit is decoded (callers request them through ArtLibrary.get first). */
export function kitReady(): boolean {
  return [...MATERIALS.map(m => `kit/${m}-F`), 'kit/bay-A-wide', 'kit/bay-A-narrow'].every(k => ArtLibrary.get(k));
}

/** Slab profile drawn over the floor line: the room's bottom lip plus the slab itself. */
const LIP = 3;
const SLAB_DRAW = SLAB + LIP;
const COLUMN_W = 9;
const PIPES_Y = 1;
const PIPES_H = 11;
/** Ambient occlusion: dark ramp beside every column, contact line where a room floor meets the slab lip. */
const AO_SIDE = 8;
const AO_CONTACT = 4;
/** Width of the lamp light caught on a column face. */
const COLUMN_SPILL_W = 10;
/** Brightest a lamp-lit structure tint gets (1 = the kit texture as painted). */
const LIT_MAX = 1.02;
/** Ambient lift per kit state, against how dark each kit is painted. */
const KIT_LIFT: Record<KitState, number> = { R: 1.8, F: 1.25, L: 1 };

/**
 * Underground night (gfx-p0 light): 0 = day .. 1 = night, set every frame by PostFX from the bunker clock.
 * The unlit structure sinks and warm guide lights come on at the column feet.
 */
export const nightLight = { k: 0 };

/** Section-cut casing (gfx-p0 light): outer face of the west wall; the shaft's back wall is its inner face (x = 0). */
const WALL_W_OUT = -30;
/** Outer face of the east wall (the districts open 18 u past the rooms, so it stays slimmer). */
const WALL_E_OUT = BUILDING_W + 14;
/** Backfill gravel between the walls and the cut rock. */
const BACKFILL = 9;

/** A lamp in world space, from the painted lamp spots of a room. */
export interface WorldLamp {
  x: number;
  y: number;
  /** Width of the room it hangs in (sets how far its light reaches). */
  reach: number;
  color: number;
  /** 0..1: a big ceiling lamp is ~0.9, a small light ~0.35. */
  power: number;
  /** Ceiling lamps throw a pool on the ceiling and the floor. */
  ceiling: boolean;
  /** The room it belongs to. */
  room?: string;
}

type Cell = { key: string } | null;

/**
 * [plan4:ST-4] The occupancy of every floor: row f holds the floor's slots from -w to e - 1 (index i = slot i - w; slot 0 is the first east of the shaft, the
 * shaft itself is not a cell), `ext[f]` is the {w, e} the row was built for. A bunker with no wings has rows of 12 and w = 0, as before.
 */
export type Grid = Cell[][] & { ext: Ext[] };

/** The cell of slot s on floor f (null outside the floor's reach). */
export function cellAt(grid: Grid, f: number, s: number): Cell {
  return grid[f]?.[s + (grid.ext[f]?.w ?? 0)] ?? null;
}

/** What stands in every slot of every floor: a compound key per room/ruin, or null for an empty bay. */
export function occupancy(buildings: BuildingInstance[], ruins: Ruin[], floors: number, exts: readonly Ext[] = []): Grid {
  const ext: Ext[] = Array.from({ length: floors }, (_, f) => exts[f] ?? { w: 0, e: BASE_EAST });
  const grid = ext.map(x => Array.from({ length: x.w + x.e }, () => null as Cell)) as Grid; // [plan4:X-2] one row = the floor's slots (the default extent: 12 east)
  grid.ext = ext;
  const put = (f: number, x: number, w: number, key: string) => {
    if (f < 0 || f >= floors) return;
    const o = ext[f].w;
    for (let i = x; i < x + w; i++) if (i + o >= 0 && i + o < grid[f].length) grid[f][i + o] = { key };
  };
  for (const b of buildings) {
    if (isDistrict(b.type)) continue;
    const fresh = b.isConstructing && b.level === 1;
    // Same-type, same-level neighbours open into one compound (no column between them).
    const key = fresh ? b.id : `${b.type}:${b.level}`;
    const w = roomSlots(b.type);
    put(b.position.floor, b.position.x, w, isHall(b.type) ? b.id : key);
    if (isHall(b.type)) put(b.position.floor + 1, b.position.x, w, b.id);
  }
  for (const r of ruins) put(r.floor, r.x, r.w, r.id);
  return grid;
}

/** Halls on floor f swallow the slab under f (and the ceiling of f+1) across their width. */
function hallSpans(buildings: BuildingInstance[], floor: number): [number, number][] {
  return buildings.filter(b => isHall(b.type) && b.position.floor === floor)
    .map(b => [slotX(b.position.x), slotX(b.position.x) + roomSlots(b.type) * SLOT_W]);
}

const inSpan = (x0: number, x1: number, spans: [number, number][]) => spans.some(([a, b]) => x0 >= a - 0.5 && x1 <= b + 0.5);

/** Segment edges from x0 to x1 that land on the slot grid (so a hall's span is always whole segments). */
function gridSegments(x0: number, x1: number, step: number, west = false): [number, number][] {
  const edges = [x0];
  // [plan4:ST-4] West of the shaft the slot grid is anchored at its west edge (slotX(-1) + SLOT_W = -SHAFT_GAP).
  if (west) {
    const w: number[] = [];
    for (let x = -SHAFT_GAP; x > x0; x -= step) if (x < x1) w.push(x);
    for (let i = w.length - 1; i >= 0; i--) edges.push(w[i]);
  }
  for (let x = ROOMS_X; x < x1; x += step) if (x > x0) edges.push(x);
  edges.push(x1);
  const out: [number, number][] = [];
  for (let i = 0; i < edges.length - 1; i++) if (edges[i + 1] - edges[i] > 0.5) out.push([edges[i], edges[i + 1]]);
  return out;
}

/** Empty slots become excavated bays: rough rock, timber shoring and a work lamp. Sits behind the rooms. */
export function buildBays(grid: Grid): Container {
  const root = new Container();
  const wide = ArtLibrary.get('kit/bay-A-wide');
  const narrow = ArtLibrary.get('kit/bay-A-narrow');
  if (!wide || !narrow) return root;
  const single = new Texture({ source: narrow.source, frame: new Rectangle(narrow.width / 4, 0, narrow.width / 2, narrow.height) });
  for (let f = 0; f < grid.length; f++) {
    let n = 0;
    const { w: ew, e: ee } = grid.ext[f];
    // [plan4:ST-4] The shaft splits the floor into its west wing and its east part: an empty run never crosses it.
    for (const [lo, width] of [[-ew, 0], [0, ee]] as [number, number][]) {
    let s = lo;
    while (s < width) {
      if (grid[f][s + ew]) { s++; continue; }
      let e = s;
      while (e < width && !grid[f][e + ew]) e++;
      let run = e - s;
      let x = s;
      while (run > 0) {
        // 4 splits as 2+2 so no lonely single is left over.
        const take = run === 4 ? 2 : run >= 3 ? 3 : run;
        const tex = take === 3 ? wide : take === 2 ? narrow : single;
        const sp = new Sprite(tex);
        sp.width = take * SLOT_W;
        sp.height = ROOM_H;
        sp.position.set(slotX(x), floorTop(f));
        if (n++ % 2 === 1) {
          sp.scale.x *= -1;
          sp.x += take * SLOT_W;
        }
        const [dr, dg, db] = depthGains(floorTop(f) + ROOM_H / 2);
        sp.tint = (Math.round(0xa4 * dr) << 16) | (Math.round(0xa0 * dg) << 8) | Math.round(0x9a * db);
        root.addChild(sp);
        // The painted work lamp gives off a little real light (single slots crop it away).
        if (take > 1) {
          const g = new Sprite(glowTexture());
          g.anchor.set(0.5);
          g.tint = 0xffc070;
          g.blendMode = 'add';
          g.alpha = 0.35;
          g.width = take * SLOT_W * 0.9;
          g.height = ROOM_H * 0.7;
          g.position.set(slotX(x) + take * SLOT_W * 0.5, floorTop(f) + ROOM_H * 0.3);
          root.addChild(g);
        }
        x += take;
        run -= take;
      }
      s = e;
    }
    }
  }
  return root;
}

/** [plan4:ST-4,ST-6] One horizontal slice of the shell with its own reach. */
interface CasingBlock {
  /** Top and bottom y of the slice (the steps between slices sit in the middle of a slab). */
  y0: number;
  y1: number;
  /** Outer faces of the walls (west / east) and the inner faces the rooms sit between. */
  xl: number;
  xr: number;
  xinL: number;
  xinR: number;
  w: number;
  e: number;
}

/** Outer and inner wall faces of a floor reaching {w, e}: no west wing keeps the thick concrete strip beside the shaft (x -30 .. 0). */
function wallFaces(ext: Ext): { xl: number; xr: number; xinL: number; xinR: number } {
  const xinL = ext.w > 0 ? slotX(-ext.w) : 0;
  const xinR = slotX(ext.e);
  return { xl: ext.w > 0 ? xinL - 14 : WALL_W_OUT, xr: xinR + 14, xinL, xinR };
}

/**
 * The shell's slices from the roof to the footing: one row per floor and per gallery with its extent, neighbours with the same reach merged.
 * The step between two different slices sits in the middle of the slab between them (a concrete shoulder), and the slice below a gallery starts
 * just above its ceiling pipes.
 */
function casingBlocks(floors: number, exts: readonly Ext[], top: number, bottom: number): CasingBlock[] {
  const rows: { y: number; ext: Ext }[] = [];
  const nG = galleryCount(floors);
  for (let f = 0; f < floors; f++) {
    const afterGallery = f > 0 && (f & 3) === 0 && floorTop(f) - floorTop(f - 1) > FLOOR_H;
    rows.push({ y: f === 0 ? top : afterGallery ? floorTop(f) - 3 : floorTop(f) - SLAB / 2, ext: exts[f] ?? { w: 0, e: BASE_EAST } });
    if ((f & 3) === 3 && (f >> 2) < nG) rows.push({ y: galleryTop(f >> 2) - SLAB / 2, ext: galleryExt(exts, f >> 2) });
  }
  const blocks: CasingBlock[] = [];
  for (let i = 0; i < rows.length; i++) {
    const { ext, y } = rows[i];
    const prev = blocks[blocks.length - 1];
    if (prev && prev.w === ext.w && prev.e === ext.e) continue;
    if (prev) prev.y1 = y;
    blocks.push({ y0: y, y1: bottom, w: ext.w, e: ext.e, ...wallFaces(ext) });
  }
  return blocks;
}

/** The shell's slab line k (0 = the roof slab, k = the slab under floor k - 1): as wide as the widest of the two rows it joins. */
export function slabExt(exts: readonly Ext[], floors: number, k: number): Ext {
  const base = exts[Math.max(0, Math.min(floors - 1, k === 0 ? 0 : k - 1))] ?? { w: 0, e: BASE_EAST };
  let w = base.w, e = base.e;
  if (k > 0 && k < floors) {
    const below = exts[k] ?? base;
    w = Math.max(w, below.w);
    e = Math.max(e, below.e);
  }
  if (k > 0 && ((k - 1) & 3) === 3 && ((k - 1) >> 2) < galleryCount(floors)) {
    const gx = galleryExt(exts, (k - 1) >> 2);
    w = Math.max(w, gx.w);
    e = Math.max(e, gx.e);
  }
  return { w, e };
}

/** Y of the middle of slab line k (for the pour joint). */
function slabMidY(k: number): number {
  return k === 0 ? TOPSOIL - SLAB / 2 : floorTop(k - 1) + ROOM_H + SLAB / 2;
}

/**
 * The bunker's shell as a section cut (gfx-p0 light): thick walls of sawn concrete (aggregate, rebar cut through,
 * pour joints, hairline cracks, chipped outer edge and footings) bedded in backfill gravel inside a darker
 * excavation in the rock. The kit wall stays as the back wall behind the rooms. Replaces the dark overbreak rim.
 *
 * [plan4:ST-6] Stepped: the outline follows each floor's (and gallery's) reach, with a concrete shoulder in the slab wherever neighbouring rows differ
 * and the rock showing in the notch. A bunker with every floor at the default {w: 0, e: 12} is one slice and draws exactly as before.
 */
export function buildCasing(floors: number, st: KitState = 'F', exts: readonly Ext[] = []): Container {
  const root = new Container();
  root.eventMode = 'none';
  const wall = kitTex('wall', st);
  const top = TOPSOIL - SLAB - 4;
  const base = floorTop(floors);
  const bottom = base + 12;
  const rnd = seeded(4242);
  // [plan4:X-6] With the strata switch off the shell is one slice as wide as the widest floor (a regression check against the stepped one).
  const wide = exts.reduce((m, x) => ({ w: Math.max(m.w, x.w), e: Math.max(m.e, x.e) }), { w: 0, e: BASE_EAST });
  const blocks = casingBlocks(floors, GFX.strata ? exts : exts.map(() => wide), top, bottom);
  const first = blocks[0], last = blocks[blocks.length - 1];
  const blockAt = (y: number): CasingBlock => {
    for (const b of blocks) if (y < b.y1) return b;
    return last;
  };
  const x0 = first.xl, x1 = first.xr;
  const lx0 = last.xl, lx1 = last.xr; // the footing sits under the last slice
  const stepped = blocks.length > 1;

  // The excavation: rock darkens toward the hole (one soft frame per slice).
  for (const b of blocks) {
    const isLast = b === last;
    const halo = new NineSliceSprite({ texture: haloTexture(), leftWidth: 30, rightWidth: 30, topHeight: 30, bottomHeight: 30 });
    halo.position.set(b.xl - BACKFILL - 34, b.y0 - 24);
    halo.width = b.xr - b.xl + 2 * (BACKFILL + 34);
    halo.height = b.y1 - b.y0 + 24 + (isLast ? BACKFILL + 40 : 24);
    halo.tint = 0x000000;
    halo.alpha = 0.62;
    root.addChild(halo);
  }

  // Backfill: compacted gravel against the walls, out to a ragged rock cut.
  const fill = new Graphics();
  const pts: number[] = [];
  const pad = () => BACKFILL * (0.55 + rnd() * 0.75);
  const y1 = bottom + 4;
  for (let x = x0 - BACKFILL; x <= x1 + BACKFILL; x += 9) pts.push(x, top - 4 - rnd() * 4);
  let pb = blockAt(top);
  for (let y = top; y <= y1; y += 9) {
    const b = blockAt(y);
    if (b !== pb) { pts.push(pb.xr + BACKFILL * 0.8, b.y0, b.xr + BACKFILL * 0.8, b.y0); pb = b; }
    pts.push(b.xr + pad(), y);
  }
  for (let x = lx1 + BACKFILL; x >= lx0 - BACKFILL; x -= 9) pts.push(x, y1 + pad());
  pb = blockAt(y1);
  for (let y = y1; y >= top; y -= 9) {
    const b = blockAt(y);
    if (b !== pb) { pts.push(pb.xl - BACKFILL * 0.8, pb.y0, b.xl - BACKFILL * 0.8, pb.y0); pb = b; }
    pts.push(b.xl - pad(), y);
  }
  fill.poly(pts).fill({ fill: pattern('fill', 36), color: 0x8a8076 });
  fill.poly(pts).fill(depthFog(top, y1 + BACKFILL));
  root.addChild(fill);

  // The concrete ring, cut by the section plane: chipped outer edges, wider footings under both walls.
  const ring = new Graphics();
  const out: number[] = [];
  const chip = () => (rnd() < 0.18 ? 1.2 + rnd() * 2.2 : rnd() * 0.9);
  const foot = 12;
  for (let x = x0; x <= x1; x += 6) out.push(x, top + chip() * 0.4);
  pb = blockAt(top + 6);
  for (let y = top + 6; y < bottom - 16; y += 5) {
    const b = blockAt(y);
    if (b !== pb) { out.push(pb.xr, b.y0, b.xr, b.y0); pb = b; }
    out.push(b.xr - chip(), y);
  }
  out.push(lx1, bottom - 16, lx1 + foot - chip(), bottom - 14, lx1 + foot - chip(), bottom + 3);
  for (let x = lx1 + foot - 4; x > lx0 - foot + 4; x -= 6) out.push(x, bottom + 3 - chip() * 0.6);
  out.push(lx0 - foot + chip(), bottom + 3, lx0 - foot + chip(), bottom - 14, lx0, bottom - 16);
  pb = blockAt(bottom - 21);
  for (let y = bottom - 21; y > top + 4; y -= 5) {
    const b = blockAt(y);
    if (b !== pb) { out.push(pb.xl, pb.y0, b.xl, pb.y0); pb = b; }
    out.push(b.xl + chip(), y);
  }
  ring.poly(out).fill({ fill: pattern('cut', 40), color: 0x6e675e });
  ring.poly(out).fill(depthFog(top, bottom));
  root.addChild(ring);

  // The back wall behind the rooms (seen in the gaps between them), one piece per slice, the pattern continuous across them.
  if (wall) {
    for (const b of blocks) {
      const yEnd = b === last ? base : b.y1;
      const back = new TilingSprite({ texture: wall, width: b.xinR - b.xinL, height: yEnd - b.y0 });
      back.position.set(b.xinL, b.y0);
      back.tileScale.set(64 / wall.width);
      back.tilePosition.set(-b.xinL, top - b.y0);
      back.tint = 0x4c4c4c;
      root.addChild(back);
    }
  }

  // Details on the cut face: contact shadows, pour joints, rebar cut through, rust bleed, cracks, a few stubs.
  const fadeH = softTexture('fadeH');
  const drop = softTexture('drop');
  const shadow = (tex: Texture, x: number, y: number, w: number, h: number, a: number, flipX = false) => {
    const sp = new Sprite(tex);
    sp.tint = 0x000000;
    sp.alpha = a;
    sp.width = w;
    sp.height = h;
    sp.position.set(x, y);
    if (flipX) {
      sp.scale.x *= -1;
      sp.x += w;
    }
    root.addChild(sp);
  };
  // Backfill darkens into the joint against the wall.
  for (const b of blocks) {
    const h = (b === last ? bottom - 14 : b.y1) - b.y0;
    shadow(fadeH, b.xl - 6, b.y0, 6, h, 0.55, true);
    shadow(fadeH, b.xr, b.y0, 6, h, 0.55);
  }
  shadow(drop, lx0 - foot, bottom + 3, lx1 - lx0 + 2 * foot, 7, 0.5);
  // Inner faces: the shaft and the rooms sit in a slot, a soft dark where the wall turns the corner.
  for (const b of blocks) {
    const h = (b === last ? base : b.y1) - b.y0;
    shadow(fadeH, b.xinL - 7, b.y0, 7, h, 0.35, true);
    shadow(fadeH, b.xinR, b.y0, 7, h, 0.35);
  }

  const d = new Graphics();
  for (let f = 0; f <= floors; f++) {
    const y = slabMidY(f);
    const sx = wallFaces(slabExt(exts, floors, f));
    // Pour joint: a dark seam with a lit lower lip, slightly wavy.
    for (const [a, b] of [[sx.xl + 1, sx.xinL - 12], [sx.xinR + 2, sx.xr - 1]] as [number, number][]) {
      const w = (rnd() - 0.5) * 0.8;
      d.moveTo(a, y + w).lineTo((a + b) / 2, y - w * 0.6).lineTo(b, y + w * 0.4).stroke({ color: 0x1a1612, width: 0.7, alpha: 0.6 });
      d.moveTo(a, y + 0.8 + w).lineTo(b, y + 0.9).stroke({ color: 0xe8e0d0, width: 0.5, alpha: 0.12 });
    }
  }
  const rebar = (x: number, y: number) => {
    d.circle(x, y, 1.15).fill(0x2a1a12);
    d.circle(x - 0.3, y - 0.3, 0.55).fill({ color: 0xa0704c, alpha: 0.55 });
    if (rnd() < 0.22) d.rect(x - 0.35, y + 1, 0.7, 2 + rnd() * 6).fill({ color: 0x6a3a1c, alpha: 0.2 });
  };
  const j = () => (rnd() - 0.5) * 0.8;
  for (let y = top + 5; y < bottom - 18; y += 8) {
    const b = blockAt(y);
    rebar(b.xl + 5 + j(), y + j());
    rebar(b.xinL - 5 + j(), y + 4 + j());
    rebar(b.xr - 4.5 + j(), y + 2 + j());
  }
  for (let x = lx0 - foot + 5; x < lx1 + foot - 4; x += 8) {
    rebar(x + j(), base + 4);
    rebar(x + 4 + j(), bottom - 1.5);
  }
  // Rebar stubs where the outer edge broke away.
  for (let i = 0; i < 4 + floors; i++) {
    const west = rnd() < 0.7;
    const y = top + 20 + rnd() * (bottom - top - 50);
    const b = blockAt(y);
    const x = west ? b.xl + 0.5 : b.xr - 0.5;
    const len = 3 + rnd() * 5;
    const ex = x + (west ? -len : len), ey = y + (rnd() - 0.3) * 3;
    d.moveTo(x, y).lineTo(ex, ey).stroke({ color: 0x3a2418, width: 1.3 });
    d.moveTo(x, y - 0.4).lineTo(ex, ey - 0.4).stroke({ color: 0xa0704c, width: 0.45, alpha: 0.5 });
  }
  // Hairline cracks in the cut face, one or two per level.
  for (let f = 0; f < floors; f++) {
    const n = 1 + (rnd() < 0.4 ? 1 : 0);
    const fb = wallFaces(exts[f] ?? { w: 0, e: BASE_EAST });
    for (let k = 0; k < n; k++) {
      const west = k === 0 || rnd() < 0.6;
      let x = west ? fb.xl + 2 + rnd() * 14 : fb.xr - 2 - rnd() * 8;
      let y = floorTop(f) + 10 + rnd() * (ROOM_H - 30);
      const line: number[] = [x, y];
      for (let s = 0; s < 4 + Math.floor(rnd() * 3); s++) {
        x += (rnd() - 0.5) * 5;
        y += 2 + rnd() * 5;
        line.push(x, y);
      }
      d.moveTo(line[0], line[1]);
      for (let s = 2; s < line.length; s += 2) d.lineTo(line[s], line[s + 1]);
      d.stroke({ color: 0x14100c, width: 0.6, alpha: 0.6 });
      d.moveTo(line[0] + 0.5, line[1]);
      for (let s = 2; s < line.length; s += 2) d.lineTo(line[s] + 0.5, line[s + 1]);
      d.stroke({ color: 0xf0e8d8, width: 0.35, alpha: 0.15 });
    }
  }
  // The top arris of the shell catches the daylight.
  d.rect(x0, top - 0.6, x1 - x0, 1.1).fill({ color: 0xe8e0d0, alpha: 0.3 });
  root.addChild(d);

  if (stepped) casingShoulders(root, blocks, floors, exts);
  return root;
}

/**
 * [plan4:ST-6] Where neighbouring rows differ: the top of a shelf catches the light, an overhang throws a shadow on the rock under it, and a wide gap
 * between a row and the one above it (more than 4 slots) opens an empty pocket in the rock (a half-ellipse void, fallen stones, a seep): "a cavern
 * the dig left behind". Own random stream, so the plain bunker's shell is not disturbed.
 */
function casingShoulders(root: Container, blocks: CasingBlock[], floors: number, exts: readonly Ext[]): void {
  void floors;
  void exts;
  const r = seeded(6161);
  const g = new Graphics();
  const drop = softTexture('drop');
  for (let i = 0; i + 1 < blocks.length; i++) {
    const a = blocks[i], b = blocks[i + 1];
    const y = b.y0;
    for (const side of [-1, 1] as const) {
      const ax = side < 0 ? a.xl : a.xr, bx = side < 0 ? b.xl : b.xr;
      const gap = Math.abs(bx - ax);
      if (gap < 1) continue;
      const lo = Math.min(ax, bx);
      // The wider row below leaves a shelf on top of its wall; the wider row above hangs over the rock under it.
      const shelf = side < 0 ? bx < ax : bx > ax;
      if (shelf) {
        g.rect(lo, y - 0.6, gap, 1.8).fill({ color: 0xe8e0d0, alpha: 0.32 });
        g.rect(lo, y + 1.2, gap, 1).fill({ color: 0x14100c, alpha: 0.5 });
        // Grit and a puddle on the shelf.
        for (let k = 0; k < Math.ceil(gap / 12); k++) g.circle(lo + 3 + r() * (gap - 6), y - 1.3, 0.5 + r() * 0.8).fill({ color: 0x3a342c, alpha: 0.7 });
      } else {
        const sh = new Sprite(drop);
        sh.tint = 0x000000;
        sh.alpha = 0.5;
        sh.width = gap + 6;
        sh.height = 14;
        sh.position.set(lo - 3, y + 2);
        root.addChild(sh);
        g.rect(lo, y + 1, gap, 1.2).fill({ color: 0x14100c, alpha: 0.55 });
      }
      // An empty pocket in the rock where the gap is wide (more than four slots).
      if (shelf && gap > 4 * SLOT_W) {
        const w = Math.min(gap - 14, 2.2 * SLOT_W), h = Math.min(60, (b.y1 - b.y0) * 0.6);
        const cx = lo + gap / 2, cy = y - h * 0.15;
        const hollow: number[] = [];
        for (let k = 0; k <= 14; k++) {
          const a2 = Math.PI + (k / 14) * Math.PI; // the upper half of an ellipse, a flat floor
          const rr = 0.85 + r() * 0.3;
          hollow.push(cx + Math.cos(a2) * (w / 2) * rr, cy + Math.sin(a2) * h * rr);
        }
        hollow.push(cx + w / 2, cy, cx - w / 2, cy);
        g.poly(hollow).fill({ color: 0x07090c, alpha: 0.78 });
        // Fallen stones on the floor of the pocket and a seep running down from the roof.
        for (let k = 0; k < 6; k++) {
          const sx = cx - w * 0.4 + r() * w * 0.8, rs = 1 + r() * 2.4;
          g.ellipse(sx, cy - rs * 0.4, rs * 1.3, rs * 0.8).fill({ color: 0x3a362f, alpha: 0.9 });
        }
        const sx = cx + (r() - 0.5) * w * 0.4;
        g.rect(sx, cy - h * 0.8, 0.9, h * 0.6).fill({ color: 0x8aa4b8, alpha: 0.2 });
        g.circle(sx + 0.4, cy - h * 0.2, 1).fill({ color: 0x8aa4b8, alpha: 0.35 });
      }
    }
  }
  root.addChild(g);
}

/** Rock-depth darkening for a shape spanning y0..y1 (the same fog the structure gets, as a cold overlay). */
function depthFog(y0: number, y1: number): FillGradient {
  const a = (y: number) => 1 - depthGains(y)[0];
  return vGradient([[0, 0x0a0e16, a(y0)], [1, 0x0a0e16, Math.min(0.5, a(y1) + 0.08)]]);
}

const patternCache: Record<string, FillPattern> = {};

/** A repeating Graphics fill of sawn concrete ('cut') or backfill gravel ('fill'); size = world units per tile. */
function pattern(kind: 'cut' | 'fill', size: number): FillPattern {
  const key = kind + size;
  if (patternCache[key]) return patternCache[key];
  const p = new FillPattern(concreteTexture(kind), 'repeat');
  p.setTransform(new Matrix().scale(size / 128, size / 128));
  patternCache[key] = p;
  return p;
}

const concreteCache: Record<string, Texture> = {};

/**
 * Painted-in-code tiles (128 px, seamless): 'cut' is concrete sawn through (grey matrix, flat-cut stones, pores),
 * 'fill' is rounded gravel in dark earth.
 */
function concreteTexture(kind: 'cut' | 'fill'): Texture {
  if (concreteCache[kind]) return concreteCache[kind];
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const rnd = seeded(kind === 'cut' ? 733 : 919);
  const cut = kind === 'cut';
  const wrap = (x: number, y: number, r: number, fn: (px: number, py: number) => void) => {
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const px = x + dx, py = y + dy;
        if (px + r < 0 || px - r > S || py + r < 0 || py - r > S) continue;
        fn(px, py);
      }
    }
  };
  ctx.fillStyle = cut ? '#7a7670' : '#4e443a';
  ctx.fillRect(0, 0, S, S);
  // Mottling, so no tile reads flat.
  for (let i = 0; i < 160; i++) {
    const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 18;
    const v = rnd() < 0.5 ? '0,0,0' : '255,248,236';
    const a = 0.04 + rnd() * 0.07;
    wrap(x, y, r, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(' + v + ',' + a + ')');
      g.addColorStop(1, 'rgba(' + v + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  const stones = cut ? 150 : 210;
  for (let i = 0; i < stones; i++) {
    const x = rnd() * S, y = rnd() * S;
    const rx = cut ? 0.8 + rnd() ** 2 * 5.5 : 1.2 + rnd() ** 1.5 * 4.5;
    const ry = rx * (0.55 + rnd() * 0.4);
    const rot = rnd() * Math.PI;
    const v = cut ? 92 + rnd() * 92 : 52 + rnd() * 72;
    const warm = rnd() * 16;
    const col = 'rgb(' + Math.round(v + warm) + ',' + Math.round(v + warm * 0.55) + ',' + Math.round(v - 4) + ')';
    wrap(x, y, rx + 1.5, (px, py) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = 'rgba(0,0,0,0.38)';
      ctx.stroke();
      if (!cut) {
        // Rounded pebbles: a soft light on top.
        ctx.beginPath();
        ctx.ellipse(-rx * 0.2, -ry * 0.3, rx * 0.5, ry * 0.35, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,245,230,0.18)';
        ctx.fill();
      }
      ctx.restore();
    });
  }
  if (cut) {
    // Air pores.
    for (let i = 0; i < 110; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.4 + rnd() * 0.9;
      wrap(x, y, r, (px, py) => {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(20,16,12,0.55)';
        ctx.fill();
      });
    }
  }
  concreteCache[kind] = Texture.from(c);
  return concreteCache[kind];
}

let haloTex: Texture | null = null;

/** A soft-edged white frame (nine-sliced, tinted dark) for the excavation around the shell. */
function haloTexture(): Texture {
  if (haloTex) return haloTex;
  const S = 64, B = 30;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const k = Math.min(1, Math.min(x + 0.5, S - x - 0.5, y + 0.5, S - y - 0.5) / B);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(k * k * (3 - 2 * k) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  haloTex = Texture.from(c);
  return haloTex;
}

/** Base light of the unlit structure in an era (G4): the Remnant is dark, the Undercity well lit. */
export function structureAmbient(era: number): number {
  return ERAS[Math.max(0, Math.min(ERAS.length - 1, era))].ambient;
}

interface Lit {
  node: Sprite | TilingSprite;
  /** The unlit floor (ambient) and what each nearby lamp adds: pairs of [room index, amount]. */
  base: number;
  parts: number[];
  y: number;
}

/** What every lamp in reach adds to the light at (x, y), split by the room the lamp hangs in. */
function lampParts(x: number, y: number, lamps: WorldLamp[], roomIndex: (id?: string) => number): number[] {
  const out: number[] = [];
  for (const l of lamps) {
    const R = l.reach * 1.6;
    const d = Math.hypot(x - l.x, (y - l.y) * 1.3);
    if (d >= R) continue;
    const k = 1 - d / R;
    out.push(roomIndex(l.room), l.power * k * k * 0.75);
  }
  return out;
}

/** Light level from its parts, with the power ratio, each room's lamp flicker (1 = steady) and the night (unlit parts sink). */
function lightOf(base: number, parts: number[], power: number, flicker: number[], night = 0): number {
  let sum = 0;
  for (let i = 0; i < parts.length; i += 2) sum += parts[i + 1] * power * (0.55 + 0.45 * flicker[parts[i]]);
  // Lamp light saturates softly toward full brightness, so a segment between two lamps still reads brighter
  // than one under a single lamp instead of everything near a lamp clamping to the same white.
  const b = base * (0.75 + 0.25 * power) * (1 - 0.06 * night); // barely: the bunker's lamps don't follow the sun (night reads through the warm guide lights)
  return b + (LIT_MAX - b) * (1 - Math.exp(-sum * 1.3));
}

const fadeCache: Record<string, Texture> = {};

/** Soft black-to-clear ramps and blobs for ambient occlusion, and a soft vertical streak for light on column faces. */
export function softTexture(kind: 'fadeH' | 'fadeV' | 'blob' | 'streak' | 'drop' | 'lip'): Texture {
  const hit = fadeCache[kind];
  if (hit) return hit;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  if (kind === 'blob') {
    c.width = c.height = 64;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  } else if (kind === 'drop') {
    // Opaque at the top with an eased falloff: a cast shadow without the banding of stacked strips.
    c.width = 4;
    c.height = 64;
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, 'rgba(255,255,255,' + ((1 - i / 8) ** 2.2).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 64);
  } else if (kind === 'lip') {
    // Slab nosing (drawn 6 u tall from the slab top): a lit top face, the bright arris, a dark line under it.
    c.width = 4;
    c.height = 32;
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgba(255,250,240,0.08)');
    g.addColorStop(0.3, 'rgba(255,250,240,0.2)');
    g.addColorStop(0.35, 'rgba(255,248,236,0.9)');
    g.addColorStop(0.42, 'rgba(255,248,236,0.7)');
    g.addColorStop(0.48, 'rgba(30,26,22,0.5)');
    g.addColorStop(0.7, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 32);
  } else if (kind === 'streak') {
    c.width = 32;
    c.height = 128;
    const h = ctx.createLinearGradient(0, 0, 32, 0);
    h.addColorStop(0, 'rgba(255,255,255,0)');
    h.addColorStop(0.5, 'rgba(255,255,255,1)');
    h.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = h;
    ctx.fillRect(0, 0, 32, 128);
    ctx.globalCompositeOperation = 'destination-in';
    const v = ctx.createLinearGradient(0, 0, 0, 128);
    v.addColorStop(0, 'rgba(255,255,255,0)');
    v.addColorStop(0.18, 'rgba(255,255,255,1)');
    v.addColorStop(0.55, 'rgba(255,255,255,0.7)');
    v.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 32, 128);
  } else {
    const hz = kind === 'fadeH';
    c.width = hz ? 64 : 4;
    c.height = hz ? 4 : 64;
    // Opaque at x = 0 (fadeH) or y = 64 (fadeV), easing out.
    const g = hz ? ctx.createLinearGradient(0, 0, 64, 0) : ctx.createLinearGradient(0, 64, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  fadeCache[kind] = Texture.from(c);
  return fadeCache[kind];
}

/**
 * Depth fog (G4): every level down is 3.5% darker (to 75%) and drifts toward cold blue-grey (4% a level, to 25%).
 * Returns per-channel gains for a world y.
 */
export function depthGains(y: number): [number, number, number] {
  const f = Math.max(0, floorFrac(y));
  const k = Math.max(0.75, 1 - 0.035 * f);
  const cold = Math.min(0.25, 0.04 * f);
  // Mix toward #8A9AB0 relative to white.
  return [k * (1 - cold * (1 - 0x8a / 255)), k * (1 - cold * (1 - 0x9a / 255)), k * (1 - cold * (1 - 0xb0 / 255))];
}

function shadeAt(v: number, y: number): number {
  const [r, g, b] = depthGains(y);
  const c = (k: number) => Math.round(255 * Math.max(0, Math.min(1, v * k)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

/**
 * Everything in front of the rooms: slab profiles, columns where rooms meet, the pipe bundle under each ceiling,
 * soft ambient occlusion where they meet the rooms, and the light the lamps throw on all of it.
 * Rebuilt when the layout changes; per frame only tints and spill alphas move (with power and each room's flicker).
 * Not baked with cacheAsTexture (G9): the whole front batches into ~3 draw calls and hiding it entirely made no
 * measurable difference to the frame time, while a baked texture would cost memory and sharpness at zoom 3.
 */
export function buildFrontStructure(
  grid: Grid, buildings: BuildingInstance[], floors: number, lamps: WorldLamp[], ambient: number, st: KitState = 'F',
): Animated {
  const root = new Container();
  root.eventMode = 'none';
  const slabTex = kitTex('slab', st);
  const colTex = kitTex('column', st);
  const pipeTex = kitTex('pipes', st);
  // The wrecked and patched kits are painted much darker than the cared-for one (slab luminance ~23 / 40 / 55),
  // so their unlit floor is lifted to keep the structure readable on a phone while the eras still step darker.
  const lift = KIT_LIFT[st];
  const lit: Lit[] = [];
  const spill = new Container();
  spill.blendMode = 'add';
  const ao = new Container();
  const rnd = seeded(9137);

  // Rooms whose lamps light the structure; their flicker is read back every frame.
  const roomIds = [...new Set(lamps.map(l => l.room).filter((r): r is string => !!r))];
  const NONE = roomIds.length;
  const roomIdx = new Map(roomIds.map((r, i) => [r, i]));
  const roomIndex = (id?: string) => (id ? roomIdx.get(id) ?? NONE : NONE);
  const flicker: number[] = new Array(roomIds.length + 1).fill(1);

  const add = (tex: Texture, x: number, y: number, w: number, h: number, scale: number, cx: number, cy: number, lampGain = 1, baseGain = 1) => {
    const t = new TilingSprite({ texture: tex, width: w, height: h });
    t.position.set(x, y);
    t.tileScale.set(scale);
    // Keep the pattern continuous across segments.
    t.tilePosition.set(-x, 0);
    const parts = lampParts(cx, cy, lamps, roomIndex);
    for (let i = 1; i < parts.length; i += 2) parts[i] *= lampGain;
    const node: Lit = { node: t, base: Math.min(0.9, ambient * lift * baseGain), parts, y: cy };
    lit.push(node);
    t.tint = shadeAt(lightOf(node.base, node.parts, 1, flicker), cy);
    root.addChild(t);
    return t;
  };
  // A painted overlay lit like the structure (the slab nosing).
  const addLit = (tex: Texture, x: number, y: number, w: number, h: number, cx: number, cy: number, lampGain: number, baseGain: number) => {
    const sp = new Sprite(tex);
    sp.position.set(x, y);
    sp.width = w;
    sp.height = h;
    const parts = lampParts(cx, cy, lamps, roomIndex);
    for (let i = 1; i < parts.length; i += 2) parts[i] *= lampGain;
    const node: Lit = { node: sp, base: Math.min(0.9, ambient * lift * baseGain), parts, y: cy };
    lit.push(node);
    sp.tint = shadeAt(lightOf(node.base, node.parts, 1, flicker), cy);
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
    for (let f = 0; f < floors; f++) {
      const spans = hallSpans(buildings, f - 1);
      const y = floorTop(f) + PIPES_Y;
      const { w: ew, e: ee } = grid.ext[f];
      // [plan4:ST-4] The mains split at the shaft: east of it as ever, and the west wing's bundle runs the other way.
      const runs: [number, number][] = gridSegments(SHAFT_W - 20, slotX(ee) + 6, SLOT_W / 2);
      if (ew > 0) runs.push(...gridSegments(slotX(-ew) - 6, 20, SLOT_W / 2, true));
      for (const [x, x1] of runs) {
        const w = x1 - x;
        if (inSpan(x, x1, spans)) continue;
        add(pipeTex, x, y, w, PIPES_H, PIPES_H / pipeTex.height, x + w / 2, y + PIPES_H / 2);
      }
    }
  }

  // Shadow under each slab and pipe run falls into the room below (one smooth gradient per run, gfx-p0 light);
  // a dark contact line where the room floor meets the slab lip.
  const fadeV = softTexture('fadeV');
  const drop = softTexture('drop');
  for (let f = 0; f < floors; f++) {
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
        if (!inSpan(x0, x1, above)) {
          if (run0 < 0) run0 = x0;
          run1 = x1;
        } else flush();
        if (!inSpan(x0, x1, below)) shade(fadeV, x0, top + ROOM_H - LIP - AO_CONTACT, x1 - x0, AO_CONTACT, 0.62 + rnd() * 0.15);
      }
      flush();
    }
  }
  root.addChildAt(ao, 0);

  if (slabTex) {
    const scale = SLAB_DRAW / slabTex.height;
    const lip = softTexture('lip');
    const endFade = softTexture('fadeH');
    // The roof slab under the topsoil, then one under every level.
    const lines = [{ y: TOPSOIL - SLAB - LIP, spans: [] as [number, number][], ext: slabExt(grid.ext, floors, 0) }];
    for (let f = 0; f < floors; f++) lines.push({ y: floorTop(f) + ROOM_H - LIP, spans: hallSpans(buildings, f), ext: slabExt(grid.ext, floors, f + 1) });
    for (const line of lines) {
      // [plan4:ST-6] A slab reaches as far as the wider of the two rows it joins (a concrete shoulder where they differ), and ends in the casing walls.
      const sx0 = (line.ext.w > 0 ? slotX(-line.ext.w) : 0) - 12, sx1 = slotX(line.ext.e) + 12;
      for (const [x, x1] of gridSegments(sx0, sx1, SLOT_W, line.ext.w > 0)) {
        const w = x1 - x;
        if (inSpan(x, x1, line.spans)) continue;
        add(slabTex, x, line.y, w, SLAB_DRAW, scale, x + w / 2, line.y + SLAB_DRAW / 2);
        // gfx-p0 light: the nosing catches the lamps of the room standing on it.
        addLit(lip, x, line.y, w, 6, x + w / 2, line.y - 6, 1.5, 0.95);
      }
      // The slab ends bear into the casing walls: a soft dark where they enter.
      for (const [ex, flip] of [[sx0, false], [sx1 - 5, true]] as [number, boolean][]) {
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

  // Lamp light spilling onto the ceiling pipes, the floor slab and the column faces next to the lamps.
  const spills: { s: Sprite; a: number; room: number }[] = [];
  // gfx-p0 light: warm night guide lights at the column feet (fixture always there, lit only at night).
  const guides: { s: Sprite; a: number }[] = [];
  const fixtures = new Graphics();
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
  const glow = glowTexture();
  const streak = softTexture('streak');

  // [plan4:ST-6] The dug end of a wing: a timber post with a cap beam and a diagonal brace instead of a steel column, and a soft marker lamp (one slow
  // breath, never a hard flicker) so the end of the dig can be found from afar. Static drawing; only the lamp's alpha moves.
  const timbers = new Container();
  const markers: { s: Sprite; ph: number }[] = [];
  const woodAt = (c: number, y: number) => {
    const [r, g, b] = depthGains(y);
    const ch = (sh: number, k: number) => Math.round(Math.min(255, ((c >> sh) & 255) * k * (0.55 + 0.45 * ambient * lift)));
    return (ch(16, r) << 16) | (ch(8, g) << 8) | ch(0, b);
  };
  // [plan4:ST-4] The west landing door: where the shaft meets the west wing the column becomes a steel doorframe, a lit passage and a door leaf ajar.
  const doorFrame = (x: number, top: number) => {
    const my = top + ROOM_H / 2;
    const dg = new Graphics();
    timbers.addChild(dg);
    const y0 = top + PIPES_Y + PIPES_H - 3, y1 = top + ROOM_H - LIP + 1;
    const steel = (c: number) => woodAt(c, my);
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
    const tg = new Graphics(); // one per end, so the front's bands can cull them with their floor
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
    for (let f = 0; f < floors; f++) {
      const top = floorTop(f);
      const row = grid[f];
      const { w: ew, e: ee } = grid.ext[f];
      // [plan4:ST-4] Columns stand at the ends of the floor, either side of the shaft, and wherever two different rooms meet; `l` / `r` say which sides
      // have a room against them, `open` marks the dug end of a wing (timber, not steel).
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
      const floorLamps = lamps.filter(l => floorAtY(l.y).floor === f);
      for (const col of xs) {
        const x = col.x;
        // The lamps hang inside the rooms, so the column's front face only catches grazing light: half the lamp light
        // and a little less ambient,
        // plus a warm rim on the side facing each lamp (below).
        if (col.open) timberEnd(x, top, x < 0 ? 1 : -1);
        else if (col.door) doorFrame(x, top);
        else {
          const c = add(colTex, x - COLUMN_W / 2, top - 1, COLUMN_W, ROOM_H + 2, scale, x, top + ROOM_H / 2, 0.5, 0.8);
          c.tilePosition.set(0, 0);
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
          const cx = edge + side * 2;
          if (!inSpan(cx - 1, cx + 1, above)) shade(blob, cx - 14, ceil - 9, 28, 24, 0.62);
          if (!inSpan(cx - 1, cx + 1, below)) shade(blob, cx - 14, floorY - 15, 28, 24, 0.68);
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
        if (!inSpan(x - 1, x + 1, below) && rnd() < 0.75) guide(x, floorY);
      }
    }
    root.addChild(fixtures);
    root.addChild(timbers);
  }

  for (const l of lamps) {
    if (!l.ceiling) continue;
    const f = floorAtY(l.y).floor;
    const top = floorTop(f);
    const room = roomIndex(l.room);
    const ceil = new Sprite(glow);
    ceil.anchor.set(0.5);
    ceil.tint = l.color;
    ceil.width = l.reach * 0.95;
    ceil.height = 22;
    ceil.position.set(l.x, top + PIPES_Y + PIPES_H / 2);
    spill.addChild(ceil);
    spills.push({ s: ceil, a: 0.3 * l.power, room });
    const pool = new Sprite(glow);
    pool.anchor.set(0.5);
    pool.tint = l.color;
    pool.width = l.reach * 0.85;
    pool.height = 12;
    pool.position.set(l.x, top + ROOM_H);
    spill.addChild(pool);
    spills.push({ s: pool, a: 0.2 * l.power, room });
  }
  root.addChild(spill);

  let lastPower = -1;
  let lastNight = -1;
  return {
    container: root,
    animate: (t, power) => {
      const night = nightLight.k;
      let changed = Math.abs(power - lastPower) >= 0.01 || Math.abs(night - lastNight) >= 0.01;
      for (let i = 0; i < NONE; i++) {
        const v = roomFlicker.get(roomIds[i]) ?? 1;
        if (v !== flicker[i]) {
          flicker[i] = v;
          changed = true;
        }
      }
      for (const sp of spills) sp.s.alpha = sp.a * power * flicker[sp.room];
      for (const m of markers) m.s.alpha = (0.42 + 0.14 * Math.sin(t * 1.1 + m.ph)) * (0.6 + 0.4 * power); // [plan4:ST-6] one slow breath, no hard flicker
      for (const g of guides) {
        const a = g.a * night * (0.5 + 0.5 * power);
        g.s.alpha = a;
        g.s.visible = a > 0.004;
      }
      if (!changed) return;
      lastPower = power;
      lastNight = night;
      for (const l of lit) l.node.tint = shadeAt(lightOf(l.base, l.parts, power, flicker, night), l.y);
    },
  };
}

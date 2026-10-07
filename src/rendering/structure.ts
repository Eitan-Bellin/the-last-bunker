import { Container, FillPattern, Graphics, Matrix, NineSliceSprite, Rectangle, Sprite, Texture, TilingSprite, type FillGradient } from 'pixi.js';
import type { BuildingInstance, Ruin } from '../core/GameState';
import { isDistrict, isHall, roomSlots } from '../data/buildingDefs';
import { ArtLibrary, glowTexture } from '../art/ArtLibrary';
import { BASE_EAST, BUILDING_W, ROOMS_W, ROOMS_X, ROOM_H, SHAFT_W, SLAB, SLOT_W, TOPSOIL, floorAtY, floorFrac, floorTop, slotX } from './layout';
import { ERAS } from '../data/eras';
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
type Material = typeof MATERIALS[number];

export const KIT_KEYS = [
  ...MATERIALS.flatMap(m => ['F', 'R', 'L'].map(st => `kit/${m}-${st}`)), 'kit/bay-A-wide', 'kit/bay-A-narrow',
];

/** The material in the era's state, falling back to the restored look while it loads. */
function kitTex(m: Material, st: KitState): Texture | null {
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

/** What stands in every slot of every floor: a compound key per room/ruin, or null for an empty bay. */
export function occupancy(buildings: BuildingInstance[], ruins: Ruin[], floors: number): Cell[][] {
  const grid: Cell[][] = Array.from({ length: floors }, () => Array.from({ length: BASE_EAST }, () => null)); // [plan4:X-2] one row = the floor's east slots (the default extent)
  const put = (f: number, x: number, w: number, key: string) => {
    if (f < 0 || f >= floors) return;
    for (let i = x; i < x + w && i < grid[f].length; i++) grid[f][i] = { key };
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
function gridSegments(x0: number, x1: number, step: number): [number, number][] {
  const edges = [x0];
  for (let x = ROOMS_X; x < x1; x += step) if (x > x0) edges.push(x);
  edges.push(x1);
  const out: [number, number][] = [];
  for (let i = 0; i < edges.length - 1; i++) if (edges[i + 1] - edges[i] > 0.5) out.push([edges[i], edges[i + 1]]);
  return out;
}

/** Empty slots become excavated bays: rough rock, timber shoring and a work lamp. Sits behind the rooms. */
export function buildBays(grid: Cell[][]): Container {
  const root = new Container();
  const wide = ArtLibrary.get('kit/bay-A-wide');
  const narrow = ArtLibrary.get('kit/bay-A-narrow');
  if (!wide || !narrow) return root;
  const single = new Texture({ source: narrow.source, frame: new Rectangle(narrow.width / 4, 0, narrow.width / 2, narrow.height) });
  for (let f = 0; f < grid.length; f++) {
    let s = 0;
    let n = 0;
    const width = grid[f].length;
    while (s < width) {
      if (grid[f][s]) { s++; continue; }
      let e = s;
      while (e < width && !grid[f][e]) e++;
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
  return root;
}

/**
 * The bunker's shell as a section cut (gfx-p0 light): thick walls of sawn concrete (aggregate, rebar cut through,
 * pour joints, hairline cracks, chipped outer edge and footings) bedded in backfill gravel inside a darker
 * excavation in the rock. The kit wall stays as the back wall behind the rooms. Replaces the dark overbreak rim.
 */
export function buildCasing(floors: number, st: KitState = 'F'): Container {
  const root = new Container();
  root.eventMode = 'none';
  const wall = kitTex('wall', st);
  const top = TOPSOIL - SLAB - 4;
  const base = floorTop(floors);
  const bottom = base + 12;
  const rnd = seeded(4242);
  const x0 = WALL_W_OUT, x1 = WALL_E_OUT;

  // The excavation: rock darkens toward the hole.
  const halo = new NineSliceSprite({ texture: haloTexture(), leftWidth: 30, rightWidth: 30, topHeight: 30, bottomHeight: 30 });
  halo.position.set(x0 - BACKFILL - 34, top - 24);
  halo.width = x1 - x0 + 2 * (BACKFILL + 34);
  halo.height = bottom - top + 24 + BACKFILL + 40;
  halo.tint = 0x000000;
  halo.alpha = 0.62;
  root.addChild(halo);

  // Backfill: compacted gravel against the walls, out to a ragged rock cut.
  const fill = new Graphics();
  const pts: number[] = [];
  const pad = () => BACKFILL * (0.55 + rnd() * 0.75);
  const y1 = bottom + 4;
  for (let x = x0 - BACKFILL; x <= x1 + BACKFILL; x += 9) pts.push(x, top - 4 - rnd() * 4);
  for (let y = top; y <= y1; y += 9) pts.push(x1 + pad(), y);
  for (let x = x1 + BACKFILL; x >= x0 - BACKFILL; x -= 9) pts.push(x, y1 + pad());
  for (let y = y1; y >= top; y -= 9) pts.push(x0 - pad(), y);
  fill.poly(pts).fill({ fill: pattern('fill', 36), color: 0x8a8076 });
  fill.poly(pts).fill(depthFog(top, y1 + BACKFILL));
  root.addChild(fill);

  // The concrete ring, cut by the section plane: chipped outer edges, wider footings under both walls.
  const ring = new Graphics();
  const out: number[] = [];
  const chip = () => (rnd() < 0.18 ? 1.2 + rnd() * 2.2 : rnd() * 0.9);
  const foot = 12;
  for (let x = x0; x <= x1; x += 6) out.push(x, top + chip() * 0.4);
  for (let y = top + 6; y < bottom - 16; y += 5) out.push(x1 - chip(), y);
  out.push(x1, bottom - 16, x1 + foot - chip(), bottom - 14, x1 + foot - chip(), bottom + 3);
  for (let x = x1 + foot - 4; x > x0 - foot + 4; x -= 6) out.push(x, bottom + 3 - chip() * 0.6);
  out.push(x0 - foot + chip(), bottom + 3, x0 - foot + chip(), bottom - 14, x0, bottom - 16);
  for (let y = bottom - 21; y > top + 4; y -= 5) out.push(x0 + chip(), y);
  ring.poly(out).fill({ fill: pattern('cut', 40), color: 0x6e675e });
  ring.poly(out).fill(depthFog(top, bottom));
  root.addChild(ring);

  // The back wall behind the rooms (seen in the gaps between them).
  if (wall) {
    const back = new TilingSprite({ texture: wall, width: BUILDING_W, height: base - top });
    back.position.set(0, top);
    back.tileScale.set(64 / wall.width);
    back.tint = 0x4c4c4c;
    root.addChild(back);
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
  shadow(fadeH, x0 - 6, top, 6, bottom - top - 14, 0.55, true);
  shadow(fadeH, x1, top, 6, bottom - top - 14, 0.55);
  shadow(drop, x0 - foot, bottom + 3, x1 - x0 + 2 * foot, 7, 0.5);
  // Inner faces: the shaft and the rooms sit in a slot, a soft dark where the wall turns the corner.
  shadow(fadeH, -7, top, 7, base - top, 0.35, true);
  shadow(fadeH, BUILDING_W, top, 7, base - top, 0.35);

  const d = new Graphics();
  for (let f = 0; f <= floors; f++) {
    const y = floorTop(f) - SLAB / 2;
    // Pour joint: a dark seam with a lit lower lip, slightly wavy.
    for (const [a, b] of [[x0 + 1, -12], [BUILDING_W + 2, x1 - 1]] as [number, number][]) {
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
    rebar(x0 + 5 + j(), y + j());
    rebar(-5 + j(), y + 4 + j());
    rebar(x1 - 4.5 + j(), y + 2 + j());
  }
  for (let x = x0 - foot + 5; x < x1 + foot - 4; x += 8) {
    rebar(x + j(), base + 4);
    rebar(x + 4 + j(), bottom - 1.5);
  }
  // Rebar stubs where the outer edge broke away.
  for (let i = 0; i < 4 + floors; i++) {
    const west = rnd() < 0.7;
    const y = top + 20 + rnd() * (bottom - top - 50);
    const x = west ? x0 + 0.5 : x1 - 0.5;
    const len = 3 + rnd() * 5;
    const ex = x + (west ? -len : len), ey = y + (rnd() - 0.3) * 3;
    d.moveTo(x, y).lineTo(ex, ey).stroke({ color: 0x3a2418, width: 1.3 });
    d.moveTo(x, y - 0.4).lineTo(ex, ey - 0.4).stroke({ color: 0xa0704c, width: 0.45, alpha: 0.5 });
  }
  // Hairline cracks in the cut face, one or two per level.
  for (let f = 0; f < floors; f++) {
    const n = 1 + (rnd() < 0.4 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const west = k === 0 || rnd() < 0.6;
      let x = west ? x0 + 2 + rnd() * 14 : x1 - 2 - rnd() * 8;
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
  return root;
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
  grid: Cell[][], buildings: BuildingInstance[], floors: number, lamps: WorldLamp[], ambient: number, st: KitState = 'F',
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
      for (const [x, x1] of gridSegments(SHAFT_W - 20, ROOMS_X + ROOMS_W + 6, SLOT_W / 2)) {
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
    for (const [x0, x1] of gridSegments(ROOMS_X, ROOMS_X + ROOMS_W, SLOT_W)) {
      if (!inSpan(x0, x1, above)) {
        if (run0 < 0) run0 = x0;
        run1 = x1;
      } else flush();
      if (!inSpan(x0, x1, below)) shade(fadeV, x0, top + ROOM_H - LIP - AO_CONTACT, x1 - x0, AO_CONTACT, 0.62 + rnd() * 0.15);
    }
    flush();
  }
  root.addChildAt(ao, 0);

  if (slabTex) {
    const scale = SLAB_DRAW / slabTex.height;
    const lip = softTexture('lip');
    const endFade = softTexture('fadeH');
    // The roof slab under the topsoil, then one under every level.
    const lines = [{ y: TOPSOIL - SLAB - LIP, spans: [] as [number, number][] }];
    for (let f = 0; f < floors; f++) lines.push({ y: floorTop(f) + ROOM_H - LIP, spans: hallSpans(buildings, f) });
    for (const line of lines) {
      for (const [x, x1] of gridSegments(-12, BUILDING_W + 12, SLOT_W)) {
        const w = x1 - x;
        if (inSpan(x, x1, line.spans)) continue;
        add(slabTex, x, line.y, w, SLAB_DRAW, scale, x + w / 2, line.y + SLAB_DRAW / 2);
        // gfx-p0 light: the nosing catches the lamps of the room standing on it.
        addLit(lip, x, line.y, w, 6, x + w / 2, line.y - 6, 1.5, 0.95);
      }
      // The slab ends bear into the casing walls: a soft dark where they enter.
      for (const [ex, flip] of [[-12, false], [BUILDING_W + 12 - 5, true]] as [number, boolean][]) {
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

  if (colTex) {
    const scale = COLUMN_W / colTex.width;
    const fadeH = softTexture('fadeH');
    const blob = softTexture('blob');
    for (let f = 0; f < floors; f++) {
      const top = floorTop(f);
      const row = grid[f];
      const xs: number[] = [ROOMS_X, ROOMS_X + ROOMS_W];
      for (let s = 1; s < row.length; s++) {
        const a = row[s - 1], b = row[s];
        if ((a || b) && a?.key !== b?.key) xs.push(slotX(s));
      }
      const ceil = top + PIPES_Y + PIPES_H;
      const floorY = top + ROOM_H - LIP;
      const above = hallSpans(buildings, f - 1);
      const below = hallSpans(buildings, f);
      const floorLamps = lamps.filter(l => floorAtY(l.y).floor === f);
      for (const x of xs) {
        // The lamps hang inside the rooms, so the column's front face only catches grazing light: half the lamp light
        // and a little less ambient,
        // plus a warm rim on the side facing each lamp (below).
        const c = add(colTex, x - COLUMN_W / 2, top - 1, COLUMN_W, ROOM_H + 2, scale, x, top + ROOM_H / 2, 0.5, 0.8);
        c.tilePosition.set(0, 0);
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
          if (edge < ROOMS_X || edge > ROOMS_X + ROOMS_W) continue;
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
    animate: (_t, power) => {
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

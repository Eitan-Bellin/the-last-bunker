import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { BuildingInstance, BuildingType } from '../core/GameState';
import { isDistrict, isHall, roomSlots } from '../data/buildingDefs';
import { ArtLibrary } from '../art/ArtLibrary';
import { BASE_EAST, ROOMS_X, ROOM_H, SHAFT_GAP, SHAFT_W, SLAB, SLOT_W, floorTop, slotX } from './layout';
import { hashString, seeded } from './draw';
import { depthGains, type Grid, type WorldLamp } from './structure';

/**
 * Graphics overhaul G2-decals: story-telling wear on the bunker's structure — cracks, water stains, rust,
 * soot and mould in the wrecked Remnant; cement patches and tally marks once it is patched up; children's chalk,
 * painted arrows and enamel signs when people live here; lit exit signs in the Undercity.
 * Placed by a per-floor seed (stable between loads) on slabs, columns, casing, empty bays and room edges —
 * never over the middle of a room painting. Textures are painted by tools/decals.html.
 */

export const DECAL_NAMES = [
  'crack-a', 'crack-b', 'crack-c', 'crack-d', 'crack-web', 'stain-a', 'stain-b', 'rust-drip', 'mould', 'soot',
  'scratch-tally', 'chalk-tally', 'chalk-kid', 'chalk-kid-b', 'handprints', 'arrow', 'stencil-B', 'stencil-digits',
  'patch', 'patch-b', 'sign-radiation', 'sign-voltage', 'sign-nosmoke', 'sign-water', 'sign-exit', 'sign-exit-glow', 'jbox',
] as const;
type DecalName = typeof DECAL_NAMES[number];

export const DECAL_KEYS = DECAL_NAMES.map(n => `kit/decal-${n}`);

const tex = (n: DecalName) => ArtLibrary.get(`kit/decal-${n}`);

/** Requests every decal and reports whether all are decoded (so the set never pops in piece by piece). */
export function decalsReady(): boolean {
  let ok = true;
  for (const k of DECAL_KEYS) if (!ArtLibrary.get(k)) ok = false;
  return ok;
}

/** Things the atmosphere animates from: drops leave the stains, sparks fly from the broken boxes. */
export interface DecalSources {
  drips: { x: number; y: number; floorY: number }[];
  sparks: { x: number; y: number }[];
}

export interface DecalLayer {
  container: Container;
  sources: DecalSources;
  animate: (t: number, power: number) => void;
}

type Blend = 'mul' | 'alpha' | 'add';
type Surface = 'slab' | 'column' | 'edgeTop' | 'bay' | 'casing';

interface Kind {
  blend: Blend;
  /** World size (units). */
  size: [number, number];
  on: Surface[];
  alpha: [number, number];
  /** Max random rotation (radians). */
  rot?: number;
  flip?: boolean;
}

const KINDS: Partial<Record<DecalName | 'stencil', Kind>> = {
  // Cracks carry a lit lip, so they are lit like paint (alpha) rather than multiplied.
  'crack-a': { blend: 'alpha', size: [26, 26], on: ['bay', 'casing', 'edgeTop'], alpha: [0.6, 0.85], rot: 0.5, flip: true },
  'crack-b': { blend: 'alpha', size: [44, 19], on: ['slab'], alpha: [0.8, 1], flip: true },
  'crack-c': { blend: 'alpha', size: [20, 28], on: ['casing', 'bay', 'edgeTop'], alpha: [0.6, 0.85], flip: true },
  'crack-d': { blend: 'alpha', size: [24, 19], on: ['slab', 'bay', 'casing'], alpha: [0.45, 0.65], rot: 3, flip: true },
  'crack-web': { blend: 'alpha', size: [24, 20], on: ['slab', 'bay', 'casing'], alpha: [0.75, 0.95], rot: 3 },
  // Stains carry pale lime crust as well as damp, so they are lit like paint too.
  'stain-a': { blend: 'alpha', size: [20, 52], on: ['edgeTop', 'casing', 'bay'], alpha: [0.85, 1], flip: true },
  'stain-b': { blend: 'alpha', size: [21, 56], on: ['edgeTop', 'casing', 'bay'], alpha: [0.75, 0.95], flip: true },
  'rust-drip': { blend: 'mul', size: [7, 22], on: ['column'], alpha: [0.6, 0.85], flip: true },
  mould: { blend: 'mul', size: [18, 16], on: ['bay', 'casing', 'slab'], alpha: [0.55, 0.8], rot: 3, flip: true },
  soot: { blend: 'mul', size: [22, 30], on: ['bay', 'casing', 'edgeTop'], alpha: [0.45, 0.7], flip: true },
  'scratch-tally': { blend: 'mul', size: [14, 10.5], on: ['column', 'bay', 'casing'], alpha: [0.55, 0.75], rot: 0.08 },
  'chalk-tally': { blend: 'alpha', size: [14, 10.5], on: ['column', 'bay', 'slab'], alpha: [0.6, 0.85], rot: 0.08 },
  'chalk-kid': { blend: 'alpha', size: [27, 18], on: ['bay', 'slab'], alpha: [0.65, 0.85], rot: 0.04 },
  'chalk-kid-b': { blend: 'alpha', size: [23, 18], on: ['bay', 'slab'], alpha: [0.65, 0.85], rot: 0.04 },
  handprints: { blend: 'mul', size: [15, 15], on: ['slab', 'bay', 'column'], alpha: [0.55, 0.8], rot: 0.3, flip: true },
  arrow: { blend: 'alpha', size: [17, 8.5], on: ['slab', 'bay'], alpha: [0.75, 0.9] },
  // The diggers' survey mark on an open bay (the level name itself is signage.ts's slab stencil).
  stencil: { blend: 'alpha', size: [17, 11], on: ['bay'], alpha: [0.6, 0.8] },
  patch: { blend: 'alpha', size: [18, 13.5], on: ['slab', 'bay', 'casing', 'edgeTop'], alpha: [0.85, 0.95], rot: 0.3, flip: true },
  'patch-b': { blend: 'alpha', size: [20, 20], on: ['bay', 'casing', 'edgeTop'], alpha: [0.85, 0.95], rot: 0.4, flip: true },
};

/** Per-era mix: [kind, weight]. Wear falls with the eras; life and signage rise. */
const POOLS: [DecalName | 'stencil', number][][] = [
  [['crack-a', 2], ['crack-b', 3], ['crack-c', 1.5], ['crack-web', 1.5], ['stain-a', 2.5], ['stain-b', 1.5], ['rust-drip', 2], ['mould', 1.5], ['soot', 1.5], ['scratch-tally', 0.5]],
  [['patch', 3], ['patch-b', 2], ['chalk-tally', 1.5], ['scratch-tally', 1.5], ['crack-d', 1.5], ['stain-b', 1], ['rust-drip', 1], ['stencil', 1]],
  [['chalk-kid', 2], ['chalk-kid-b', 1.5], ['arrow', 2], ['handprints', 1.5], ['chalk-tally', 0.7], ['patch', 1], ['stencil', 1], ['crack-d', 0.5]],
  [['arrow', 2], ['stencil', 1.5], ['handprints', 1], ['chalk-kid-b', 0.7], ['patch', 0.8], ['crack-d', 0.5]],
];
const PER_FLOOR = [7, 4, 3, 2];
/** Where wear reads best: room edges under the lit ceiling and open bays beat the dark slab faces and the narrow casing. */
const SURFACE_WEIGHT: Record<Surface, number> = { edgeTop: 2, bay: 2, column: 1.5, slab: 1, casing: 0.6 };

function pickSurface(on: Surface[], r: () => number): Surface {
  const total = on.reduce((s, o) => s + SURFACE_WEIGHT[o], 0);
  let k = r() * total;
  for (const o of on) if ((k -= SURFACE_WEIGHT[o]) <= 0) return o;
  return on[0];
}
/** Enamel signs per floor (on columns), and whether the exit signs by the shaft are lit. */
const SIGNS_PER_FLOOR = [0.3, 0.6, 1, 1.3];

const COLUMN_W = 9;
const PIPES_BOTTOM = 12;
/** Room paintings keep their middle clear: decals stay this close to a room's sides. */
const ROOM_EDGE = 30;

type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Rough rectangles of the things in a layer (one level of grouping deep; rotation ignored). */
function rectsOf(c: Container, ox: number, oy: number, depth: number): Rect[] {
  const out: Rect[] = [];
  for (const ch of c.children) {
    if (depth < 1 && ch.constructor === Container && ch.children.length && !ch.rotation && ch.scale.x === 1 && ch.scale.y === 1) {
      out.push(...rectsOf(ch, ox + ch.x, oy + ch.y, depth + 1));
      continue;
    }
    const b = ch.getLocalBounds();
    const xs = [b.minX * ch.scale.x, b.maxX * ch.scale.x], ys = [b.minY * ch.scale.y, b.maxY * ch.scale.y];
    const rect = { x0: ox + ch.x + Math.min(...xs), y0: oy + ch.y + Math.min(...ys), x1: ox + ch.x + Math.max(...xs), y1: oy + ch.y + Math.max(...ys) };
    // Skip anything level-sized: only hung objects matter here.
    if (rect.x1 - rect.x0 < 160 && rect.y1 - rect.y0 < 110 && Number.isFinite(rect.x0)) out.push(rect);
  }
  return out;
}
const overlaps = (a: Rect, b: Rect, pad = 0) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

function brightnessAt(x: number, y: number, lamps: WorldLamp[], ambient: number): number {
  let b = ambient;
  for (const l of lamps) {
    const R = l.reach * 1.6;
    const d = Math.hypot(x - l.x, (y - l.y) * 1.3);
    if (d >= R) continue;
    const k = 1 - d / R;
    b += l.power * k * k * 0.75;
  }
  return Math.min(1.05, b);
}

/** Lamp light × depth fog for things painted lighter than the wall (they don't multiply, so they need lighting). */
function litTint(x: number, y: number, lamps: WorldLamp[], ambient: number): number {
  // A touch above the bare structure: paint and chipped lips catch what little light there is.
  const v = Math.min(1, brightnessAt(x, y, lamps, ambient) * 1.25);
  const [r, g, b] = depthGains(y);
  const c = (k: number) => Math.round(255 * Math.max(0, Math.min(1, v * k)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

/** Which sign suits a column, from the rooms either side of it. */
function signFor(types: BuildingType[], r: () => number): DecalName {
  if (types.some(t => t === 'reactor' || t === 'reactorHall' || t === 'seedLab' || t === 'quarantineWard' || t === 'decon')) return 'sign-radiation'; // plan4:BL-13 hazard rooms
  if (types.some(t => t === 'generator' || t === 'radioTower' || t === 'batteryBank' || t === 'dataCenter')) return 'sign-voltage'; // plan4:BL-13
  if (types.some(t => t === 'waterPump' || t === 'waterPurifier' || t === 'hydroponics' || t === 'farm' || t === 'condenser' || t === 'mushroomFarm' || t === 'aquaculture' || t === 'bathhouse')) return 'sign-water'; // plan4:BL-13
  if (types.some(t => t === 'storage' || t === 'armory' || t === 'workshop' || t === 'canteen' || t === 'recycler' || t === 'garage' || t === 'library' || t === 'alloyFoundry' || t === 'componentsPlant' || t === 'gatePost')) return 'sign-nosmoke'; // plan4:BL-13
  const any: DecalName[] = ['sign-voltage', 'sign-nosmoke', 'sign-water'];
  return any[Math.floor(r() * any.length)];
}

export function buildDecals(
  grid: Grid, buildings: BuildingInstance[], floors: number, era: number, lamps: WorldLamp[] = [], ambient = 0.5,
  avoid: Container[] = [],
): DecalLayer {
  const root = new Container();
  root.eventMode = 'none';
  const sources: DecalSources = { drips: [], sparks: [] };
  const glows: { s: Sprite; a: number; ph: number }[] = [];
  const layer: DecalLayer = {
    container: root, sources,
    animate: (t, power) => {
      for (const g of glows) {
        // A lit sign hums: a slow breath, and a rare stutter when the power sags.
        const stutter = power < 0.6 && Math.sin(t * 23 + g.ph * 7) > 0.92 ? 0.3 : 1;
        g.s.alpha = g.a * Math.min(1, power * 1.2) * (0.9 + 0.1 * Math.sin(t * 1.7 + g.ph)) * stutter;
      }
    },
  };
  if (!decalsReady()) return layer;
  const e = Math.max(0, Math.min(3, era));
  const mulLayer = new Container();
  const paintLayer = new Container();
  const glowLayer = new Container();
  root.addChild(mulLayer, paintLayer, glowLayer);

  // Whatever already hangs on the structure (signage plates, stencils, wall props) keeps its spot.
  const blocked: Rect[] = avoid.flatMap(c => rectsOf(c, c.x, c.y, 0));
  const district = new Set(buildings.filter(b => isDistrict(b.type)).map(b => b.position.floor));
  const hallSpans = (f: number) => buildings.filter(b => isHall(b.type) && b.position.floor === f)
    .map(b => [slotX(b.position.x), slotX(b.position.x) + roomSlots(b.type) * SLOT_W] as [number, number]);
  const typesAt = (f: number, x: number) => buildings.filter(b => {
    if (isDistrict(b.type)) return false;
    const onFloor = b.position.floor === f || (isHall(b.type) && b.position.floor + 1 === f);
    const x0 = slotX(b.position.x), x1 = x0 + roomSlots(b.type) * SLOT_W;
    return onFloor && x >= x0 - 1 && x <= x1 + 1;
  }).map(b => b.type);

  const place = (name: DecalName, blend: Blend, x: number, y: number, w: number, h: number, alpha: number, rot = 0, flip = false, tint = 0xffffff): Sprite => {
    const s = new Sprite(tex(name)!);
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.width = w;
    s.height = h;
    if (flip) s.scale.x *= -1;
    s.rotation = rot;
    s.alpha = alpha;
    if (blend === 'mul') {
      s.blendMode = 'multiply';
      mulLayer.addChild(s);
    } else if (blend === 'add') {
      s.blendMode = 'add';
      glowLayer.addChild(s);
    } else {
      s.tint = tint;
      paintLayer.addChild(s);
    }
    return s;
  };

  for (let f = 0; f < floors; f++) {
    const r = seeded(hashString(`decals:${f}`));
    const top = floorTop(f);
    const bottom = top + ROOM_H;
    const row = grid[f] ?? [];
    const slots = grid[f] ? row.length : BASE_EAST; // [plan4:X-2] a floor the grid lacks still reads as the default extent
    // [plan4:ST-4] Index i of the row is slot i - ew; the shaft sits between the last west slot and slot 0, so no run of cells crosses index ew.
    const ex = grid.ext[f] ?? { w: 0, e: BASE_EAST };
    const ew = ex.w;
    const runEnd = (a: number, b: number) => slotX(b - 1 - ew) + SLOT_W; // x of the right edge of the slots [a, b)
    const xFirst = ew > 0 ? slotX(-ew) : ROOMS_X, xLast = slotX(ex.e);
    const taken: Rect[] = blocked.filter(b => b.y1 > top - SLAB - 4 && b.y0 < top + ROOM_H + SLAB + 4);

    // Room middles stay clear (empty bays are fair game).
    const interiors: Rect[] = [];
    for (let s = 0; s < slots;) {
      const cell = row[s];
      let e2 = s + 1;
      while (cell && e2 < slots && e2 !== ew && row[e2]?.key === cell.key) e2++;
      if (cell) interiors.push({ x0: slotX(s - ew) + ROOM_EDGE, y0: top + PIPES_BOTTOM + 2, x1: runEnd(s, e2) - ROOM_EDGE, y1: bottom - 2 });
      s = e2;
    }
    // Columns stand wherever two different things meet, and at both ends of the level.
    const cols: number[] = [ROOMS_X, xLast];
    if (ew > 0) cols.push(xFirst, -SHAFT_GAP);
    for (let s = 1; s < slots; s++) {
      if (s === ew) continue;
      const a = row[s - 1], b = row[s];
      if ((a || b) && a?.key !== b?.key) cols.push(slotX(s - ew));
    }
    cols.sort((a, b) => a - b);
    const bays: [number, number][] = [];
    for (let s = 0; s < slots;) {
      if (row[s]) { s++; continue; }
      let e2 = s + 1;
      while (e2 < slots && e2 !== ew && !row[e2]) e2++;
      bays.push([slotX(s - ew), runEnd(s, e2)]);
      s = e2;
    }
    const bayUse: number[] = [];
    const slabGaps = hallSpans(f);
    const inSlabGap = (x0: number, x1: number) => slabGaps.some(([a, b]) => x1 > a && x0 < b);

    /** A spot of the surface for a w×h decal, or null when it doesn't fit. */
    const spot = (surface: Surface, w: number, h: number): { x: number; y: number; w: number; h: number } | null => {
      switch (surface) {
        case 'slab': {
          if (h > SLAB + 3) { w *= (SLAB + 2) / h; h = SLAB + 2; }
          const lo = ew > 0 ? xFirst - 6 : -6, hi = xLast + 6;
          const x = lo + w / 2 + r() * (hi - lo - w);
          if (inSlabGap(x - w / 2, x + w / 2) || x - w / 2 < SHAFT_W + 2 && x + w / 2 > -2 && r() < 0.6) return null;
          return { x, y: bottom + 6.5 + (r() - 0.5) * 2, w, h };
        }
        case 'column': {
          if (w > 16) return null;
          const x = cols[Math.floor(r() * cols.length)];
          return { x, y: top + PIPES_BOTTOM + 8 + h / 2 + r() * (ROOM_H - PIPES_BOTTOM - 24 - h), w, h };
        }
        case 'edgeTop': {
          if (w > 22) { h *= 22 / w; w = 22; }
          const x = cols[Math.floor(r() * cols.length)];
          const side = x <= xFirst ? 1 : x >= xLast ? -1 : ew > 0 && x === -SHAFT_GAP ? -1 : ew > 0 && x === ROOMS_X ? 1 : r() < 0.5 ? -1 : 1;
          return { x: x + side * (COLUMN_W / 2 + 1 + w / 2 + r() * 3), y: top + PIPES_BOTTOM + h / 2 - 1, w, h };
        }
        case 'bay': {
          // One thing per open bay (two in a wide one), or every bay turns into a notice board.
          const free = bays.filter(([a, b], i) => (bayUse[i] ?? 0) < (b - a >= 3 * SLOT_W ? 2 : 1));
          if (!free.length) return null;
          const [x0, x1] = free[Math.floor(r() * free.length)];
          if (x1 - x0 < w + 12) return null;
          const bi = bays.findIndex(b => b[0] === x0);
          bayUse[bi] = (bayUse[bi] ?? 0) + 1;
          return { x: x0 + 6 + w / 2 + r() * (x1 - x0 - 12 - w), y: top + 18 + h / 2 + r() * Math.max(0, ROOM_H - 30 - h), w, h };
        }
        case 'casing': {
          // The narrow strips of casing either side of the bunker (the east one is a tunnel on district floors).
          const east = !district.has(f) && r() < 0.6;
          const x = east ? xLast + 6 : ew > 0 ? xFirst - 7 : -6;
          // The west strip is a hand's width beside the shaft: keep to it.
          const cap = east ? 16 : 11;
          if (w > cap) { h *= cap / w; w = cap; }
          return { x, y: top + 8 + h / 2 + r() * Math.max(0, ROOM_H - 10 - h), w, h };
        }
      }
    };

    const fits = (x: number, y: number, w: number, h: number) => {
      const rect = { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
      if (interiors.some(i => overlaps(rect, i)) || taken.some(t => overlaps(rect, t, 3))) return null;
      return rect;
    };

    const pool = POOLS[e];
    const total = pool.reduce((s, [, wgt]) => s + wgt, 0);
    const pick = () => {
      let k = r() * total;
      for (const [n, wgt] of pool) if ((k -= wgt) <= 0) return n;
      return pool[0][0];
    };
    let stencils = 0;
    for (let i = 0, tries = 0; i < PER_FLOOR[e] && tries < 40; tries++) {
      const name = pick();
      if (name === 'stencil' && stencils > 0) continue;
      const k = KINDS[name]!;
      const scale = 0.85 + r() * 0.3;
      const surface = pickSurface(k.on, r);
      const sp = spot(surface, k.size[0] * scale, k.size[1] * scale);
      if (!sp) continue;
      const rect = fits(sp.x, sp.y, sp.w, sp.h);
      if (!rect) continue;
      taken.push(rect);
      i++;
      const alpha = k.alpha[0] + r() * (k.alpha[1] - k.alpha[0]);
      const rot = (r() - 0.5) * 2 * (k.rot ?? 0);
      const flip = !!k.flip && r() < 0.5;
      const tint = litTint(sp.x, sp.y, lamps, ambient);
      if (name === 'stencil') {
        stencils++;
        stencil(sp.x, sp.y, sp.h, f + 1, alpha, tint);
        continue;
      }
      let rx = sp.x;
      if (name === 'arrow') {
        // Arrows point the way out: toward the shaft.
        place(name, 'alpha', sp.x, sp.y, sp.w, sp.h, alpha, 0, false, tint).scale.x *= -1;
        continue;
      }
      place(name, k.blend, rx, sp.y, sp.w, sp.h, alpha, rot, flip, tint);
      if (name === 'stain-a' || name === 'stain-b') {
        // The wettest run ends about two thirds down; drops fall from there to the floor below.
        rx += (r() - 0.5) * sp.w * 0.4;
        sources.drips.push({ x: rx, y: sp.y + sp.h * 0.22, floorY: bottom - 4 });
      }
    }

    // Enamel signs on the columns.
    let signs = SIGNS_PER_FLOOR[e];
    while (signs > 0) {
      const chance = Math.min(1, signs);
      signs -= 1;
      if (r() > chance) continue;
      const inner = cols.filter(x => x > xFirst + 1);
      if (!inner.length) break;
      const x = inner[Math.floor(r() * inner.length)];
      const y = top + PIPES_BOTTOM + 16 + r() * 10;
      const rect = fits(x, y, 13, 13);
      if (!rect) continue;
      taken.push(rect);
      const name = signFor(typesAt(f, x), r);
      const wreck = e <= 1;
      place(name, 'alpha', x, y, 13, 13, 1, wreck ? (r() - 0.5) * 0.25 : (r() - 0.5) * 0.04, false, litTint(x, y, lamps, ambient));
    }

    // From the Colony on, every level has an exit sign by the shaft; in the Undercity it is lit.
    if (e >= 2) {
      const x = ROOMS_X + 2, y = top + PIPES_BOTTOM + 12;
      taken.push({ x0: x - 9, y0: y - 4.5, x1: x + 9, y1: y + 4.5 });
      const lit = e >= 3;
      place('sign-exit', 'alpha', x, y, 18, 9, 1, 0, false, lit ? 0xd8e8d8 : litTint(x, y, lamps, ambient));
      if (lit) {
        const g = place('sign-exit-glow', 'add', x, y, 30, 15, 0.75);
        glows.push({ s: g, a: 0.75, ph: f * 1.7 });
      }
    }

    // The Remnant's broken junction boxes (they spark — see atmosphere.ts).
    if (e === 0 && (r() < 0.45 || f === 0)) {
      for (let k = 0; k < 6; k++) {
        const useCasing = r() < 0.35;
        const x = useCasing ? (district.has(f) ? (ew > 0 ? xFirst - 7 : -6) : xLast + 6) : cols[Math.floor(r() * cols.length)];
        const y = top + PIPES_BOTTOM + 10 + r() * 14;
        const rect = fits(x, y, 11, 14.5);
        if (!rect) continue;
        taken.push(rect);
        place('jbox', 'alpha', x, y, 11, 14.5, 1, 0, r() < 0.5, litTint(x, y, lamps, ambient));
        sources.sparks.push({ x, y: y + 2 });
        break;
      }
    }
  }

  /** Painted "B<level>" stencil: the letter plus digits cropped from the digit strip. */
  function stencil(x: number, y: number, h: number, level: number, alpha: number, tint: number): void {
    const B = tex('stencil-B')!;
    const strip = tex('stencil-digits')!;
    const digits = String(level).split('').map(Number);
    const cw = strip.width / 10;
    const dh = h, dw = (cw / strip.height) * h * 0.95;
    const bw = h * 0.95;
    const total = bw + dw * digits.length - h * 0.2;
    let cx = x - total / 2 + bw / 2;
    const b = new Sprite(B);
    b.anchor.set(0.5);
    b.position.set(cx, y);
    b.width = bw;
    b.height = h;
    b.alpha = alpha;
    b.tint = tint;
    paintLayer.addChild(b);
    // The painted glyphs sit inside roomy cells: tuck the digits in against the letter.
    cx += bw / 2 + dw / 2 - h * 0.2;
    for (const d of digits) {
      const s = new Sprite(new Texture({ source: strip.source, frame: new Rectangle(strip.frame.x + d * cw, strip.frame.y, cw, strip.height) }));
      s.anchor.set(0.5);
      s.position.set(cx, y);
      s.width = dw;
      s.height = dh;
      s.alpha = alpha;
      s.tint = tint;
      paintLayer.addChild(s);
      cx += dw;
    }
  }

  return layer;
}

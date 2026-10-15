import { T } from './tokens';
import { SH, Z_BASE, hash2, zf } from './iso';

/**
 * The scene, as data. A voxel-ish grid: NX x NY columns, 4 levels (0 surface, 1 upper shelter, 2 service network, 3 old metro).
 *
 *   surface strip (y < 7)  ruined ground, the hatch and a ramp trench that drops to level 1
 *   atrium  x 3-14, y 7-18 open to the sky (a collapsed crater); balconies on levels 1 and 2, a bridge, two stair flights
 *   corridor x 15-19, y 12-14 an old metro tunnel on level 3
 *   district x 20-33, y 8-19  six dwellings / workshops around a street
 *   dark edge x 34-45  the tunnel goes on, blocked by rubble at x 38-39; past it a lantern; fog covers everything x >= 36
 *   cave pocket around (29, 23.5)  hidden under fog, glowing crystals
 */
export const NX = T.map.nx;
export const NY = T.map.ny;
export const LEVELS = 4;

export const R = 0; // rock
export const F = 1; // floor (walkable slab)
export const V = 2; // void / air
export const X = 3; // nothing (above the cut, sky)
export const G = 4; // surface ground (level 0 only)
export const P = 5; // ramp (level 0)

export const REG_ROCK = 0, REG_SURF = 1, REG_ATRIUM = 2, REG_CORR = 3, REG_DIST = 4, REG_TUNNEL = 5, REG_CAVE = 6;

export const idx = (x: number, y: number): number => y * NX + x;
export const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < NX && y < NY;

export const cells: Uint8Array[] = Array.from({ length: LEVELS }, () => new Uint8Array(NX * NY));
export const region = new Uint8Array(NX * NY);
export const blocked: Uint8Array[] = Array.from({ length: LEVELS }, () => new Uint8Array(NX * NY));
export const fogged = new Uint8Array(NX * NY);
const wallEdges = new Set<string>();

export function cell(l: number, x: number, y: number): number {
  if (!inside(x, y)) return R;
  return cells[l][idx(x, y)];
}
function fill(l: number, x0: number, x1: number, y0: number, y1: number, v: number, reg = -1): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    cells[l][idx(x, y)] = v;
    if (reg >= 0) region[idx(x, y)] = reg;
  }
}
function block(l: number, x0: number, x1: number, y0: number, y1: number): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) blocked[l][idx(x, y)] = 1;
}
const edgeKey = (x: number, y: number, x2: number, y2: number): string =>
  x < x2 || (x === x2 && y < y2) ? `${x},${y}|${x2},${y2}` : `${x2},${y2}|${x},${y}`;
export function wallBetween(x: number, y: number, x2: number, y2: number): boolean {
  return wallEdges.has(edgeKey(x, y, x2, y2));
}

export interface Stair {
  x0: number; x1: number; y0: number; y1: number; // cells (half-open); axis is y, going down toward +y
  from: number; to: number; // levels
  kind: 'steps' | 'ramp';
}
export const stairs: Stair[] = [
  { x0: 9, x1: 11, y0: 3, y1: 7, from: 0, to: 1, kind: 'ramp' },
  { x0: 13, x1: 15, y0: 9, y1: 13, from: 1, to: 2, kind: 'steps' },
  { x0: 3, x1: 5, y0: 9, y1: 13, from: 2, to: 3, kind: 'steps' },
];
/** z of the walking surface on a stair at position `along` (y). */
export function stairZ(s: Stair, along: number): number {
  const t = Math.min(1, Math.max(0, (along - s.y0) / (s.y1 - s.y0)));
  return zf(s.from) - SH * t;
}
export function stairAt(x: number, y: number): Stair | null {
  for (const s of stairs) if (x >= s.x0 && x < s.x1 && y >= s.y0 && y < s.y1) return s;
  return null;
}

export interface Dwelling {
  x0: number; x1: number; y0: number; y1: number;
  /** Which side faces the street: 'S' = +y (north row), 'N' = -y (south row). Door is on that side at doorX. */
  face: 'S' | 'N'; doorX: number;
  kind: 'home' | 'workshop' | 'garden' | 'forge' | 'tv';
  color: number; mat: 'corrugated' | 'container' | 'brick' | 'tarp';
  name: string;
}
const DC = T.color.dwellings;
export const dwellings: Dwelling[] = [
  { x0: 20, x1: 23, y0: 8, y1: 12, face: 'S', doorX: 21, kind: 'home', color: DC[0], mat: 'corrugated', name: 'בית משפחת לוי' },
  { x0: 24, x1: 27, y0: 8, y1: 12, face: 'S', doorX: 25, kind: 'tv', color: DC[1], mat: 'container', name: 'מכולת המשמר' },
  { x0: 28, x1: 32, y0: 8, y1: 12, face: 'S', doorX: 30, kind: 'workshop', color: DC[2], mat: 'container', name: 'בית המלאכה' },
  { x0: 21, x1: 24, y0: 15, y1: 19, face: 'N', doorX: 22, kind: 'home', color: DC[3], mat: 'brick', name: 'בית' },
  { x0: 25, x1: 28, y0: 15, y1: 19, face: 'N', doorX: 26, kind: 'garden', color: DC[4], mat: 'tarp', name: 'החממה' },
  { x0: 29, x1: 33, y0: 15, y1: 19, face: 'N', doorX: 31, kind: 'forge', color: DC[5], mat: 'brick', name: 'הנפחייה' },
];

export interface Light {
  x: number; y: number; z: number; l: number;
  color: number; r: number; i: number;
  type: 'steady' | 'fire' | 'fail' | 'pulse' | 'tv' | 'weld' | 'blink' | 'sway';
  glow?: number; // size of the bulb glow in u (0 = none)
  vol?: boolean;
  tease?: boolean;
  /** Floor height the pool lands on (moving lights); defaults to the floor of level l. */
  floorZ?: number;
  phase?: number;
}
const L = T.light;
const z3 = zf(3), z2 = zf(2), z1 = zf(1);
export const lights: Light[] = [
  // surface
  { x: 13, y: 2, z: 0.2, l: 0, color: L.moon, r: 17, i: 0.7, type: 'steady', vol: false },
  { x: 11.6, y: 2.4, z: 1.5, l: 0, color: L.lamp, r: 3.2, i: 0.95, type: 'fail', glow: 0.35, vol: true },
  { x: 6.5, y: 4.5, z: 3.3, l: 0, color: L.emergency, r: 1.2, i: 0.8, type: 'blink', glow: 0.3 },
  // atrium: skylight and fire and string lights
  { x: 9, y: 13, z: z3, l: 3, color: L.sky, r: 5.5, i: 0.55, type: 'pulse', vol: false },
  { x: 8.5, y: 15.5, z: z3 + 0.9, l: 3, color: L.fire, r: 4.6, i: 1.25, type: 'fire', glow: 0.55, vol: true },
  { x: 6, y: 11, z: z3 + 0.6, l: 3, color: L.lamp, r: 3.4, i: 0.55, type: 'steady', vol: false },
  { x: 12, y: 16, z: z3 + 0.6, l: 3, color: L.lamp, r: 3.4, i: 0.5, type: 'steady', vol: false },
  { x: 5.2, y: 7.6, z: z1 + 1.5, l: 1, color: L.lamp, r: 2.8, i: 0.85, type: 'steady', glow: 0.28, vol: true },
  { x: 12.8, y: 7.6, z: z1 + 1.5, l: 1, color: L.cool, r: 2.6, i: 0.7, type: 'fail', glow: 0.25, vol: true },
  { x: 7.5, y: 7.6, z: z2 + 1.5, l: 2, color: L.lamp, r: 2.8, i: 0.8, type: 'steady', glow: 0.28, vol: true },
  { x: 12, y: 13.8, z: z2 + 1.4, l: 2, color: L.lamp, r: 2.4, i: 0.75, type: 'sway', glow: 0.25, vol: true },
  // corridor (sodium)
  { x: 16.5, y: 12.2, z: z3 + 1.9, l: 3, color: L.sodium, r: 3.0, i: 1.0, type: 'steady', glow: 0.3, vol: true },
  { x: 19.2, y: 12.2, z: z3 + 1.9, l: 3, color: L.sodium, r: 3.0, i: 0.95, type: 'fail', glow: 0.3, vol: true },
  // district street lamps
  { x: 22.6, y: 12.3, z: z3 + 2.0, l: 3, color: L.lamp, r: 3.6, i: 1.0, type: 'steady', glow: 0.3, vol: true },
  { x: 27.4, y: 14.7, z: z3 + 2.0, l: 3, color: L.lamp, r: 3.6, i: 0.95, type: 'steady', glow: 0.3, vol: true },
  { x: 32.6, y: 12.3, z: z3 + 2.0, l: 3, color: L.lamp, r: 3.4, i: 0.9, type: 'steady', glow: 0.3, vol: true },
  // dwellings
  { x: 21.5, y: 9.4, z: z3 + 1.2, l: 3, color: L.lamp, r: 2.2, i: 0.9, type: 'fire', glow: 0.14, vol: true },
  { x: 25.5, y: 9.2, z: z3 + 0.7, l: 3, color: L.tv, r: 2.2, i: 0.85, type: 'tv', glow: 0.18, vol: true },
  { x: 30, y: 9.0, z: z3 + 1.0, l: 3, color: L.cool, r: 2.6, i: 0.9, type: 'steady', glow: 0.2, vol: true },
  { x: 29.2, y: 8.9, z: z3 + 0.9, l: 3, color: 0x9fd4ff, r: 1.8, i: 1.4, type: 'weld', glow: 0.3, vol: true },
  { x: 22.5, y: 17.5, z: z3 + 1.2, l: 3, color: L.lamp, r: 2.2, i: 0.8, type: 'steady', glow: 0.14, vol: true },
  { x: 26.5, y: 17, z: z3 + 1.6, l: 3, color: L.grow, r: 2.4, i: 0.95, type: 'steady', glow: 0.2, vol: true },
  { x: 31.2, y: 16.2, z: z3 + 0.7, l: 3, color: L.forge, r: 3.0, i: 1.25, type: 'fire', glow: 0.4, vol: true },
  // dark edge
  { x: 36.6, y: 12.3, z: z3 + 1.8, l: 3, color: L.emergency, r: 2.6, i: 0.75, type: 'pulse', glow: 0.22, vol: true },
  { x: 43.2, y: 13.4, z: z3 + 0.7, l: 3, color: L.lantern, r: 2.6, i: 0.7, type: 'fire', glow: 0.22, vol: true, tease: true },
  // cave pocket (hidden)
  { x: 28.2, y: 23.4, z: z3 + 0.5, l: 3, color: L.crystal, r: 2.6, i: 0.9, type: 'pulse', glow: 0.25, vol: true },
  { x: 31.0, y: 24.2, z: z3 + 0.4, l: 3, color: L.crystal, r: 2.0, i: 0.8, type: 'pulse', glow: 0.2, vol: true },
  // the core, far below: lights the deep strata bands on the block faces
  { x: 30, y: 30, z: Z_BASE + 0.6, l: 4, color: L.core, r: 22, i: 0.4, type: 'pulse', vol: false },
  { x: 2, y: 30, z: Z_BASE + 2.5, l: 4, color: 0x6b7fb0, r: 16, i: 0.28, type: 'steady', vol: false },
];

/** Named places survivors walk to: [level, x, y]. */
export const pois: [number, number, number][] = [
  [0, 11, 1], [0, 7, 5], [0, 14, 4],
  [1, 5, 7], [1, 11, 8], [1, 13, 8],
  [2, 7, 7], [2, 11, 10], [2, 13, 14],
  [3, 7, 15], [3, 10, 14], [3, 6, 17], [3, 12, 9], [3, 17, 13],
  [3, 21, 10], [3, 25, 10], [3, 29, 10], [3, 22, 17], [3, 26, 17], [3, 30, 17],
  [3, 24, 13], [3, 31, 13], [3, 35, 13],
];

function buildMap(): void {
  // defaults
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    cells[0][idx(x, y)] = y < 7 ? G : X;
    region[idx(x, y)] = y < 7 ? REG_SURF : REG_ROCK;
    for (let l = 1; l < LEVELS; l++) cells[l][idx(x, y)] = R;
  }
  // ramp trench from the hatch down to the level-1 balcony
  fill(0, 9, 11, 3, 7, P);
  fill(1, 9, 11, 3, 7, V);
  // atrium
  fill(0, 3, 15, 7, 19, X, REG_ATRIUM);
  fill(1, 3, 15, 7, 19, V);
  fill(2, 3, 15, 7, 19, V);
  fill(3, 3, 15, 7, 19, F);
  fill(1, 3, 15, 7, 9, F); // level-1 balcony along the cliff
  fill(2, 3, 15, 7, 9, F); // level-2 balcony right under it
  fill(2, 11, 13, 9, 13, F); // bridge
  fill(2, 11, 15, 13, 15, F); // landing at the foot of the first flight
  // corridor, district, tunnel
  fill(3, 15, 20, 12, 15, F, REG_CORR);
  fill(3, 20, 34, 8, 20, F, REG_DIST);
  fill(3, 34, 46, 12, 15, F, REG_TUNNEL);
  // cave pocket (irregular)
  for (let y = 20; y < NY; y++) for (let x = 22; x < 36; x++) {
    const dx = (x + 0.5 - 29.5) / 4.4, dy = (y + 0.5 - 23.6) / 2.5;
    if (dx * dx + dy * dy + (hash2(x, y, 7) - 0.5) * 0.35 < 1) { cells[3][idx(x, y)] = F; region[idx(x, y)] = REG_CAVE; }
  }
  // walk blockers: under the lower flight, the fire barrel, stalls, tank, rubble, dwelling furniture
  block(3, 3, 5, 9, 13);
  block(3, 8, 9, 15, 16);
  block(3, 6, 8, 10, 11); // stall 1
  block(3, 10, 12, 17, 18); // stall 2
  block(3, 13, 14, 17, 18); // water tank
  block(3, 38, 40, 12, 15); // rubble
  block(0, 12, 14, 1, 2); // fallen hatch door
  block(0, 2, 6, 1, 2); // ruined wall
  block(0, 21, 25, 2, 5); // car
  for (let i = 0; i < NX * NY; i++) if (region[i] === REG_CAVE) blocked[3][i] = 1; // the cave is not reachable (yet)
  // dwelling walls -> blocked edges (door left open), furniture cells
  for (const d of dwellings) {
    for (let x = d.x0; x < d.x1; x++) {
      if (!(d.face === 'N' && x === d.doorX)) wallEdges.add(edgeKey(x, d.y0, x, d.y0 - 1));
      if (!(d.face === 'S' && x === d.doorX)) wallEdges.add(edgeKey(x, d.y1 - 1, x, d.y1));
    }
    for (let y = d.y0; y < d.y1; y++) {
      wallEdges.add(edgeKey(d.x0, y, d.x0 - 1, y));
      wallEdges.add(edgeKey(d.x1 - 1, y, d.x1, y));
    }
    const back = d.face === 'S' ? d.y0 : d.y1 - 1;
    blocked[3][idx(d.x0, back)] = 1; // bed / bench / planter in the back corner
    blocked[3][idx(d.x1 - 1, back)] = 1;
  }
  // fog: the dark edge and the rock around the cave pocket
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const dx = (x + 0.5 - 29.5) / 5.8, dy = (y + 0.5 - 23.8) / 3.8;
    if (x >= 36 || (y >= 20 && dx * dx + dy * dy < 1)) fogged[idx(x, y)] = 1;
  }
}
buildMap();

// ------------------------------------------------------------------------------------------------------------------
// Columns: how high the solid mass under each (x, y) goes for a given slice level, and what is on top.

export type TopKind = 'ground' | 'cut' | 'floor' | 'ramp';
export interface Columns {
  top: Float32Array;
  kind: TopKind[];
  /** Level the column's top belongs to (for slicing / ghosting). */
  topLevel: Uint8Array;
  /** Slab floors above the column's lowest open level: [level, ...]. */
  slabs: number[][];
}

const rampTop = (x: number, y: number): [number, number] => {
  const s = stairs[0];
  return [stairZ(s, y), stairZ(s, y + 1)];
};
export { rampTop };

/**
 * slice = 0 shows everything; slice = k (1..3) removes all levels above k and cuts the rock at the ceiling of level k.
 * Rock with no excavation in its column is cut down automatically wherever it would hide an open cell behind it.
 */
export function computeColumns(slice: number): Columns {
  const n = NX * NY;
  const top = new Float32Array(n);
  const kind: TopKind[] = new Array(n);
  const topLevel = new Uint8Array(n);
  const slabs: number[][] = Array.from({ length: n }, () => []);
  const ceil = slice === 0 ? 0 : zf(slice) + SH;
  const minL = Math.max(1, slice);
  // open cells that must stay visible
  const open: { d: number; s: number; z: number }[] = [];
  for (let l = minL; l < LEVELS; l++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    if (cells[l][idx(x, y)] === F) open.push({ d: x + y, s: x - y, z: zf(l) });
  }
  if (slice === 0) for (const s of stairs) for (let y = s.y0; y < s.y1; y++) for (let x = s.x0; x < s.x1; x++) open.push({ d: x + y, s: x - y, z: stairZ(s, y + 0.5) });
  const perDiag = T.tile.w / 4 / T.tile.zUnit; // u of height per diagonal step (16 px / 39.2 px)
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = idx(x, y);
    let deepest = -1;
    for (let l = minL; l < LEVELS; l++) if (cells[l][i] !== R) deepest = l;
    const g = cells[0][i];
    if (slice === 0 && g === G) { top[i] = 0; kind[i] = 'ground'; topLevel[i] = 0; continue; }
    if (slice === 0 && g === P) { top[i] = rampTop(x, y)[1]; kind[i] = 'ramp'; topLevel[i] = 0; continue; }
    if (slice > 0 && (g === G || g === P)) { top[i] = ceil; kind[i] = 'cut'; topLevel[i] = slice; continue; }
    if (deepest >= 0) {
      // lowest floor in the column; shallower floors become slabs
      let floorL = deepest;
      while (floorL >= minL && cells[floorL][i] !== F) floorL--;
      if (floorL < minL) floorL = deepest;
      top[i] = zf(floorL);
      kind[i] = 'floor';
      topLevel[i] = floorL;
      for (let l = minL; l < floorL; l++) if (cells[l][i] === F) slabs[i].push(l);
      continue;
    }
    // rock only: as high as possible without hiding any open cell behind it
    let lim = ceil;
    const d = x + y, s = x - y;
    for (const o of open) {
      const dd = d - o.d;
      if (dd <= 0 || dd > 26 || Math.abs(o.s - s) > 1) continue;
      const allowed = o.z + T.cut.personH + (dd - 1) * perDiag;
      if (allowed < lim) lim = allowed;
    }
    if (lim < ceil) {
      lim += (hash2(x, y, 3) - 0.5) * T.cut.jitter;
      lim = Math.round(lim / T.cut.quant) * T.cut.quant;
    }
    lim = Math.max(zf(3) + T.cut.stub, Math.min(ceil, lim));
    top[i] = lim;
    kind[i] = lim >= 0 ? 'ground' : 'cut';
    topLevel[i] = lim >= 0 ? 0 : Math.max(slice, bandLevel(bandOf(lim - 1e-3)));
  }
  return { top, kind, topLevel, slabs };
}

/** Which stratum band (0..6) a height belongs to. 0 = the thin soil cap. */
export function bandOf(z: number): number {
  if (z > -0.55) return 0;
  if (z > zf(1)) return 1;
  if (z > zf(2)) return 2;
  if (z > zf(3)) return 3;
  if (z > zf(3) - T.deepBand) return 4;
  if (z > zf(3) - 2 * T.deepBand) return 5;
  return 6;
}
/** Band edges from the bottom up: [z0, z1, band]. */
export const BANDS: [number, number, number][] = [
  [Z_BASE, zf(3) - 2 * T.deepBand, 6],
  [zf(3) - 2 * T.deepBand, zf(3) - T.deepBand, 5],
  [zf(3) - T.deepBand, zf(3), 4],
  [zf(3), zf(2), 3],
  [zf(2), zf(1), 2],
  [zf(1), -0.55, 1],
  [-0.55, 0, 0],
];
/** Level a band belongs to for slicing (deep bands are always shown). */
export const bandLevel = (b: number): number => (b === 0 ? 1 : b <= 3 ? b : 4);

// ------------------------------------------------------------------------------------------------------------------
// Walk graph

export interface Node { id: number; x: number; y: number; z: number; l: number; stair: Stair | null; nb: number[] }
export const nodes: Node[] = [];
const nodeAt = new Map<string, number[]>(); // "x,y" -> node ids

function addNode(x: number, y: number, z: number, l: number, stair: Stair | null): void {
  const id = nodes.length;
  nodes.push({ id, x: x + 0.5, y: y + 0.5, z, l, stair, nb: [] });
  const k = `${x},${y}`;
  const a = nodeAt.get(k);
  if (a) a.push(id); else nodeAt.set(k, [id]);
}

function buildGraph(): void {
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = idx(x, y);
    const st = stairAt(x, y);
    if (st) addNode(x, y, stairZ(st, y + 0.5), st.from, st);
    if (cells[0][i] === G && x >= 3 && x < 18 && !blocked[0][i]) addNode(x, y, 0, 0, null);
    for (let l = 1; l < LEVELS; l++) if (cells[l][i] === F && !blocked[l][i]) addNode(x, y, zf(l), l, null);
  }
  for (const n of nodes) {
    const x = Math.floor(n.x), y = Math.floor(n.y);
    const dirs = n.stair ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const ids = nodeAt.get(`${x + dx},${y + dy}`);
      if (!ids) continue;
      if (wallBetween(x, y, x + dx, y + dy)) continue;
      for (const j of ids) {
        const m = nodes[j];
        if (m.stair && m.stair !== n.stair && dx !== 0) continue; // only enter stairs along their axis
        if (m.stair && dx !== 0) continue;
        if (Math.abs(m.z - n.z) < 0.7) n.nb.push(j);
      }
    }
  }
}
buildGraph();

export function nodeNear(l: number, x: number, y: number): number {
  let best = -1, bd = 1e9;
  for (const n of nodes) {
    if (n.l !== l || n.stair) continue;
    const d = (n.x - x - 0.5) ** 2 + (n.y - y - 0.5) ** 2;
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}

export function findPath(a: number, b: number): number[] | null {
  const prev = new Int32Array(nodes.length).fill(-2);
  const q = [a];
  prev[a] = -1;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (c === b) break;
    for (const j of nodes[c].nb) if (prev[j] === -2 && !fogged[idx(Math.floor(nodes[j].x), Math.floor(nodes[j].y))]) { prev[j] = c; q.push(j); }
  }
  if (prev[b] === -2) return null;
  const out: number[] = [];
  for (let c = b; c !== -1; c = prev[c]) out.push(c);
  return out.reverse();
}

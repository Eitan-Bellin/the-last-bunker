/**
 * [world:M2 camera-nav] The city's walking graph (architecture D10, 1.3, M2): Dijkstra over every way a survivor can get around "The City
 * Below", emitting the walkers' existing `Route` (rendering/routes.ts) so walkers.ts moves people exactly as before.
 *
 * Nodes are places on a floor's walking line where a way up or down starts:
 *   - the lift landing on the balcony lane of every dug floor (LANDING_X; the lift joins every landing to every other one, at a wait cost);
 *   - the shaft ladder foot of every floor and the surface row (LADDER_X; the only way to the surface, the last resort elsewhere);
 *   - the hub stair columns (the layout's `hubs[].stairs`, lane to lane, inside one stratum);
 *   - the void stair towers (airy) and built stairwells / evacuation rooms, as far as their column runs vertically in ONE frame;
 *   - the two ends of every gallery transfer (the layout's `transfers`, the level-builder's geometry; ramps or stairs inside a stratum may be
 *     given the same way).
 * Walking along a floor joins neighbouring nodes in x order; a closed or sealed door (routes.ts `walkBlocked`, fed by `isPassable`) cuts
 * that link. Costs are travel times in seconds (WALK / STAIR / LADDER speeds, LIFT_EST_S for the lift). Frames that differ per stratum
 * (column jogs) need nothing special: every node's x comes from its own floor's frame, and a column links two floors only where it stands at
 * the same x on both.
 *
 * Rolls (`rnd`): below CITY_HUB_STAIR_SHARE the walker is "lift-shy" (the lift costs LIFT_SHY_S more), so about half the trips that can be
 * walked are walked; the others weigh stairs STAIR_EFFORT heavier and mostly ride: the atrium, the towers and the gallery are built to be seen in use. A lift-shy plan longer than CITY_MAX_TRIP_S is planned
 * again without the penalty (the lift when the stairs would take too long); a plan still longer is refused (the survivor appears there).
 *
 * The graph is built once per layout key (a cheap numeric hash of the floors, extents, rooms, ruins, infrastructure and frames) and
 * queried with preallocated typed arrays: a query allocates nothing. Pure and Node-safe (no Pixi).
 */
import type { GameState } from '../../core/GameState';
import { getDef } from '../../data/buildingDefs';
import { stratumOf, type StratumId } from '../../data/strata';
import { GALLERY_ABOVE_FLOORS } from '../../data/zones';
import { FLIGHT_RISE, GALLERY_H, SLOT_W, TOWER_AMP, FLIGHTS_PER_FLOOR, extentsFor, galleryTop } from '../../rendering/geom';
import { GFX } from '../../rendering/gfxFeatures';
import { occupancy } from '../../rendering/occupancy';
import {
  CITY_HUB_STAIR_SHARE, CITY_MAX_TRIP_S, LADDER_SPEED, LADDER_X, LANDING_X, LEG_LADDER, LEG_LIFT, LEG_STAIRS, LEG_WALK, LIFT_EST_S, MAX_WP,
  STAIR_SPEED, WALK_SPEED, laneY, lineY, pushWaypoint, walkBlocked, walkTo, type Route, type Stop,
} from '../../rendering/routes';
import { voidBoundaries } from '../../rendering/voids';
import { PROJECTION, frameOfStratum, slotX } from '../project';
import { cityLayoutProvider } from '../render/citySeams';
import type { CityLayout } from '../render/layoutTypes';
import { HUB_FLIGHTS_PER_FLOOR, HUB_STAIR_AMP, hubStairX } from './hubStairs';

/**
 * A gallery transfer (the level-builder's contract, M2-L-notes.md): the walk between the bottom floor of one stratum and the top floor of the
 * next through the service gallery. `top` is on `fromFloor`'s walking line, `bottom` on `toFloor`'s; `run` is the drawn way between them
 * (it may or may not repeat the two ends). How a run segment is walked: nearly flat = a walk; a slope (|dx| >= |dy| / 2) = one straight
 * flight (a ramp or a stair run); steeper = zig-zag flights of FLIGHT_RISE around the segment (a stair column), see `emitLink`.
 * Ramps and stairs inside a stratum can be given in the same list (any fromFloor / toFloor).
 */
export interface NavTransfer {
  gallery: number;
  fromFloor: number;
  toFloor: number;
  side: 'w' | 'e';
  top: { x: number; y: number };
  bottom: { x: number; y: number };
  run: { x: number; y: number }[];
}

/** Extra cost (s) of the lift for a lift-shy walker (roll below CITY_HUB_STAIR_SHARE): they walk any trip that stays drawable. */
export const LIFT_SHY_S = 45;
/** The shaft ladder is the last resort (blackout, no stairs): its time counts this many times in the search (not in the trip's seconds). */
export const LADDER_PENALTY = 4;
/** A walker who is not lift-shy weighs stairs, towers and transfers this much heavier than their time (the lift is right there). */
export const STAIR_EFFORT = 1.6;

const K_LANDING = 0;
const K_LADDER = 1;
const K_STAIR = 2;
const K_LINK = 3;

const E_WALK = 0;
const E_LIFT = 1;
const E_STAIRS = 2;
const E_LADDER = 3;
const E_LINK = 4;

/** How a column's stops sit: on the corridor lane (hub stairs, towers) or on the room line (stairwells, one flight a storey). */
const COL_LANE = 0;
const COL_LINE = 1;

interface Link {
  from: number;
  to: number;
  /** Points from `from` to `to` (flat x, y pairs), deduped. */
  pts: Float64Array;
  seconds: number;
}

interface Graph {
  key: number;
  /** Dug floors; floor index fi = floor + 1 (the surface row is -1). */
  floors: number;
  N: number;
  nx: Float64Array;
  ny: Float64Array;
  nf: Int16Array;
  nk: Uint8Array;
  nref: Int32Array;
  /** Nodes of each floor sorted by x: fNodes[fStart[fi] .. fStart[fi + 1]); nPos = a node's index in its floor's list. */
  fStart: Int32Array;
  fNodes: Int32Array;
  nPos: Int32Array;
  /** Vertical edges (stairs, ladder, links), CSR. */
  aStart: Int32Array;
  aTo: Int32Array;
  aCost: Float64Array;
  aKind: Uint8Array;
  aRef: Int32Array;
  landing: Int32Array;
  surface: number;
  colX: Float64Array;
  colAmp: Float64Array;
  colPer: Uint8Array;
  colMode: Uint8Array;
  links: Link[];
  /** Query scratch (N + 2: the start S = N and the target T = N + 1). */
  dist: Float64Array;
  prev: Int32Array;
  prevE: Uint8Array;
  prevRef: Int32Array;
  done: Uint8Array;
  heapK: Float64Array;
  heapV: Int32Array;
  path: Int32Array;
  pathE: Uint8Array;
  pathRef: Int32Array;
}

// --- Layout source -------------------------------------------------------------------------------------------------------------------

type LayoutSource = (state: GameState) => CityLayout | null;
let source: LayoutSource = state => cityLayoutProvider().build(state);

/** Tests and tools: where the graph reads the hubs and transfers (default: the renderer's layout provider). Null restores the default. */
export function setNavLayoutSource(fn: LayoutSource | null): void {
  source = fn ?? (state => cityLayoutProvider().build(state));
  graph = null;
}

/**
 * Stand-in transfers until the level-builder's layout carries its own (`transfers` absent): one per revealed gallery, from the east hub stair
 * column of the upper stratum down into the gallery, along it, and down the east hub stair column of the lower one. Exported for tests.
 */
export function standInTransfers(floors: number): NavTransfer[] {
  const out: NavTransfer[] = [];
  if (!GFX.galleries) return out;
  GALLERY_ABOVE_FLOORS.forEach((above, g) => {
    if (above + 1 >= floors) return;
    const sa = stratumOf(above) as StratumId, sb = stratumOf(above + 1) as StratumId;
    if (sa === sb || sa < 1) return;
    const xa = hubStairX(sa, 'e') - HUB_STAIR_AMP, xb = hubStairX(sb, 'e') - HUB_STAIR_AMP;
    const gy = galleryTop(g) + GALLERY_H - 6;
    const top = { x: xa, y: laneY(above) }, bottom = { x: xb, y: laneY(above + 1) };
    out.push({ gallery: g, fromFloor: above, toFloor: above + 1, side: 'e', top, bottom, run: [top, { x: xa, y: gy }, { x: xb, y: gy }, bottom] });
  });
  return out;
}

// --- Key -----------------------------------------------------------------------------------------------------------------------------

let graph: Graph | null = null;

function mixI(h: number, v: number): number {
  return Math.imul(h ^ (v | 0), 16777619) >>> 0;
}

function strHash(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = mixI(h, s.charCodeAt(i));
  return h;
}

/** A cheap fingerprint of everything the graph's shape depends on (no allocation: no floorExtent, no strings built). */
function navKey(state: GameState): number {
  let h = 2166136261 >>> 0;
  const n = state.currentFloors | 0;
  h = mixI(h, n);
  h = mixI(h, (GFX.airy ? 1 : 0) | (GFX.galleries ? 2 : 0));
  for (let s = 1; s <= 6; s++) {
    const F = frameOfStratum(s as StratumId);
    h = mixI(h, F.hubL * 8);
    h = mixI(h, F.hubR * 8);
    h = mixI(h, F.vestW * 8);
    h = mixI(h, F.vestE * 8);
  }
  const ext = state.layout?.ext as Record<string, { w: number; e: number }> | undefined;
  if (ext) for (let f = 0; f < n; f++) { const x = (ext as unknown as Record<number, { w: number; e: number } | undefined>)[f]; h = mixI(h, x ? x.w * 64 + x.e + 1 : 0); }
  const bs = state.buildings;
  h = mixI(h, bs.length);
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    h = mixI(h, b.position.floor * 4096 + b.position.x * 2 + (b.isConstructing ? 1 : 0));
    h = mixI(h, b.type.length * 131 + b.type.charCodeAt(0));
  }
  const rs = state.ruins ?? [];
  h = mixI(h, rs.length);
  for (let i = 0; i < rs.length; i++) h = mixI(h, rs[i].floor * 4096 + rs[i].x * 16 + (rs[i].w ?? 1));
  const inf = state.layout?.infra ?? [];
  h = mixI(h, inf.length);
  for (let i = 0; i < inf.length; i++) {
    const o = inf[i];
    h = mixI(h, o.floor * 4096 + o.x * 16 + (o.floors ?? 1));
    h = strHash(h, o.kind);
  }
  return h;
}

// --- Build ---------------------------------------------------------------------------------------------------------------------------

function stairCost(amp: number, flights: number, dy: number): number {
  return (flights * Math.hypot(amp * 2, Math.abs(dy) / Math.max(1, flights))) / STAIR_SPEED;
}

function build(state: GameState, key: number): Graph {
  const n = Math.max(0, state.currentFloors | 0);
  const X: number[] = [], Y: number[] = [], Fl: number[] = [], K: number[] = [], R: number[] = [];
  const eA: number[] = [], eB: number[] = [], eC: number[] = [], eK: number[] = [], eR: number[] = [];
  const colX: number[] = [], colAmp: number[] = [], colPer: number[] = [], colMode: number[] = [];
  const links: Link[] = [];
  const node = (f: number, x: number, y: number, k: number, ref: number): number => {
    X.push(x); Y.push(y); Fl.push(f); K.push(k); R.push(ref);
    return X.length - 1;
  };
  const edge = (a: number, b: number, c: number, k: number, ref: number): void => {
    eA.push(a); eB.push(b); eC.push(c); eK.push(k); eR.push(ref);
    eA.push(b); eB.push(a); eC.push(c); eK.push(k); eR.push(ref);
  };
  const col = (x: number, amp: number, per: number, mode: number): number => {
    colX.push(x); colAmp.push(amp); colPer.push(per); colMode.push(mode);
    return colX.length - 1;
  };
  /** A column standing on floors `on` (sorted): one stop per floor, linked where two consecutive floors see it at the same x. */
  const column = (xs: (f: number) => number, floorsOn: number[], amp: number, per: number, mode: number): void => {
    let prevNode = -1, prevF = -99, prevX = NaN;
    let c = -1;
    for (const f of floorsOn) {
      const cx = xs(f);
      if (c < 0 || Math.abs(cx - colX[c]) > 0.01) c = col(cx, amp, per, mode);
      const y = mode === COL_LANE ? laneY(f) : lineY(f);
      const v = node(f, cx - amp, y, K_STAIR, c);
      if (prevF === f - 1 && Math.abs(prevX - cx) < 0.01) {
        const fl = mode === COL_LANE ? per : 1;
        edge(prevNode, v, stairCost(amp, fl, y - Y[prevNode]), E_STAIRS, c);
      }
      prevNode = v; prevF = f; prevX = cx;
    }
  };

  // Lift landings and the shaft ladder.
  const landing = new Int32Array(Math.max(1, n)).fill(-1);
  for (let f = 0; f < n; f++) landing[f] = node(f, LANDING_X, laneY(f), K_LANDING, -1);
  const surface = node(-1, LADDER_X, lineY(-1), K_LADDER, -1);
  let prevLadder = surface;
  for (let f = 0; f < n; f++) {
    const v = node(f, LADDER_X, lineY(f), K_LADDER, -1);
    edge(prevLadder, v, (Math.abs(Y[v] - Y[prevLadder]) / LADDER_SPEED) * LADDER_PENALTY, E_LADDER, -1);
    prevLadder = v;
  }

  let layout: CityLayout | null = null;
  try { layout = source(state); } catch { layout = null; }

  // Hub stair columns (the layout's, else the nav's own formula for every stratum with two dug floors).
  if (layout && layout.hubs.length) {
    for (const hub of layout.hubs) {
      const on = hub.floors.filter(f => f >= 0 && f < n).sort((a, b) => a - b);
      for (const st of hub.stairs) column(() => st.x, on, HUB_STAIR_AMP, HUB_FLIGHTS_PER_FLOOR, COL_LANE);
    }
  } else {
    for (let s = 1; s <= 6; s++) {
      const on: number[] = [];
      for (let f = (s - 1) * 4; f < Math.min(n, s * 4); f++) on.push(f);
      if (on.length < 2) continue;
      for (const side of ['w', 'e'] as const) column(() => hubStairX(s, side), on, HUB_STAIR_AMP, HUB_FLIGHTS_PER_FLOOR, COL_LANE);
    }
  }

  // Void stair towers (airy): on a void boundary, on every floor reaching past it.
  if (GFX.airy && n > 0) {
    const grid = occupancy(state.buildings, state.ruins ?? [], n, extentsFor(state, n));
    for (const sl of voidBoundaries(grid)) {
      const on: number[] = [];
      for (let f = 0; f < n; f++) if ((grid.ext[f]?.e ?? 0) > sl) on.push(f);
      column(f => slotX(f, sl), on, TOWER_AMP, FLIGHTS_PER_FLOOR, COL_LANE);
    }
  }

  // Stairwells: built columns (infra) and evacuation rooms, one flight a storey.
  const wells = new Map<number, Set<number>>();
  const addWell = (slot: number, f: number): void => {
    if (f < 0 || f >= n) return;
    let s = wells.get(slot);
    if (!s) wells.set(slot, (s = new Set()));
    s.add(f);
  };
  for (const inf of state.layout?.infra ?? []) {
    if (inf.kind !== 'stairs' && inf.kind !== 'stairwell') continue;
    for (let f = inf.floor; f <= inf.floor + Math.max(1, inf.floors ?? 1) - 1; f++) addWell(inf.x, f);
  }
  for (const b of state.buildings) if (!b.isConstructing && getDef(b.type)?.effects?.evacuation) addWell(b.position.x, b.position.floor);
  const amp = SLOT_W * 0.32;
  for (const [slot, set] of [...wells.entries()].sort((a, b) => a[0] - b[0])) {
    column(f => slotX(f, slot) + SLOT_W / 2, [...set].sort((a, b) => a - b), amp, 1, COL_LINE);
  }

  // Gallery transfers (and any ramps given the same way).
  const given = (layout as (CityLayout & { transfers?: NavTransfer[] }) | null)?.transfers;
  const transfers = given ?? standInTransfers(n);
  for (const t of transfers) {
    if (t.fromFloor < 0 || t.toFloor < 0 || t.fromFloor >= n || t.toFloor >= n || t.fromFloor === t.toFloor) continue;
    const raw = [t.top, ...t.run, t.bottom];
    const pts: number[] = [];
    for (const p of raw) {
      const m = pts.length;
      if (m && Math.abs(pts[m - 2] - p.x) < 0.5 && Math.abs(pts[m - 1] - p.y) < 0.5) continue;
      pts.push(p.x, p.y);
    }
    if (pts.length < 4) continue;
    const id = links.length;
    const a = node(t.fromFloor, pts[0], pts[1], K_LINK, id), b = node(t.toFloor, pts[pts.length - 2], pts[pts.length - 1], K_LINK, id);
    const arr = new Float64Array(pts);
    const seconds = linkSeconds(arr);
    links.push({ from: a, to: b, pts: arr, seconds });
    edge(a, b, seconds, E_LINK, id);
  }

  // Pack.
  const N = X.length;
  const g: Graph = {
    key, floors: n, N,
    nx: new Float64Array(X), ny: new Float64Array(Y), nf: new Int16Array(Fl), nk: new Uint8Array(K), nref: new Int32Array(R),
    fStart: new Int32Array(n + 2), fNodes: new Int32Array(N), nPos: new Int32Array(N),
    aStart: new Int32Array(N + 1), aTo: new Int32Array(eA.length), aCost: new Float64Array(eA.length), aKind: new Uint8Array(eA.length), aRef: new Int32Array(eA.length),
    landing, surface,
    colX: new Float64Array(colX), colAmp: new Float64Array(colAmp), colPer: new Uint8Array(colPer), colMode: new Uint8Array(colMode),
    links,
    dist: new Float64Array(N + 2), prev: new Int32Array(N + 2), prevE: new Uint8Array(N + 2), prevRef: new Int32Array(N + 2), done: new Uint8Array(N + 2),
    heapK: new Float64Array(0), heapV: new Int32Array(0),
    path: new Int32Array(N + 2), pathE: new Uint8Array(N + 2), pathRef: new Int32Array(N + 2),
  };
  // Floors' sorted node lists.
  const byFloor: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let i = 0; i < N; i++) if (Fl[i] + 1 >= 0 && Fl[i] + 1 <= n) byFloor[Fl[i] + 1].push(i);
  let k = 0;
  for (let fi = 0; fi <= n; fi++) {
    g.fStart[fi] = k;
    byFloor[fi].sort((a, b) => X[a] - X[b] || a - b);
    for (let j = 0; j < byFloor[fi].length; j++) { g.fNodes[k] = byFloor[fi][j]; g.nPos[byFloor[fi][j]] = j; k++; }
  }
  g.fStart[n + 1] = k;
  // CSR of the vertical edges.
  const order = eA.map((_, i) => i).sort((a, b) => eA[a] - eA[b] || a - b);
  let e = 0;
  for (let i = 0; i < N; i++) {
    g.aStart[i] = e;
    while (e < order.length && eA[order[e]] === i) {
      const o = order[e];
      g.aTo[e] = eB[o]; g.aCost[e] = eC[o]; g.aKind[e] = eK[o]; g.aRef[e] = eR[o];
      e++;
    }
  }
  g.aStart[N] = e;
  // Heap capacity: every relaxation may push once (line 2 + target + lift n + vertical edges).
  const cap = (N + 2) * (n + 4) + eA.length + 8;
  g.heapK = new Float64Array(cap);
  g.heapV = new Int32Array(cap);
  return g;
}

/** Seconds to walk a link's points (the same split as emitLink). */
function linkSeconds(p: Float64Array): number {
  let s = 0;
  for (let i = 2; i < p.length; i += 2) {
    const dx = p[i] - p[i - 2], dy = p[i + 1] - p[i - 1];
    const seg = segShape(dx, dy);
    if (seg.kind === E_WALK) s += Math.hypot(dx, dy) / WALK_SPEED;
    else s += stairCost(seg.amp, seg.flights, dy);
  }
  return s;
}

const SEG = { kind: 0, amp: 0, flights: 0 };

/** How one segment of a link is walked (writes SEG): nearly flat = a walk; a slope = one straight flight; steeper = a zig-zag of flights. */
function segShape(dx: number, dy: number): typeof SEG {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ay <= ax * 0.15 + 0.5) { SEG.kind = E_WALK; SEG.amp = 0; SEG.flights = 0; return SEG; }
  SEG.kind = E_STAIRS;
  if (ax >= ay * 0.5) { SEG.amp = dx / 2; SEG.flights = 1; return SEG; }
  let k = Math.max(1, Math.round(ay / FLIGHT_RISE));
  if (ax > 0.5) {
    if ((k & 1) === 0) k++; // an odd count ends on the other side: the zig-zag spans exactly dx
    SEG.amp = dx / 2;
  } else {
    if (k & 1) k++; // straight down: an even count comes back to the same x
    SEG.amp = TOWER_AMP;
  }
  SEG.flights = k;
  return SEG;
}

// --- Query ---------------------------------------------------------------------------------------------------------------------------

let heapN = 0;

function heapPush(g: Graph, k: number, v: number): void {
  if (heapN >= g.heapK.length) return; // (cannot happen: the capacity bounds the relaxations)
  let i = heapN++;
  const K = g.heapK, V = g.heapV;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (K[p] <= k) break;
    K[i] = K[p]; V[i] = V[p];
    i = p;
  }
  K[i] = k; V[i] = v;
}

function heapPop(g: Graph): number {
  const K = g.heapK, V = g.heapV;
  const top = V[0];
  const k = K[--heapN], v = V[heapN];
  let i = 0;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= heapN) break;
    if (c + 1 < heapN && K[c + 1] < K[c]) c++;
    if (K[c] >= k) break;
    K[i] = K[c]; V[i] = V[c];
    i = c;
  }
  K[i] = k; V[i] = v;
  return top;
}

/** Index range of the floor's nodes around x: writes NB.l (last node left of x, or -1) and NB.r (first node at or right of x, or -1). */
const NB = { l: -1, r: -1 };
function neighbours(g: Graph, floor: number, x: number): void {
  NB.l = NB.r = -1;
  const fi = floor + 1;
  if (fi < 0 || fi > g.floors) return;
  for (let j = g.fStart[fi]; j < g.fStart[fi + 1]; j++) {
    const v = g.fNodes[j];
    if (g.nx[v] < x) NB.l = v;
    else { NB.r = v; return; }
  }
}

let sx = 0, sy = 0, tx = 0, ty = 0, sF = 0, tF = 0;
let lT = -1, rT = -1;

function px(g: Graph, u: number): number { return u === g.N ? sx : u === g.N + 1 ? tx : g.nx[u]; }
function py(g: Graph, u: number): number { return u === g.N ? sy : u === g.N + 1 ? ty : g.ny[u]; }

function relax(g: Graph, u: number, v: number, c: number, e: number, ref: number): void {
  const d = g.dist[u] + c;
  if (d < g.dist[v]) {
    g.dist[v] = d;
    g.prev[v] = u;
    g.prevE[v] = e;
    g.prevRef[v] = ref;
    heapPush(g, d, v);
  }
}

function relaxWalk(g: Graph, u: number, v: number, floor: number): void {
  if (v < 0 || g.done[v]) return;
  const x0 = px(g, u), x1 = px(g, v);
  if (walkBlocked(floor, x0, x1)) return;
  relax(g, u, v, (Math.abs(x1 - x0) + Math.abs(py(g, v) - py(g, u))) / WALK_SPEED, E_WALK, -1);
}

/** Dijkstra from S to T; true when T was reached. */
function search(g: Graph, liftOn: boolean, liftCost: number, stairMul: number): boolean {
  const S = g.N, T = g.N + 1;
  g.dist.fill(Infinity);
  g.done.fill(0);
  heapN = 0;
  g.dist[S] = 0;
  heapPush(g, 0, S);
  neighbours(g, tF, tx);
  lT = NB.l; rT = NB.r;
  while (heapN > 0) {
    const u = heapPop(g);
    if (g.done[u]) continue;
    g.done[u] = 1;
    if (u === T) return true;
    if (u === S) {
      neighbours(g, sF, sx);
      const l = NB.l, r = NB.r;
      relaxWalk(g, S, l, sF);
      relaxWalk(g, S, r, sF);
      continue;
    }
    const f = g.nf[u], fi = f + 1, p = g.nPos[u];
    if (p > 0) relaxWalk(g, u, g.fNodes[g.fStart[fi] + p - 1], f);
    if (g.fStart[fi] + p + 1 < g.fStart[fi + 1]) relaxWalk(g, u, g.fNodes[g.fStart[fi] + p + 1], f);
    if (f === tF && (u === lT || u === rT)) relaxWalk(g, u, T, f);
    if (liftOn && g.nk[u] === K_LANDING) {
      for (let h = 0; h < g.floors; h++) {
        const v = g.landing[h];
        if (v !== u && !g.done[v]) relax(g, u, v, liftCost, E_LIFT, -1);
      }
    }
    for (let e = g.aStart[u]; e < g.aStart[u + 1]; e++) {
      const v = g.aTo[e];
      if (!g.done[v]) relax(g, u, v, g.aKind[e] === E_LADDER ? g.aCost[e] : g.aCost[e] * stairMul, g.aKind[e], g.aRef[e]);
    }
  }
  return false;
}

/** Last-plan diagnostics for tests and the dev probe (no allocation). */
export const NAV_STATS = { builds: 0, queries: 0, lastNodes: 0, lastLinksUsed: 0 };

let failed = false;

function put(r: Route, kind: number, floor: number, x: number, y: number): number {
  if (r.n >= MAX_WP) { failed = true; return r.n - 1; }
  pushWaypoint(r, kind, floor, x, y);
  return r.n - 1;
}

function walk(r: Route, x: number, y?: number): boolean {
  if (r.n + 3 > MAX_WP) { failed = true; return false; }
  return walkTo(r, x, y);
}

/** Emits a link's points as walk and stair legs (forward from `from`, or backward). */
function emitLink(g: Graph, r: Route, id: number, forward: boolean, endFloor: number): void {
  const L = g.links[id], p = L.pts, m = p.length / 2;
  const startFloor = r.floor[r.n - 1];
  for (let j = 1; j < m; j++) {
    const a = forward ? j - 1 : m - j, b = forward ? j : m - 1 - j;
    const x0 = p[2 * a], y0 = p[2 * a + 1], x1 = p[2 * b], y1 = p[2 * b + 1];
    const dx = x1 - x0, dy = y1 - y0;
    const seg = segShape(dx, dy);
    const fl = j === m - 1 ? endFloor : startFloor;
    if (seg.kind === E_WALK) {
      put(r, LEG_WALK, fl, x1, y1);
      r.seconds += Math.hypot(dx, dy) / WALK_SPEED;
    } else {
      const k = put(r, LEG_STAIRS, fl, x1, y1);
      r.amp[k] = seg.amp;
      r.flights[k] = seg.flights;
      r.seconds += stairCost(seg.amp, seg.flights, dy);
    }
  }
}

/** Turns the found node path into waypoints. False when a closed door or the waypoint budget got in the way. */
function emit(g: Graph, r: Route, to: Stop, groundY: number): boolean {
  const S = g.N, T = g.N + 1;
  // Reverse the prev chain into path[0..m).
  let m = 0;
  for (let v = T; v !== S; v = g.prev[v]) m++;
  let i = m;
  for (let v = T; v !== S; v = g.prev[v]) {
    i--;
    g.path[i] = v;
    g.pathE[i] = g.prevE[v];
    g.pathRef[i] = g.prevRef[v];
  }
  let links = 0;
  for (let j = 0; j < m && !failed; j++) {
    const v = g.path[j], e = g.pathE[j];
    if (e === E_WALK) {
      if (v === T) { if (!walk(r, to.x)) return false; }
      else if (!walk(r, g.nx[v], g.ny[v])) return false;
      continue;
    }
    if (e === E_LIFT) {
      put(r, LEG_LIFT, g.nf[v], LANDING_X, g.ny[v]);
      r.seconds += LIFT_EST_S;
      continue;
    }
    if (e === E_LINK) {
      const L = g.links[g.pathRef[j]];
      emitLink(g, r, g.pathRef[j], L.to === v, g.nf[v]);
      links++;
      continue;
    }
    // Stairs or ladder: merge the run of the same column.
    let end = j;
    while (end + 1 < m && g.pathE[end + 1] === e && g.pathRef[end + 1] === g.pathRef[j]) end++;
    const w = g.path[end];
    const fa = r.floor[r.n - 1], fb = g.nf[w], nFl = Math.abs(fb - fa);
    if (e === E_LADDER) {
      const y = fb < 0 ? groundY : g.ny[w];
      const y0 = r.y[r.n - 1];
      put(r, LEG_LADDER, fb, LADDER_X, y);
      r.seconds += Math.abs(y - y0) / LADDER_SPEED;
    } else {
      const c = g.pathRef[j], amp = g.colAmp[c], y0 = r.y[r.n - 1];
      if (g.colMode[c] === COL_LANE) {
        const fl = g.colPer[c] * nFl;
        const k = put(r, LEG_STAIRS, fb, g.nx[w], g.ny[w]);
        r.amp[k] = amp;
        r.flights[k] = fl;
        r.seconds += stairCost(amp, fl, g.ny[w] - y0);
      } else {
        const cx = g.colX[c];
        const k = put(r, LEG_STAIRS, fb, cx + (nFl & 1 ? amp : -amp), g.ny[w]);
        r.amp[k] = amp;
        r.flights[k] = nFl;
        r.seconds += stairCost(amp, nFl, g.ny[w] - y0);
      }
    }
    j = end;
  }
  NAV_STATS.lastLinksUsed = links;
  return !failed;
}

/** The graph for this state (rebuilt when the layout key moves). */
export function navGraph(state: GameState): Graph {
  const key = navKey(state);
  if (!graph || graph.key !== key) {
    graph = build(state, key);
    NAV_STATS.builds++;
  }
  return graph;
}

/** Drops the cached graph (tests switching frames or flags that the key does not see). */
export function resetNavGraph(): void {
  graph = null;
}

/**
 * Plans a city trip into `out` (routes.ts `route()` calls this first in the city projection). Returns the route, null when there is no way
 * (closed doors) or the trip would be too long to draw, or undefined when the graph does not cover the trip (a floor not dug yet: the dig
 * crew's pit, ...), in which case the caller plans it the old way.
 */
export function planCityRoute(state: GameState, from: Stop, to: Stop, liftOk: boolean, rnd: number, out: Route): Route | null | undefined {
  if (PROJECTION !== 'city') return undefined;
  const n = state.currentFloors | 0;
  if (n < 1 || from.floor < -1 || to.floor < -1 || from.floor >= n || to.floor >= n) return undefined;
  NAV_STATS.queries++;
  out.n = 0;
  out.seconds = 0;
  pushWaypoint(out, LEG_WALK, from.floor, from.x, from.y);
  // Same floor and nothing in the way: the straight walk (as before).
  if (from.floor === to.floor && !walkBlocked(from.floor, from.x, to.x)) {
    if (!walkTo(out, to.x)) return null;
    out.y[out.n - 1] = to.y;
    return out.seconds <= CITY_MAX_TRIP_S ? out : null;
  }
  const g = navGraph(state);
  NAV_STATS.lastNodes = g.N;
  const groundY = from.floor < 0 ? from.y : to.floor < 0 ? to.y : -8;
  g.ny[g.surface] = groundY;
  sx = from.x; sy = from.y; sF = from.floor;
  tx = to.x; ty = to.y; tF = to.floor;
  const liftOn = liftOk && n >= 2;
  const shy = rnd < CITY_HUB_STAIR_SHARE;
  for (let pass = 0; pass < 2; pass++) {
    const cost = LIFT_EST_S + (shy && pass === 0 ? LIFT_SHY_S : 0);
    if (!search(g, liftOn, cost, shy || !liftOn ? 1 : STAIR_EFFORT)) return null;
    out.n = 1;
    out.seconds = 0;
    failed = false;
    if (emit(g, out, to, groundY)) {
      out.y[out.n - 1] = to.y;
      if (out.seconds <= CITY_MAX_TRIP_S) return out;
    }
    if (!(shy && liftOn)) break; // only a lift-shy plan has a faster one to fall back on
  }
  return null;
}

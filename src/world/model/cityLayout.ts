/**
 * [world:C1] The city layout (architecture C sections 1.3-1.5): the pure description of "The City Below" that the renderer draws.
 *
 * From the game state alone (no Pixi, Node-safe, deterministic) it derives:
 *  - hubs     one atrium per reached stratum around the spine: the vault outline, a balcony per storey on each side (on the corridor
 *             lane), one stair column per side and the bridge across the spine;
 *  - cavities the holes cut into the rock: hub, vestibules, the floor strips (with an organic ragged cut), service galleries, the blocked
 *             tunnels at the floor ends (edges), the dig face, district caverns with their tunnel, pockets;
 *  - areas    the fog areas with their derived state (surface, storeys, galleries, edges, districts, pockets), see `src/core/state/city.ts`;
 *  - edges    the edge sites (a floor's open end) with why they are blocked (data/wings.ts wingBlock) and the dig progress;
 *  - bounds, strata bands and the frames.
 * The result satisfies `src/world/render/layoutTypes.ts` exactly. `cityLayoutSig` changes only when the GEOMETRY or an area's kind of
 * state changes; dig progress goes through `cityProgress` (cheap, per frame) into CityRenderer.setAreaState / ShellParts.setProgress.
 */
import { BASE_EAST, floorExtent, type GameState } from '../../core/GameState';
import { revealedAreaIds } from '../../core/state/city';
import { DISTRICT_SLOTS, isDistrict } from '../../data/buildingDefs';
import { availableDistricts } from '../../data/districts';
import { allPockets, pocketStratum, stratumOf, strataReached, STRATA as STRATA_DATA, type PocketDef, type StratumId } from '../../data/strata';
import { digAt, wingBlock } from '../../data/wings';
import { GALLERY_ABOVE_FLOORS, MAX_FLOORS } from '../../data/zones';
import { GFX } from '../../rendering/gfxFeatures';
import { CORR_LANE, GALLERY_H, ROOM_H, SHAFT_W, SLAB, SLOT_W, floorTop, galleryTop } from '../../rendering/geom';
import { PROJECTION, frameOfStratum, roomsEastX, roomsWestX, slotX } from '../project';
import { CITY } from '../tokens';
import type { AreaState, CityArea, CityLayout, Cavity, EdgeSite, HubGeom } from '../render/layoutTypes';
import { archPoints, blobPoly, polyBounds, q8, raggedPoly, rectPoly, seedOf } from './outline';

export type { CityLayout, CityArea, Cavity, EdgeSite, HubGeom, AreaState };

type Side = 'w' | 'e';
type Block = EdgeSite['block'];

const L = CITY.layout;
const H = CITY.hub;

/** The corridor lane of a floor (routes.ts laneY): where people walk between rooms, and where balconies and edge floors sit. */
export function laneY(floor: number): number {
  return floorTop(floor) + ROOM_H + CORR_LANE;
}

/** The floor line (the room's floor) of a storey. */
export function floorLineY(floor: number): number {
  return floorTop(floor) + ROOM_H;
}

/** The bottom of a storey's band: the slab under it (a gallery under it is not included). */
export function storeyBottom(floor: number): number {
  return floorTop(floor) + ROOM_H + SLAB;
}

/** The y where stratum s meets s + 1 (the middle of the gallery band between them; the band's top when galleries are off). */
export function stratumSeamY(s: number): number {
  if (s <= 0) return 0;
  const lastFloor = 4 * s - 1;
  return (storeyBottom(lastFloor) + floorTop(lastFloor + 1)) / 2;
}

/** First and last logical floor of an underground stratum. */
function stratumFloors(s: StratumId): [number, number] {
  const d = STRATA_DATA[s].floors;
  return [d[0], d[1]];
}

/** Where a floor's strip reaches on the west (the west wing's outer edge, or the end of the west vestibule) and on the east. */
function stripEnds(floor: number, ext: { w: number; e: number }): { xw: number; xe: number } {
  const F = frameOfStratum(stratumOf(floor));
  return { xw: ext.w > 0 ? slotX(floor, -ext.w) : F.hubL - F.vestW, xe: slotX(floor, ext.e) };
}

interface DistrictSite { kind: string; floor: number; x: number; state: AreaState; progress: number }

/** Every district the city shows: built (revealed), being dug (digging) or on offer (glimpsed, at the floor's end). */
function districtSites(state: GameState): DistrictSite[] {
  const out: DistrictSite[] = [];
  for (const b of state.buildings) {
    if (!isDistrict(b.type)) continue;
    const progress = b.isConstructing ? Math.max(0, Math.min(1, b.constructionProgress / Math.max(1, b.constructionTotal))) : 1;
    out.push({ kind: b.type, floor: b.position.floor, x: b.position.x, state: b.isConstructing ? 'digging' : 'revealed', progress });
  }
  for (const d of availableDistricts(state)) {
    if (out.some(o => o.floor === d.floor)) continue;
    out.push({ kind: d.kind, floor: d.floor, x: floorExtent(state, d.floor).e, state: 'glimpsed', progress: 0 });
  }
  return out.sort((a, b) => a.floor - b.floor || (a.kind < b.kind ? -1 : 1));
}

/** The district room's rect on its floor (the painted cavern room sits here; the cut cavern is larger). */
function districtRect(site: DistrictSite): { x0: number; y0: number; x1: number; y1: number } {
  const F = frameOfStratum(stratumOf(site.floor));
  const x0 = slotX(site.floor, site.x) + F.tunnel;
  return { x0, y0: floorTop(site.floor), x1: x0 + DISTRICT_SLOTS * SLOT_W, y1: floorTop(site.floor) + ROOM_H };
}

/** The x where a floor's east dark edge opens: the end of the strip, or past the district cavern on that floor. */
function eastMouth(floor: number, xe: number, district: DistrictSite | undefined): number {
  if (!district) return xe;
  return districtRect(district).x1 + L.cavernPad;
}

/** A running dig on an edge or the floor below, if any. */
function digOf(state: GameState, match: (d: NonNullable<ReturnType<typeof digAt>>) => boolean): { progress: number } | null {
  for (let i = 0; i < 2; i++) {
    const d = digAt(state, i);
    if (d && d.floor != null && match(d)) return { progress: Math.max(0, Math.min(1, d.progress / Math.max(1e-6, d.total))) };
  }
  return null;
}

/** Why an edge cannot be dug, in the four looks the city has (act / stability / district), 'digging', or 'ready' (open: cost, busy, ok). */
export function edgeBlock(state: GameState, floor: number, side: Side): Block {
  if (digOf(state, d => d.kind === 'wing' && d.floor === floor && d.side === side)) return 'digging';
  const b = wingBlock(state, floor, side);
  return b === 'act' || b === 'stability' || b === 'district' ? b : 'ready';
}

/** How many floors get storey areas: the dug ones, the dig face, and the rest of the stratum ahead (hidden) plus L.strataAhead strata. */
function shownFloors(n: number): number {
  const s = stratumOf(Math.min(MAX_FLOORS - 1, n));
  const last = Math.min(6, s + L.strataAhead) as StratumId;
  return Math.min(MAX_FLOORS, stratumFloors(last)[1] + 1);
}

/** The geometry signature: changes when anything the layout's SHAPES or area KINDS depend on changes (not with dig progress). */
export function cityLayoutSig(state: GameState): string {
  const n = Math.max(0, state.currentFloors | 0);
  let s = `${PROJECTION}|${GFX.galleries ? 'g' : ''}|${n}|`;
  for (let f = 0; f < n; f++) {
    const x = floorExtent(state, f);
    s += `${x.w},${x.e}${edgeBlock(state, f, 'w')[0]}${edgeBlock(state, f, 'e')[0]};`;
  }
  for (const d of districtSites(state)) s += `|${d.kind}@${d.floor}.${d.x}${d.state[0]}`;
  s += `|dig${digOf(state, d => d.kind !== 'wing') ? 1 : 0}`;
  for (const id of state.city?.found ?? []) s += `|${id}`;
  return s;
}

/** Areas whose state moves continuously (digs, district construction): feed these to CityRenderer.setAreaState / ShellParts.setProgress. */
export function cityProgress(state: GameState): { id: string; state: AreaState; progress: number }[] {
  const out: { id: string; state: AreaState; progress: number }[] = [];
  const n = state.currentFloors | 0;
  const fd = digOf(state, d => d.kind !== 'wing');
  if (fd) out.push({ id: `f:${n}`, state: 'digging', progress: fd.progress });
  for (let i = 0; i < 2; i++) {
    const d = digAt(state, i);
    if (d && d.floor != null && d.kind === 'wing' && (d.side === 'w' || d.side === 'e')) {
      out.push({ id: `e:${d.floor}:${d.side}`, state: 'digging', progress: Math.max(0, Math.min(1, d.progress / Math.max(1e-6, d.total))) });
    }
  }
  for (const s of districtSites(state)) if (s.state === 'digging') out.push({ id: `d:${s.kind}`, state: 'digging', progress: s.progress });
  return out;
}

/** The pocket's box in world units. */
export function pocketBox(p: PocketDef): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = slotX(p.anchorFloor, p.dxSlots);
  const y0 = p.side === 'below' ? galleryTop(Math.floor((p.anchorFloor - 3) / 4)) + p.dy : floorTop(p.anchorFloor) + p.dy;
  return { x0, y0, x1: x0 + p.w * SLOT_W, y1: y0 + p.h };
}

/** The vault (ceiling) polyline of a hub: a segmental arch from the west wall to the east wall over the stratum's top floor. */
function vaultLine(hubL: number, hubR: number, y: number): number[] {
  return archPoints(hubL, hubR, y, H.vaultRise, 16);
}

export function buildCityLayout(state: GameState): CityLayout {
  const n = Math.max(0, state.currentFloors | 0);
  const exts = Array.from({ length: n }, (_, f) => floorExtent(state, f));
  const extOf = (f: number) => (f < n ? exts[f] : { w: 0, e: BASE_EAST });
  const revealed = new Set(revealedAreaIds(state));
  const reached = strataReached(n);
  const hubs: HubGeom[] = [];
  const cavities: Cavity[] = [];
  const areas: CityArea[] = [];
  const edges: EdgeSite[] = [];
  const districts = districtSites(state);
  const districtOn = (f: number) => districts.find(d => d.floor === f);
  const shown = shownFloors(n);
  const floorDig = digOf(state, d => d.kind !== 'wing');

  // ------------------------------------------------------------------------------------------------------------------- hubs
  for (const s of reached) {
    if (s === 0) continue;
    const [fa, fz] = stratumFloors(s);
    const floors: number[] = [];
    for (let f = fa; f <= Math.min(fz, n - 1); f++) floors.push(f);
    if (!floors.length) continue;
    const F = frameOfStratum(s);
    const top = floorTop(fa), bottom = storeyBottom(floors[floors.length - 1]);
    const vault = q8(vaultLine(F.hubL, F.hubR, top));
    const balconies: HubGeom['balconies'] = [];
    for (const f of floors) {
      balconies.push({ floor: f, side: 'w', x0: F.hubL + H.wallW, x1: 0, y: laneY(f) });
      balconies.push({ floor: f, side: 'e', x0: SHAFT_W, x1: F.hubR - H.wallW, y: laneY(f) });
    }
    const stairs: HubGeom['stairs'] = [];
    if (floors.length > 1) {
      const half = H.stairW / 2;
      stairs.push({ side: 'w', x: F.hubL + H.wallW + H.stairInset + half, top: laneY(floors[0]), bottom: laneY(floors[floors.length - 1]) });
      stairs.push({ side: 'e', x: F.hubR - H.wallW - H.stairInset - half, top: laneY(floors[0]), bottom: laneY(floors[floors.length - 1]) });
    }
    const hub: HubGeom = { s, floors, rect: { x: F.hubL, y: top - H.vaultRise, w: F.hubR - F.hubL, h: bottom - (top - H.vaultRise) }, vault, balconies, stairs };
    const bf = fa + H.bridgeFloor;
    if (H.bridgeFloor >= 0 && floors.includes(bf) && floors.length > 1) hub.bridge = { floor: bf, x0: -6, x1: SHAFT_W + 6, y: laneY(bf) };
    hubs.push(hub);
    // The hub cavity: up the west wall, along the vault, down the east wall, back along the plaza floor (clockwise, y down).
    cavities.push({ id: `c:hub:${s}`, s, back: 'hub', poly: q8([F.hubL, bottom, ...vault, F.hubR, bottom]) });
    // The vestibules of every dug floor of the stratum: tiled corridors between the hub and the rooms.
    for (const f of floors) {
      cavities.push({ id: `c:vest:${f}:w`, s, back: 'tile', poly: rectPoly(F.hubL - F.vestW, floorTop(f), F.hubL, storeyBottom(f)) });
      cavities.push({ id: `c:vest:${f}:e`, s, back: 'tile', poly: rectPoly(F.hubR, floorTop(f), F.hubR + F.vestE, storeyBottom(f)) });
    }
  }

  // ------------------------------------------------------------------------------------------------------------------- floor strips
  for (let f = 0; f < n; f++) {
    const s = stratumOf(f), ext = exts[f];
    const y0 = floorTop(f) - L.stripHead, y1 = storeyBottom(f);
    const seed = seedOf(`strip:${f}`);
    // East strip: ragged top and ragged far end (corners: TL, TR, BR, BL -> sides top, east, bottom, west).
    cavities.push({ id: `c:strip:${f}:e`, s, back: 'concrete', poly: q8(raggedPoly(rectPoly(roomsEastX(f), y0, slotX(f, ext.e), y1), [L.stripRag, L.stripRag, 0, 0], seed, L.stripWave)) });
    if (ext.w > 0) cavities.push({ id: `c:strip:${f}:w`, s, back: 'concrete', poly: q8(raggedPoly(rectPoly(slotX(f, -ext.w), y0, roomsWestX(f), y1), [L.stripRag, 0, 0, L.stripRag], seed + 1, L.stripWave)) });
  }

  // ------------------------------------------------------------------------------------------------------------------- galleries
  if (GFX.galleries) {
    GALLERY_ABOVE_FLOORS.forEach((above, g) => {
      if (above >= shown) return;
      let xw = Infinity, xe = -Infinity;
      for (let f = above - 3; f <= above; f++) {
        const e = stripEnds(f, extOf(f));
        xw = Math.min(xw, e.xw);
        xe = Math.max(xe, e.xe);
      }
      const y0 = galleryTop(g), y1 = y0 + GALLERY_H;
      const s = stratumOf(above);
      const dug = revealed.has(`g:${g}`);
      areas.push({ id: `g:${g}`, kind: 'gallery', s, state: dug ? 'revealed' : 'hidden', poly: rectPoly(xw, y0, xe, y1) });
      if (dug) cavities.push({ id: `c:gal:${g}`, s, back: 'concrete', poly: rectPoly(xw, y0, xe, y1) });
    });
  }

  // ------------------------------------------------------------------------------------------------------------------- storey areas
  for (let f = 0; f < shown; f++) {
    const s = stratumOf(f), F = frameOfStratum(s);
    const { xw, xe } = stripEnds(f, extOf(f));
    const y0 = floorTop(f);
    const y1 = GFX.galleries && GALLERY_ABOVE_FLOORS.includes(f) ? galleryTop(GALLERY_ABOVE_FLOORS.indexOf(f)) : floorTop(f + 1);
    let st: AreaState = 'hidden';
    let progress: number | undefined;
    if (revealed.has(`f:${f}`)) st = 'revealed';
    else if (f === n) {
      st = floorDig ? 'digging' : 'glimpsed';
      if (floorDig) progress = floorDig.progress;
    }
    const topOfHub = f < n && f === stratumFloors(s)[0] && hubs.some(h => h.s === s);
    const poly = topOfHub
      ? [xw, y0, ...vaultLine(F.hubL, F.hubR, y0), xe, y0, xe, y1, xw, y1]
      : rectPoly(xw, y0, xe, y1);
    areas.push({ id: `f:${f}`, kind: 'storey', s, state: st, ...(progress !== undefined ? { progress } : {}), poly: q8(poly), label: { x: (xw + xe) / 2, y: y0 + ROOM_H / 2, key: `f:${f}` } });
  }

  // ------------------------------------------------------------------------------------------------------------------- the dig face
  if (n < MAX_FLOORS) {
    const s = stratumOf(n), F = frameOfStratum(s);
    const x0 = F.hubL + H.wallW, x1 = roomsEastX(n) + L.digSlots * SLOT_W;
    const y0 = floorTop(n) + 4, y1 = storeyBottom(n) - SLAB * 0.4;
    // A rough pit: ragged ceiling and far end; it is mostly rubble until the dig clears it (digFront renderer).
    cavities.push({ id: `c:dig:${n}`, s, back: 'rock', poly: q8(raggedPoly(rectPoly(x0, y0, x1, y1), [L.digRag, L.digRag, 0, L.digRag], seedOf(`dig:${n}`), 22)) });
  }

  // ------------------------------------------------------------------------------------------------------------------- districts
  for (const d of districts) {
    const s = stratumOf(d.floor);
    const r = districtRect(d);
    const xe = slotX(d.floor, extOf(d.floor).e);
    const seed = seedOf(`d:${d.kind}`);
    const cave = blobPoly(r.x0 - L.cavernPad, r.y0 - L.cavernRise, r.x1 + L.cavernPad, storeyBottom(d.floor), seed, L.cavernLumps, 26, true);
    const tunnel = rectPoly(xe - 4, floorTop(d.floor) + 30, r.x0 - L.cavernPad + 20, storeyBottom(d.floor) - SLAB * 0.3);
    if (d.state !== 'hidden') {
      cavities.push({ id: `c:tun:${d.kind}`, s, back: 'rock', poly: q8(tunnel) });
      cavities.push({ id: `c:dist:${d.kind}`, s, back: d.state === 'glimpsed' ? 'rock' : 'none', poly: q8(cave) });
    }
    areas.push({
      id: `d:${d.kind}`, kind: 'district', s, state: d.state, ...(d.state === 'digging' ? { progress: d.progress } : {}), poly: q8(cave.slice()),
      label: { x: (r.x0 + r.x1) / 2, y: r.y0 - 20, key: `d:${d.kind}` },
    });
  }

  // ------------------------------------------------------------------------------------------------------------------- edges
  for (let f = 0; f < n; f++) {
    const s = stratumOf(f);
    const { xw, xe } = stripEnds(f, exts[f]);
    for (const side of ['w', 'e'] as const) {
      const id = `e:${f}:${side}`;
      const block = edgeBlock(state, f, side);
      const mouth = side === 'e' ? eastMouth(f, xe, districtOn(f)) : xw;
      const dir = side === 'e' ? 1 : -1;
      const far = mouth + dir * L.edgeLen;
      const yTop = floorTop(f) + L.edgeTop, yBot = laneY(f) + 6;
      const xa = Math.min(mouth, far), xb = Math.max(mouth, far);
      // The tunnel: ragged ceiling, ragged far end (the far end is the one away from the mouth).
      const amps = side === 'e' ? [L.edgeRag, L.edgeRag, 0, 0] : [L.edgeRag, 0, 0, L.edgeRag];
      const lead = side === 'e' ? -6 : 6; // overlaps the strip a little so the cut joins it
      cavities.push({ id: `c:edge:${f}:${side}`, s, back: 'rock', poly: q8(raggedPoly(rectPoly(xa + (side === 'e' ? lead : 0), yTop, xb + (side === 'w' ? lead : 0), yBot), amps, seedOf(id), 20)) });
      const wd = block === 'digging' ? digOf(state, d => d.kind === 'wing' && d.floor === f && d.side === side) : null;
      const progress = wd?.progress ?? 0;
      edges.push({ id, floor: f, side, x: mouth + dir * L.edgeLen * L.edgeChoke, y: floorLineY(f), block, progress });
      const pad = 14;
      areas.push({
        id, kind: 'edge', s, state: block === 'digging' ? 'digging' : 'glimpsed', ...(block === 'digging' ? { progress } : {}),
        poly: q8(rectPoly(xa - (side === 'w' ? pad : 0), floorTop(f) - pad, xb + (side === 'e' ? pad : 0), storeyBottom(f))),
        label: { x: mouth + dir * L.edgeLen * 0.5, y: floorTop(f) + ROOM_H * 0.4, key: id },
      });
    }
  }

  // ------------------------------------------------------------------------------------------------------------------- pockets
  const maxS = reached[reached.length - 1] ?? 0;
  const found = new Set(state.city?.found ?? []);
  for (const p of allPockets()) {
    const s = pocketStratum(p.id);
    if (s === null || s > Math.min(6, maxS + L.strataAhead)) continue;
    const b = pocketBox(p);
    const poly = q8(blobPoly(b.x0, b.y0, b.x1, b.y1, seedOf(p.id), L.pocketLumps, 20, true));
    const st: AreaState = found.has(p.id) ? 'revealed' : reached.includes(s) ? 'glimpsed' : 'hidden';
    areas.push({ id: p.id, kind: 'pocket', s, state: st, poly, label: { x: (b.x0 + b.x1) / 2, y: b.y0 - 12, key: p.id } });
    cavities.push({ id: `c:${p.id}`, s, back: 'rock', poly: poly.slice() });
  }

  // ------------------------------------------------------------------------------------------------------------------- bounds, strata
  let x0 = Infinity, x1 = -Infinity, y1 = 0;
  for (const a of areas) {
    const b = polyBounds(a.poly);
    x0 = Math.min(x0, b.x0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  if (!isFinite(x0)) { x0 = -200; x1 = 600; }
  const P = L.boundsPad;
  const bounds = { x: Math.floor(x0 - P.x), y: -P.top, w: Math.ceil(x1 - x0 + 2 * P.x), h: Math.ceil(y1 + P.bottom + P.top) };
  areas.unshift({ id: 'surface', kind: 'surface', s: 0, state: 'revealed', poly: rectPoly(bounds.x, bounds.y, bounds.x + bounds.w, 0) });
  const strata: CityLayout['strata'] = [];
  for (let s = 0; s <= 6; s++) {
    const y0 = s === 0 ? bounds.y : stratumSeamY(s - 1);
    const yb = s === 6 ? bounds.y + bounds.h : stratumSeamY(s);
    strata.push({ s: s as StratumId, y0: s === 1 ? 0 : y0, y1: s === 0 ? 0 : Math.max(yb, y0 + 1) });
  }

  return {
    sig: cityLayoutSig(state),
    frames: [0, 1, 2, 3, 4, 5, 6].map(s => ({ ...frameOfStratum(s as StratumId) })),
    hubs, cavities, areas, edges, bounds, strata,
  };
}

/** The edge sites as WingSigns-style tap targets: the open end of a floor on one side. */
export function edgeAt(layout: CityLayout, floor: number, side: Side): EdgeSite | undefined {
  return layout.edges.find(e => e.floor === floor && e.side === side);
}


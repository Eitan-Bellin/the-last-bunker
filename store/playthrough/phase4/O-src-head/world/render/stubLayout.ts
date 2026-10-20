/**
 * The stub city layout (phase C1, tech-artist): a plain CityLayout derived from the game state so the city renderer runs end to end
 * before the level-builder's `buildCityLayout` (src/world/model/cityLayout.ts) is merged. It is replaced through `setCityLayoutProvider`
 * (citySeams.ts) and has no art direction of its own:
 *  - strata bands: the ground line at y 0, each stratum down to the middle of the gap under its last floor (the gallery band);
 *  - one hub per stratum reached: `hubRect(s)` clipped to the dug floors, a flat vault, no balconies or stairs (the shell's job);
 *  - areas: `surface`; one `f:<floor>` storey strip per dug floor (hub + both wings + any district on it), revealed; built districts
 *    `d:<kind>` (digging while under construction); the dig face `f:<currentFloors>` glimpsed; an `e:<floor>:<side>` edge strip past
 *    each end of each dug floor, glimpsed; the rock below the dig face `s:<next>` hidden;
 *  - edges: one 'ready' EdgeSite per edge strip;
 *  - no cavities (the shell cuts them).
 * Pure apart from the projection (`project.ts`), which follows `?city`. Node-safe.
 */
import type { GameState } from '../../core/GameState';
import { isDistrict } from '../../data/buildingDefs';
import { FLOORS_PER_STRATUM, LAST_STRATUM, stratumOf, strataReached, type StratumId } from '../../data/strata';
import { FLOOR_H, ROOM_H, SLOT_W, extentsFor, floorTop } from '../../rendering/geom';
import { buildingRect, eastmostSlotX, frameOfStratum, hubRect, stripX, westmostSlotX } from '../project';
import { CITY } from '../tokens';
import type { CityArea, CityLayout, EdgeSite, HubGeom, StratumFrame } from './layoutTypes';

/** How far an edge strip reaches past a floor's end, and the margins of the layout's bounds (world units). */
const EDGE_SLOTS = 3;
const SKY = 1600;
const SIDE = 900;
const BELOW = 2 * FLOOR_H;
const MAX_FLOOR = FLOORS_PER_STRATUM * LAST_STRATUM - 1;

const rect = (x0: number, y0: number, x1: number, y1: number): number[] => [x0, y0, x1, y0, x1, y1, x0, y1];

/** The y between stratum s and s + 1: the middle of the gap under the stratum's last floor (its gallery band when galleries are on). */
function strataSeam(s: number): number {
  const last = s * FLOORS_PER_STRATUM - 1;
  return (floorTop(last) + ROOM_H + floorTop(last + 1)) / 2;
}

function strataBands(): { s: StratumId; y0: number; y1: number }[] {
  const out: { s: StratumId; y0: number; y1: number }[] = [{ s: 0, y0: -SKY, y1: 0 }];
  for (let s = 1; s <= LAST_STRATUM; s++) {
    out.push({ s: s as StratumId, y0: s === 1 ? 0 : strataSeam(s - 1), y1: s === LAST_STRATUM ? floorTop(MAX_FLOOR) + FLOOR_H + BELOW : strataSeam(s) });
  }
  return out;
}

export function stubCityLayoutSig(state: GameState): string {
  const floors = Math.max(0, state.currentFloors | 0);
  let sig = `${floors}`;
  const ext = state.layout?.ext;
  if (ext) for (const k in ext) sig += `|${k}:${ext[k].w},${ext[k].e}`;
  for (const b of state.buildings) if (isDistrict(b.type)) sig += `|${b.type}@${b.position.floor},${b.position.x}${b.isConstructing ? '*' : ''}`;
  return sig;
}

export function stubCityLayout(state: GameState): CityLayout {
  const floors = Math.max(0, state.currentFloors | 0);
  const exts = extentsFor(state, Math.max(1, floors));
  const maxW = exts.reduce((m, x) => Math.max(m, x.w), 0);
  const maxE = exts.reduce((m, x) => Math.max(m, x.e), 12);
  const districts = state.buildings.filter(b => isDistrict(b.type));
  let x0 = Math.min(maxW > 0 ? westmostSlotX(-maxW) : frameOfStratum(1).hubL, frameOfStratum(1).hubL) - EDGE_SLOTS * SLOT_W;
  let x1 = eastmostSlotX(maxE) + EDGE_SLOTS * SLOT_W;
  for (const d of districts) { const r = buildingRect(d); x1 = Math.max(x1, r.x + r.w); x0 = Math.min(x0, r.x); }
  const bottom = floorTop(Math.min(MAX_FLOOR, floors)) + FLOOR_H + BELOW;
  const bounds = { x: x0 - SIDE, y: -SKY, w: x1 - x0 + SIDE * 2, h: bottom + SKY };

  const frames: StratumFrame[] = CITY.frames.map((f, s) => ({ s: s as StratumId, hubL: f.hubL, hubR: f.hubR, vestW: f.vestW, vestE: f.vestE, tunnel: f.tunnel }));
  const hubs: HubGeom[] = [];
  for (const s of strataReached(floors)) {
    if (s === 0) continue;
    const f0 = (s - 1) * FLOORS_PER_STRATUM;
    const dug: number[] = [];
    for (let f = f0; f < Math.min(floors, f0 + FLOORS_PER_STRATUM); f++) dug.push(f);
    if (!dug.length) continue;
    const full = hubRect(s);
    const yb = floorTop(dug[dug.length - 1]) + FLOOR_H;
    const r = { x: full.x, y: full.y, w: full.w, h: Math.min(full.h, yb - full.y) };
    hubs.push({ s, floors: dug, rect: r, vault: [r.x, r.y, r.x + r.w / 2, r.y - CITY.hub.vaultRise, r.x + r.w, r.y], balconies: [], stairs: [] });
  }

  const areas: CityArea[] = [{ id: 'surface', kind: 'surface', s: 0, state: 'revealed', poly: rect(bounds.x, -SKY, bounds.x + bounds.w, 0) }];
  const edges: EdgeSite[] = [];
  for (let f = 0; f < floors; f++) {
    const ext = exts[f] ?? { w: 0, e: 12 };
    const sx = stripX(f, ext);
    const hub = frameOfStratum(stratumOf(f));
    let a = Math.min(sx.x0, hub.hubL), b = Math.max(sx.x1, hub.hubR);
    for (const d of districts) if (d.position.floor === f) { const r = buildingRect(d); b = Math.max(b, r.x + r.w); }
    const y0 = f === 0 ? 0 : floorTop(f), y1 = floorTop(f + 1);
    areas.push({ id: `f:${f}`, kind: 'storey', s: stratumOf(f), state: 'revealed', poly: rect(a, y0, b, y1) });
    const yMid = floorTop(f) + ROOM_H;
    areas.push({ id: `e:${f}:w`, kind: 'edge', s: stratumOf(f), state: 'glimpsed', poly: rect(a - EDGE_SLOTS * SLOT_W, floorTop(f), a, floorTop(f) + ROOM_H) });
    areas.push({ id: `e:${f}:e`, kind: 'edge', s: stratumOf(f), state: 'glimpsed', poly: rect(b, floorTop(f), b + EDGE_SLOTS * SLOT_W, floorTop(f) + ROOM_H) });
    edges.push({ id: `e:${f}:w`, floor: f, side: 'w', x: a - (EDGE_SLOTS * SLOT_W) / 2, y: yMid, block: 'ready', progress: 0 });
    edges.push({ id: `e:${f}:e`, floor: f, side: 'e', x: b + (EDGE_SLOTS * SLOT_W) / 2, y: yMid, block: 'ready', progress: 0 });
  }
  for (const d of districts) {
    const r = buildingRect(d);
    areas.push({ id: `d:${d.type}`, kind: 'district', s: stratumOf(d.position.floor), state: d.isConstructing ? 'digging' : 'revealed', progress: 0, poly: rect(r.x, r.y, r.x + r.w, r.y + r.h) });
  }
  if (floors <= MAX_FLOOR) {
    const hub = frameOfStratum(stratumOf(floors));
    const yt = floorTop(floors);
    areas.push({ id: `f:${floors}`, kind: 'storey', s: stratumOf(floors), state: 'glimpsed', poly: rect(hub.hubL, yt, Math.max(hub.hubR, eastmostSlotX(12)), yt + ROOM_H) });
    const below = floorTop(floors + 1);
    areas.push({ id: `s:below`, kind: 'storey', s: stratumOf(floors + 1), state: 'hidden', poly: rect(bounds.x, below, bounds.x + bounds.w, bounds.y + bounds.h) });
  }

  return { sig: `stub|${stubCityLayoutSig(state)}`, frames, hubs, cavities: [], areas, edges, bounds, strata: strataBands() };
}

export const stubLayoutProvider = { sig: stubCityLayoutSig, build: stubCityLayout };

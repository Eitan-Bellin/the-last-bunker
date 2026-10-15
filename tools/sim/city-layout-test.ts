// [world:C1] City layout checks (architecture 1.3-1.5): buildCityLayout / cityLayoutSig / cityProgress over every sample save and the
// vertical-slice scenario, under the city projection. Pure and deterministic; nothing here touches Pixi.
import { migrateState, floorExtent, type GameState } from '../../src/core/GameState';
import { revealedAreaIds } from '../../src/core/state/city';
import { isDistrict } from '../../src/data/buildingDefs';
import { SHAFT_W } from '../../src/rendering/geom';
import { allPockets, stratumOf, strataReached } from '../../src/data/strata';
import { WING_CAP_EAST, WING_CAP_WEST } from '../../src/data/wings';
import { FLIGHT_RISE } from '../../src/rendering/geom';
import { CITY } from '../../src/world/tokens';
import { __setProjectionForTests, buildingRect, roomRect, slotX, frameOfStratum } from '../../src/world/project';
import { buildCityLayout, cityLayoutSig, cityProgress, entranceGeom, laneY, pocketBox } from '../../src/world/model/cityLayout';
import { inPoly, polyBounds } from '../../src/world/model/outline';
import type { CityLayout } from '../../src/world/render/layoutTypes';
import { buildSliceState } from '../../src/dev/cityScenario';

type Box = { x0: number; y0: number; x1: number; y1: number };
const hit = (a: Box, b: Box, k = 1): boolean => a.x1 - k > b.x0 && a.x0 + k < b.x1 && a.y1 - k > b.y0 && a.y0 + k < b.y1;

const ID_RE = /^(surface|f:\d+|g:\d+|e:\d+:[we]|d:[a-zA-Z]+|p:\d:[a-zA-Z]+)$/;
const STATES = new Set(['hidden', 'glimpsed', 'digging', 'revealed']);

function inAnyCavity(L: CityLayout, x: number, y: number): boolean {
  for (const c of L.cavities) if (inPoly(c.poly, x, y)) return true;
  return false;
}

/** Five points of a rect (inset corners + centre) are inside the cut. */
function rectCut(L: CityLayout, r: { x: number; y: number; w: number; h: number }): boolean {
  const k = 1.5;
  const pts = [[r.x + k, r.y + k], [r.x + r.w - k, r.y + k], [r.x + k, r.y + r.h - k], [r.x + r.w - k, r.y + r.h - k], [r.x + r.w / 2, r.y + r.h / 2]];
  return pts.every(([x, y]) => inAnyCavity(L, x, y));
}

function checkLayout(name: string, state: GameState, fail: (m: string) => void): number {
  let n = 0;
  const L = buildCityLayout(state);
  const again = buildCityLayout(state);
  if (JSON.stringify(L) !== JSON.stringify(again)) fail(`${name}: layout is not deterministic`);
  if (L.sig !== cityLayoutSig(state)) fail(`${name}: sig differs from cityLayoutSig`);
  if (L.frames.length !== 7) fail(`${name}: ${L.frames.length} frames`);
  // Strata bands: 7, contiguous below ground.
  if (L.strata.length !== 7) fail(`${name}: ${L.strata.length} strata bands`);
  for (let s = 1; s < 6; s++) if (Math.abs(L.strata[s].y1 - L.strata[s + 1].y0) > 1e-6) fail(`${name}: strata ${s}/${s + 1} do not meet`);
  if (L.strata[1].y0 !== 0 || L.strata[0].y1 !== 0) fail(`${name}: the ground line is not y 0`);
  const B = L.bounds;
  const inB = (p: number[]) => { const b = polyBounds(p); return b.x0 >= B.x && b.x1 <= B.x + B.w && b.y0 >= B.y && b.y1 <= B.y + B.h; };
  // Polygons: well formed, inside the bounds.
  const ids = new Set<string>();
  for (const a of L.areas) {
    n++;
    if (ids.has(a.id)) fail(`${name}: area ${a.id} twice`);
    ids.add(a.id);
    if (!ID_RE.test(a.id)) fail(`${name}: odd area id ${a.id}`);
    if (!STATES.has(a.state)) fail(`${name}: area ${a.id} state ${a.state}`);
    if (a.poly.length < 6 || a.poly.length % 2 || a.poly.some(v => !Number.isFinite(v))) fail(`${name}: area ${a.id} polygon is malformed`);
    if (!inB(a.poly)) fail(`${name}: area ${a.id} leaves the bounds`);
    if (a.state === 'digging' && (a.progress === undefined || a.progress < 0 || a.progress > 1)) fail(`${name}: digging area ${a.id} without a 0..1 progress`);
  }
  const cids = new Set<string>();
  for (const c of L.cavities) {
    if (cids.has(c.id)) fail(`${name}: cavity ${c.id} twice`);
    cids.add(c.id);
    if (c.poly.length < 6 || c.poly.length % 2 || c.poly.some(v => !Number.isFinite(v))) fail(`${name}: cavity ${c.id} polygon is malformed`);
    if (!inB(c.poly)) fail(`${name}: cavity ${c.id} leaves the bounds`);
  }
  // Derived discovery agrees with the save's own logic (src/core/state/city.ts).
  const revealed = new Set(revealedAreaIds(state));
  for (const a of L.areas) {
    if (a.kind === 'edge') { if (a.state === 'revealed') fail(`${name}: edge ${a.id} is revealed`); continue; }
    if ((a.state === 'revealed') !== revealed.has(a.id)) fail(`${name}: area ${a.id} is ${a.state} but revealedAreaIds says ${revealed.has(a.id)}`);
  }
  for (const id of revealed) {
    if (/^(f|g|d|p):/.test(id) && !ids.has(id)) fail(`${name}: revealed area ${id} has no polygon`);
  }
  const nf = state.currentFloors;
  const dig = L.areas.find(a => a.id === `f:${nf}`);
  if (nf < 24 && (!dig || (dig.state !== 'glimpsed' && dig.state !== 'digging'))) fail(`${name}: the dig face f:${nf} is ${dig?.state}`);
  // Every room, district and ruin stands in the cut (the rock never covers a room).
  for (const b of state.buildings) {
    if (b.position.floor < 0) continue;
    const r = buildingRect(b);
    if (!rectCut(L, r)) fail(`${name}: ${b.type} ${b.position.floor}:${b.position.x} is not inside the cut`);
    n++;
  }
  for (const r of state.ruins ?? []) {
    if (r.floor < 0) continue;
    if (!rectCut(L, roomRect(r.floor, r.x, r.w))) fail(`${name}: ruin ${r.floor}:${r.x} is not inside the cut`);
  }
  // Every empty slot of a dug floor is cut too (it is where a room goes).
  for (let f = 0; f < nf; f++) {
    const e = floorExtent(state, f);
    for (let s = -e.w; s < e.e; s++) if (!rectCut(L, roomRect(f, s, 1))) { fail(`${name}: slot ${f}:${s} is not inside the cut`); break; }
  }
  // Hubs: one per reached underground stratum; balconies on the lane; stairs in their columns, clear of the spine.
  for (const h of L.hubs) {
    const F = frameOfStratum(h.s);
    if (h.rect.x !== F.hubL || h.rect.x + h.rect.w !== F.hubR) fail(`${name}: hub ${h.s} rect is not hubL..hubR`);
    if (h.vault[0] !== F.hubL || h.vault[h.vault.length - 2] !== F.hubR) fail(`${name}: hub ${h.s} vault does not spring from the walls`);
    for (const b of h.balconies) {
      if (b.y !== laneY(b.floor)) fail(`${name}: balcony ${b.floor}${b.side} is not on the lane`);
      if (b.side === 'w' ? b.x1 > 0 : b.x0 < SHAFT_W) fail(`${name}: balcony ${b.floor}${b.side} enters the spine`);
    }
    for (const st of h.stairs) {
      const x0 = st.x - CITY.hub.stairW / 2, x1 = st.x + CITY.hub.stairW / 2;
      if (x0 < F.hubL + CITY.hub.wallW || x1 > F.hubR - CITY.hub.wallW) fail(`${name}: hub ${h.s} stair ${st.side} leaves the atrium`);
      if (x1 > 0 && x0 < SHAFT_W) fail(`${name}: hub ${h.s} stair ${st.side} enters the spine`);
      if (st.top !== laneY(h.floors[0]) || st.bottom !== laneY(h.floors[h.floors.length - 1])) fail(`${name}: hub ${h.s} stair does not run lane to lane`);
    }
    if (!L.cavities.some(c => c.id === `c:hub:${h.s}`)) fail(`${name}: hub ${h.s} has no cavity`);
  }
  // Edges: both sides of every dug floor, standing past the end of the strip.
  for (let f = 0; f < nf; f++) {
    const e = floorExtent(state, f);
    for (const side of ['w', 'e'] as const) {
      const site = L.edges.find(x => x.floor === f && x.side === side);
      if (!site) { fail(`${name}: no edge e:${f}:${side}`); continue; }
      const F = frameOfStratum(stratumOf(f));
      const end = side === 'e' ? slotX(f, e.e) : e.w > 0 ? slotX(f, -e.w) : F.hubL - F.vestW;
      if (side === 'e' ? site.x <= end : site.x >= end) fail(`${name}: edge e:${f}:${side} is not past the end of the floor`);
      if (!L.areas.some(a => a.id === site.id)) fail(`${name}: edge ${site.id} has no area`);
    }
  }
  // Districts: built ones are revealed with an open (back 'none') cavern.
  for (const b of state.buildings) {
    if (!isDistrict(b.type) || b.isConstructing) continue;
    const c = L.cavities.find(x => x.id === `c:dist:${b.type}`);
    if (!c || c.back !== 'none') fail(`${name}: built district ${b.type} has no open cavern`);
  }
  // [world:M1] No overlaps in the city projection: no two rooms (districts and ruins included) share space.
  const rects: { id: string; b: Box; floor: number; type: string }[] = [];
  for (const b of state.buildings) {
    if (b.position.floor < 0) continue;
    const r = buildingRect(b);
    rects.push({ id: `${b.type} ${b.position.floor}:${b.position.x}`, type: b.type, floor: b.position.floor, b: { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h } });
  }
  for (const r of state.ruins ?? []) {
    if (r.floor < 0) continue;
    const q = roomRect(r.floor, r.x, r.w);
    rects.push({ id: `ruin ${r.floor}:${r.x}`, type: 'ruin', floor: r.floor, b: { x0: q.x, y0: q.y, x1: q.x + q.w, y1: q.y + q.h } });
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (hit(rects[i].b, rects[j].b)) fail(`${name}: ${rects[i].id} overlaps ${rects[j].id}`);
  // ...no room stands in a hub atrium, and no district cavern, district tunnel, edge tunnel or the hatch cuts into another floor's room.
  for (const h of L.hubs) {
    const hb = { x0: h.rect.x, y0: h.rect.y, x1: h.rect.x + h.rect.w, y1: h.rect.y + h.rect.h };
    for (const r of rects) if (hit(hb, r.b)) fail(`${name}: ${r.id} stands in hub ${h.s}`);
  }
  for (const c of L.cavities) {
    const m = /^c:(dist|tun|edge|hatch)(?::(\w+))?(?::(\d+))?/.exec(c.id);
    if (!m) continue;
    const own = m[1] === 'edge' ? +c.id.split(':')[2] : m[1] === 'hatch' ? -99 : state.buildings.find(b => b.type === m[2])?.position.floor ?? -99;
    const cb = polyBounds(c.poly);
    for (const r of rects) {
      if (r.floor === own) continue;
      // (An edge tunnel overlaps the strip it opens from by a few units: that is its mouth, not a cut into a room.)
      const k = m[1] === 'edge' ? 9 : 4;
      const inner = { x0: r.b.x0 + k, y0: r.b.y0 + k, x1: r.b.x1 - k, y1: r.b.y1 - k };
      if (!hit(cb, inner)) continue;
      const pts = [[inner.x0, inner.y0], [inner.x1, inner.y0], [(inner.x0 + inner.x1) / 2, inner.y0], [(inner.x0 + inner.x1) / 2, (inner.y0 + inner.y1) / 2], [inner.x0, inner.y1], [inner.x1, inner.y1]];
      if (pts.some(([x, y]) => inPoly(c.poly, x, y))) fail(`${name}: cavity ${c.id} cuts into ${r.id}`);
    }
  }
  // [world:M1] Every reached underground stratum has its hub, over exactly its dug floors.
  for (const s of strataReached(nf)) {
    if (s === 0) continue;
    const h = L.hubs.find(x => x.s === s);
    if (!h) { fail(`${name}: stratum ${s} is reached but has no hub`); continue; }
    if (h.floors.some(f => stratumOf(f) !== s || f >= nf)) fail(`${name}: hub ${s} floors ${h.floors.join()}`);
  }
  // [world:M1] The entrance: the hatch shaft is cut, the companionway lands on floor 0's lane and starts under the hatch.
  if (L.hubs.some(h => h.s === 1)) {
    const e = entranceGeom();
    if (!L.cavities.some(c => c.id === 'c:hatch')) fail(`${name}: no hatch shaft`);
    if (e.stair.bottom !== laneY(0)) fail(`${name}: the companionway does not land on floor 0's lane`);
    if (e.flights.length * FLIGHT_RISE !== e.stair.bottom - e.stair.top) fail(`${name}: the companionway flights do not fill it`);
    if (e.hatch.y0 > 0 || e.hatch.y1 < e.stair.top - 12) fail(`${name}: the hatch does not reach from the ground to the landing`);
    if (e.flights[e.flights.length - 1].odd !== true) fail(`${name}: the last flight must end where the stair column's first one starts`);
  }
  // [world:M1] Pockets never meet a non-pocket cavity (their own gallery band aside).
  for (const p of allPockets()) {
    const pb = pocketBox(p);
    for (const c of L.cavities) if (!c.id.startsWith('c:p:') && !c.id.startsWith('c:gal:') && hit(pb, polyBounds(c.poly), 2)) fail(`${name}: pocket ${p.id} meets ${c.id}`);
  }
  // Progress never changes the geometry signature.
  const prog = cityProgress(state);
  for (const p of prog) if (!L.areas.some(a => a.id === p.id)) fail(`${name}: progress for unknown area ${p.id}`);
  return n;
}

export function cityLayoutChecks(games: { name: string; json: string }[]): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const fail = (m: string) => { if (problems.length < 40) problems.push(m); };
  __setProjectionForTests('city');
  try {
    let n = 0;
    for (const g of games) {
      let state: GameState;
      try { state = migrateState(JSON.parse(g.json) as GameState); } catch (e) { fail(`${g.name}: does not parse (${e})`); continue; }
      n += checkLayout(g.name, state, fail);
    }
    // The vertical slice (architecture 6.1), built with the engine's APIs exactly as the dev scenario does.
    for (const id of ['slice', 'slice-dig'] as const) {
      const s = buildSliceState(id);
      n += checkLayout(id, s, fail);
      const L = buildCityLayout(s);
      if (L.hubs.length !== 1 || L.hubs[0].floors.join() !== '0,1,2') fail(`${id}: expected one 3-storey hub, got ${L.hubs.map(h => h.floors.join('/')).join(' ')}`);
      if (!L.hubs[0]?.bridge || L.hubs[0].stairs.length !== 2) fail(`${id}: the hub lacks its stairs or bridge`);
      if (L.edges.find(e => e.id === 'e:2:e')?.block !== 'act') fail(`${id}: e:2:e is not blocked by the Act`);
      const face = L.areas.find(a => a.id === 'f:3');
      if (id === 'slice' && face?.state !== 'glimpsed') fail(`slice: f:3 should be glimpsed, is ${face?.state}`);
      if (id === 'slice-dig' && (face?.state !== 'digging' || Math.abs((face.progress ?? 0) - 0.1) > 0.02)) fail(`slice-dig: f:3 should be digging at 0.1, is ${face?.state} ${face?.progress}`);
      if (s.survivors.length !== 8) fail(`${id}: ${s.survivors.length} survivors`);
      if (id === 'slice-dig' && cityLayoutSig(s) === cityLayoutSig(buildSliceState('slice'))) fail('slice-dig: a running dig must change the signature (the face is cut open)');
      const tweak = JSON.parse(JSON.stringify(s)) as GameState;
      if (tweak.longGame.dig.floor != null) tweak.longGame.dig.progress = tweak.longGame.dig.total * 0.9;
      if (cityLayoutSig(tweak) !== cityLayoutSig(s)) fail(`${id}: dig progress changed the signature`);
    }
    // [world:M1] The deepest city: e55 dug on to 24 floors (all seven strata), and that bunker at the last Act's widest wing caps.
    const big = games.find(g => g.name.includes('e55'));
    if (big) {
      const deep = migrateState(JSON.parse(big.json) as GameState);
      deep.currentFloors = 24;
      n += checkLayout('e55@24', deep, fail);
      if (buildCityLayout(deep).hubs.length !== 6) fail(`e55@24: ${buildCityLayout(deep).hubs.length} hubs, want 6`);
      const wide = migrateState(JSON.parse(big.json) as GameState);
      wide.currentFloors = 24;
      const ext: Record<string, { w: number; e: number }> = {};
      for (let f = 0; f < 24; f++) ext[f] = { w: WING_CAP_WEST[WING_CAP_WEST.length - 1], e: WING_CAP_EAST[WING_CAP_EAST.length - 1] };
      (wide.layout as unknown as { ext: unknown }).ext = ext;
      wide.buildings = wide.buildings.filter(b => b.position.floor < 0 || isDistrict(b.type));
      wide.ruins = [];
      for (const b of wide.buildings) if (isDistrict(b.type)) b.position.x = ext[b.position.floor].e;
      n += checkLayout('widest-caps', wide, fail);
      // A sealed door enters the signature (its lamp is part of the shell).
      const shut = migrateState(JSON.parse(big.json) as GameState);
      const before = cityLayoutSig(shut);
      shut.layout.doors = { ...(shut.layout.doors ?? {}), '1:3': 'sealed' };
      if (cityLayoutSig(shut) === before) fail('a sealed door does not change the signature');
    }
    notes.push(`${games.length} saves + 2 slice states + e55@24 + widest caps, ${n} areas/rooms checked`);
  } finally {
    __setProjectionForTests('classic');
  }
  return { problems, notes };
}

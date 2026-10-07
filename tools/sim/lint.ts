// Data checks for CI (run by tools/sim/lint.mjs): research is a sound DAG, every cost names a real resource,
// every resource has a name in both languages, and every upgrade and dig of Acts II-VII fits in storage (L2).
import { RESEARCH } from '../../src/data/research';
import { BUILDING_DEFS, getDef, isDistrict, roomFloors, roomSlots } from '../../src/data/buildingDefs';
import { allowedFloors } from '../../src/data/zones';
import { ALL_RESOURCES, RESOURCES } from '../../src/data/resources';
import type { BuildingType, GameState, ResourceType } from '../../src/core/GameState';
import { createInitialState, floorExtent, migrateState } from '../../src/core/GameState';
import { ACTS } from '../../src/data/acts';
import { TUNING } from '../../src/data/tuning';
import { BOOK, HELP_TOPICS } from '../../src/data/book';
import { CHAPTERS } from '../../src/data/story';
import { BuildingSystem, SLOTS_PER_FLOOR } from '../../src/systems/BuildingSystem';
import { ResourceSystem } from '../../src/systems/ResourceSystem';
import { StateManager } from '../../src/core/StateManager';
import { DigSystem } from '../../src/systems/DigSystem';
import { PopulationSystem } from '../../src/systems/PopulationSystem';
import { WING_CAP_EAST, WING_CAP_WEST, maxEast, maxWest, stabilityCut, wingCost, wingOptions } from '../../src/data/wings';

export function lintData(i18n: Record<string, Record<string, string>>): string[] {
  const problems: string[] = [];
  const known = new Set<string>(ALL_RESOURCES);

  // Research: unique ids, prerequisites exist, no cycles, costs in real resources.
  const ids = new Set<string>();
  for (const r of RESEARCH) {
    if (ids.has(r.id)) problems.push(`research ${r.id}: duplicate id`);
    ids.add(r.id);
  }
  for (const r of RESEARCH) {
    for (const q of r.requires) if (!ids.has(q)) problems.push(`research ${r.id}: requires unknown ${q}`);
    for (const k of Object.keys(r.cost ?? {})) if (!known.has(k)) problems.push(`research ${r.id}: cost in unknown resource ${k}`);
  }
  const byId = new Map(RESEARCH.map(r => [r.id, r]));
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string, path: string[]): void => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'open') { problems.push(`research cycle: ${[...path, id].join(' -> ')}`); return; }
    state.set(id, 'open');
    for (const q of byId.get(id)?.requires ?? []) visit(q, [...path, id]);
    state.set(id, 'done');
  };
  for (const r of RESEARCH) visit(r.id, []);

  // [P2-1] Every doctrine fork has at least two ways to go, and a fork's members share one Act.
  const forks = new Map<string, typeof RESEARCH>();
  for (const r of RESEARCH) if (r.fork) forks.set(r.fork, [...(forks.get(r.fork) ?? []), r]);
  for (const [f, list] of forks) {
    if (list.length < 2) problems.push(`fork ${f}: only ${list.length} option`);
    if (new Set(list.map(x => x.act)).size > 1) problems.push(`fork ${f}: its options open in different Acts`);
  }
  // [Q6] The Bunker Book: unique entries, and every "?" topic leads to one.
  const bookIds = new Set<string>();
  for (const e of BOOK) { if (bookIds.has(e.id)) problems.push(`book: duplicate entry ${e.id}`); bookIds.add(e.id); }
  for (const [panel, entry] of Object.entries(HELP_TOPICS)) if (!bookIds.has(entry)) problems.push(`book: topic ${panel} points to a missing entry ${entry}`);
  // The story: unique ids and numbers.
  const chIds = new Set<string>(); const chNums = new Set<number>();
  for (const c of CHAPTERS) {
    if (chIds.has(c.id)) problems.push(`story: duplicate chapter ${c.id}`);
    if (chNums.has(c.number)) problems.push(`story: duplicate chapter number ${c.number}`);
    chIds.add(c.id); chNums.add(c.number);
  }

  // Rooms: costs in real resources.
  for (const [type, def] of Object.entries(BUILDING_DEFS)) {
    const costs = (def as { baseCost?: Record<string, number> }).baseCost ?? {};
    for (const k of Object.keys(costs)) if (!known.has(k)) problems.push(`room ${type}: cost in unknown resource ${k}`);
  }

  // Every resource the player can see has a name in each language.
  for (const [lang, dict] of Object.entries(i18n)) {
    for (const r of RESOURCES) {
      const key = `resources.${r.id as ResourceType}`;
      if (r.tier !== 2 && !(key in dict)) problems.push(`${lang}: missing ${key}`);
    }
  }
  // [L2] Every room upgrade and every dig an Act allows must fit in maxPaymentShare of that Act's storage
  // (storage from the Act alone: era 3, no Storage rooms; rooms only add to it). Act I keeps its hand-tuned prices,
  // which expect a Storage room.
  const bs = new BuildingSystem();
  const rs = new ResourceSystem();
  for (const act of ACTS.filter(a => a.id >= 2)) {
    const s = createInitialState();
    s.era = 3;
    s.longGame.meta.act = act.id;
    const caps = rs.computeCaps(s);
    const over = (what: string, cost: Record<string, number>) => {
      for (const [r, v] of Object.entries(cost)) {
        if (r === 'scrap' || r === 'blueprints') continue; // scarce goods have their own small prices
        const cap = caps[r as ResourceType] ?? 0;
        if (v > cap * TUNING.maxPaymentShare) problems.push(`Act ${act.id}: ${what} costs ${v} ${r}, more than ${TUNING.maxPaymentShare} of storage ${cap}`);
      }
    };
    for (const [type, def] of Object.entries(BUILDING_DEFS)) {
      const top = Math.min(def.maxLevel, Math.max(1, Math.floor((act.levelCap * def.maxLevel) / 10)));
      for (let level = 1; level < top; level++) {
        over(`${type} level ${level}->${level + 1}`, bs.getUpgradeCost({ id: 'x', type: type as BuildingType, level, position: { x: 0, y: 0, floor: 0 }, assignedSurvivorIds: [], constructionProgress: 0, constructionTotal: 0, isConstructing: false, specialization: null }));
      }
    }
    // [P2-8] A research of this Act that asks a late currency must fit in the storage the Act alone gives (knowledge and materials depend on rooms).
    for (const r of RESEARCH.filter(x => (x.act ?? 0) === act.id)) {
      for (const [res, v] of Object.entries(r.cost)) {
        if (!['components', 'alloys', 'data', 'influence', 'seedCores'].includes(res)) continue;
        const cap = caps[res as ResourceType] ?? 0;
        if ((v ?? 0) > cap * TUNING.maxPaymentShare) problems.push(`Act ${act.id}: research ${r.id} costs ${v} ${res}, more than ${TUNING.maxPaymentShare} of storage ${cap}`);
      }
    }
    // [plan4:ST-3] A wing step must fit in storage too (shallowest, mid and deepest floor).
    for (const f of [0, 10, 23]) over(`wing step on B${f + 1}`, wingCost(s, f));
    const prev = act.id > 1 ? ACTS[act.id - 2].floorCap : 3;
    for (let floors = prev; floors < act.floorCap; floors++) {
      s.currentFloors = floors;
      over(`dig to B${floors + 1}`, bs.digCost(s));
    }
  }
  // [plan4:X-3] The bunker layout state exists with its defaults, and an empty layout reaches the classic 12 slots east, none west.
  {
    const s = createInitialState();
    const l = s.layout;
    if (!l || l.v !== 1 || !l.ext || !l.doors || !Array.isArray(l.infra) || l.surfaceOpen !== false) problems.push('layout: createInitialState().layout is missing or not the empty default');
    else if (Object.keys(l.ext).length || Object.keys(l.doors).length || l.infra.length) problems.push('layout: the default layout is not empty');
    for (const f of [0, 3, 11]) {
      const x = floorExtent(s, f);
      if (x.w !== 0 || x.e !== 12) problems.push(`layout: floorExtent(empty, ${f}) = {w:${x.w}, e:${x.e}}, expected {w:0, e:12}`);
    }
    const m = migrateState({ ...createInitialState(), version: 6, layout: undefined } as unknown as GameState);
    if (!m.layout || m.layout.v !== 1 || m.layout.surfaceOpen !== false) problems.push('layout: migrateState does not default layout for a v6 save');
  }
  problems.push(...wingChecks());
  return problems;
}

/**
 * [plan4:ST-3/ST-5] Wings: placement honors a floor's extent, the width caps follow the Act and depth, and a wing dig runs end to end
 * (cost paid, crew slot, second slot after Parallel Digging, extent grows, a district on that side is pushed out).
 */
export function wingChecks(): string[] {
  const problems: string[] = [];
  const bs = new BuildingSystem();
  const fail = (m: string) => { if (problems.length < 12) problems.push(`wings: ${m}`); };

  // 1. A floor with ext {w:4,e:16}: every one-floor room type allowed on B2 fits at x in [-4, 16 - w] and nowhere outside.
  const a = createInitialState();
  a.currentFloors = 6;
  a.ruins = []; a.buildings = [];
  a.layout.ext['1'] = { w: 4, e: 16 };
  let tested = 0;
  for (const type of Object.keys(BUILDING_DEFS) as BuildingType[]) {
    if (isDistrict(type) || roomFloors(type) !== 1 || !allowedFloors(type, a.currentFloors).includes(1)) continue;
    const w = roomSlots(type);
    tested++;
    for (let x = -6; x <= 18; x++) {
      const ok = x >= -4 && x + w <= 16;
      const why = bs.placeBlock(type, { x, y: 0, floor: 1 }, a);
      if (ok && why !== null) fail(`${type} at x=${x} on an ext {w:4,e:16} floor: refused (${why})`);
      if (!ok && why !== 'bounds') fail(`${type} at x=${x} on an ext {w:4,e:16} floor: ${why ?? 'accepted'} (expected bounds)`);
    }
    // The floor above is still the classic 12 wide.
    if (bs.placeBlock(type, { x: -1, y: 0, floor: 0 }, a) === null) fail(`${type} fits west of the shaft on a floor with no wing`);
  }
  if (!tested) fail('no room type to test placement on an extended floor');

  // 2. Caps follow the Act and depth.
  const b = createInitialState();
  b.currentFloors = 24;
  b.ruins = []; b.buildings = [];
  for (let act = 1; act <= 7; act++) {
    b.longGame.meta.act = act;
    for (const f of [0, 8, 11, 12, 16, 20, 23]) {
      const e = maxEast(b, f), w = maxWest(b, f);
      const wantE = Math.min(WING_CAP_EAST[act - 1], Math.max(12, WING_CAP_EAST[act - 1] - stabilityCut(f)));
      const wantW = Math.min(WING_CAP_WEST[act - 1], Math.max(0, WING_CAP_WEST[act - 1] - stabilityCut(f)));
      if (e !== wantE || w !== wantW) fail(`Act ${act} floor ${f}: max east/west ${e}/${w}, expected ${wantE}/${wantW}`);
    }
  }
  if (stabilityCut(8) !== 0 || stabilityCut(12) !== 2 || stabilityCut(20) !== 6) fail('stabilityCut(8,12,20) is not 0,2,6');
  // Act I: no wing anywhere. Act VII, deep: held by stability until the Deep Foundry.
  b.longGame.meta.act = 1;
  if (wingOptions(b).some(o => o.block !== 'act')) fail('Act I: a wing option is not blocked by the Act');
  b.longGame.meta.act = 7;
  b.layout.ext['20'] = { w: 4, e: 16 };
  const deep = (side: 'w' | 'e') => wingOptions(b).find(o => o.floor === 20 && o.side === side)?.block;
  if (deep('e') !== 'stability' || deep('w') !== 'stability') fail(`Act VII B21 at {w:4,e:16}: expected stability, got ${deep('w')}/${deep('e')}`);
  b.lateGame.projects.deepFoundry = { ...(b.lateGame.projects.deepFoundry ?? {}), stage: 99 } as never;
  if (deep('e') === 'stability' || deep('w') === 'stability') fail('the Deep Foundry does not lift the stability cap');
  b.layout.ext['0'] = { w: 10, e: 22 };
  if (wingOptions(b).find(o => o.floor === 0 && o.side === 'e')?.block !== 'act' || wingOptions(b).find(o => o.floor === 0 && o.side === 'w')?.block !== 'act') fail('Act VII B1 at the caps: expected act');

  // 3. A wing dig, end to end.
  const sm = new StateManager();
  const ds = new DigSystem(sm, bs, new PopulationSystem());
  sm.applyDeltas([
    { path: 'longGame.meta.act', value: 2 },
    { path: 'currentFloors', value: 4 },
    ...ALL_RESOURCES.map(r => ({ path: `resources.${r}.amount`, value: 1e9 })),
  ]);
  const before = sm.state.resources.materials.amount;
  if (!bs.digWing(sm, 0, 'w')) fail('digWing(B1, west) refused in Act II with resources');
  const d0 = sm.state.longGame.dig;
  if (d0.kind !== 'wing' || d0.side !== 'w' || d0.floor !== 0) fail('the wing dig is not in slot 0');
  if (sm.state.resources.materials.amount >= before) fail('digWing did not charge the price');
  if (bs.digWing(sm, 0, 'e')) fail('a second wing dig started with one slot');
  if (bs.canDig(sm.state)) fail('canDig is true while the only slot is busy');
  sm.applyDelta({ path: 'longGame.dig.progress', value: d0.total });
  ds.update(0);
  const x0 = floorExtent(sm.state, 0);
  if (x0.w !== 2 || x0.e !== 12) fail(`after the west wing B1 is {w:${x0.w}, e:${x0.e}}, expected {w:2, e:12}`);
  if (sm.state.longGame.dig.floor !== null) fail('the finished dig slot is not empty');
  if (wingOptions(sm.state).find(o => o.floor === 0 && o.side === 'w')?.block !== 'act') fail('B1 west at the Act II cap is not blocked by the Act');
  // Parallel Digging: a second slot, its own crew id.
  sm.applyDelta({ path: 'research.parallelDig', value: { id: 'parallelDig', completed: true, progress: 0, active: false } });
  sm.applyDelta({ path: 'longGame.meta.act', value: 3 });
  if (!bs.digWing(sm, 0, 'e') || !bs.digWing(sm, 1, 'w')) fail('two wing digs did not start with Parallel Digging');
  if (!sm.state.longGame.dig2 || sm.state.longGame.dig2.floor !== 1) fail('the second wing dig is not in slot 2');
  if (ds.slots(sm.state).length !== 2) fail('DigSystem does not see both digs');
  if (bs.digWing(sm, 2, 'e')) fail('a third dig started');
  // A district tunnel on B2's east side is pushed out by the wing.
  sm.applyDelta({ path: 'buildings', value: [{ id: 'b_d', type: 'cave', level: 1, position: { x: 12, y: 0, floor: 1 }, assignedSurvivorIds: [], constructionProgress: 0, constructionTotal: 1, isConstructing: false, specialization: null }] });
  sm.applyDeltas([{ path: 'longGame.dig.progress', value: sm.state.longGame.dig.total }, { path: 'longGame.dig2.progress', value: sm.state.longGame.dig2!.total }]);
  ds.update(0);
  if (floorExtent(sm.state, 0).e !== 14 || floorExtent(sm.state, 1).w !== 2) fail('the two parallel wings did not both finish');
  if (!bs.digWing(sm, 1, 'e')) fail('digWing east on a floor with a district was refused');
  sm.applyDelta({ path: 'longGame.dig.progress', value: sm.state.longGame.dig.total });
  ds.update(0);
  if (sm.state.buildings.find(x => x.id === 'b_d')?.position.x !== 14) fail('the district was not pushed out by the east wing');
  // Old saves: a dig without `kind` is a floor dig.
  const old = migrateState({ ...createInitialState(), version: 6, longGame: { ...createInitialState().longGame, dig: { floor: 3, paid: [], progress: 5, total: 60, crew: [] } as never, dig2: undefined } } as unknown as GameState);
  if ((old.longGame.dig.kind ?? 'floor') !== 'floor' || !old.longGame.dig2 || old.longGame.dig2.floor !== null) fail('migrateState does not default dig.kind / dig2');
  return problems;
}

/**
 * [plan4:X-2] The placement truth table did not change: the pre-X-2 canPlaceBuilding (fixed 12 slots, copied below) must agree with
 * placeBlock/canPlaceBuilding/findFreeSpot (floorExtent) for every type, floor and slot of the given games (sample saves plus a synthetic one).
 */
export function placementTruthTable(games: { name: string; json: string | null }[]): string[] {
  const problems: string[] = [];
  const bs = new BuildingSystem();
  const oldCanPlace = (type: BuildingType, pos: { x: number; floor: number }, state: GameState): boolean => {
    const def = getDef(type);
    if (!def || isDistrict(type)) return false;
    const levels = roomFloors(type);
    if (pos.floor < 0 || pos.floor + levels > state.currentFloors) return false;
    const allowed = allowedFloors(type, state.currentFloors);
    for (let f = pos.floor; f < pos.floor + levels; f++) if (!allowed.includes(f)) return false;
    const w = roomSlots(type);
    if (pos.x < 0 || pos.x + w > SLOTS_PER_FLOOR) return false;
    const top = pos.floor, bottom = pos.floor + levels - 1;
    for (const r of state.ruins ?? []) if (r.floor >= top && r.floor <= bottom && pos.x < r.x + r.w && pos.x + w > r.x) return false;
    for (const e of state.buildings) {
      const eTop = e.position.floor, eBottom = eTop + roomFloors(e.type) - 1;
      if (eBottom < top || eTop > bottom) continue;
      if (pos.x < e.position.x + roomSlots(e.type) && pos.x + w > e.position.x) return false;
    }
    return true;
  };
  const oldFree = (type: BuildingType, floor: number, state: GameState) => {
    for (let x = 0; x < SLOTS_PER_FLOOR; x++) if (oldCanPlace(type, { x, floor }, state)) return x;
    return null;
  };
  const states: { name: string; state: GameState }[] = [];
  const synth = createInitialState();
  synth.currentFloors = 10;
  states.push({ name: 'synthetic', state: synth });
  for (const g of games) if (g.json) states.push({ name: g.name, state: migrateState(JSON.parse(g.json) as GameState) });
  const reasons = new Set(['floor', 'bounds', 'zone', 'ruin', 'overlap']);
  let checked = 0;
  for (const { name, state } of states) {
    for (const type of Object.keys(BUILDING_DEFS) as BuildingType[]) {
      for (let floor = -1; floor <= state.currentFloors + 1; floor++) {
        for (let x = -3; x <= SLOTS_PER_FLOOR + 2; x++) {
          const pos = { x, y: 0, floor };
          const old = oldCanPlace(type, pos, state);
          const why = bs.placeBlock(type, pos, state);
          checked++;
          if (bs.canPlaceBuilding(type, pos, state) !== old || (why === null) !== old || (why !== null && !reasons.has(why))) {
            if (problems.length < 10) problems.push(`placement: ${name} ${type} at floor ${floor} slot ${x}: old ${old}, new ${why ?? 'free'}`);
          }
        }
        const nf = bs.findFreeSpot(type, floor, state);
        if ((nf ? nf.x : null) !== oldFree(type, floor, state) && problems.length < 10) problems.push(`placement: ${name} findFreeSpot ${type} floor ${floor} differs`);
      }
    }
  }
  if (!checked) problems.push('placement: nothing was checked');
  return problems;
}

/**
 * [plan4:X-2] Places that still derive the floor from a Y coordinate (`/ FLOOR_H`, `(y - TOPSOIL) /`) or assume a fixed slot count
 * (`SLOTS_PER_FLOOR`) outside rendering/geom.ts. All of the first kind must go through floorAtY (and friends) in geom.ts, so it is a gate:
 * `lint.mjs` fails on it. The fixed slot count stays a warning (BuildingSystem keeps the constant exported for tools).
 */
export function legacyGeometryWarnings(files: { rel: string; text: string }[]): string[] {
  const hits: string[] = [];
  for (const { rel, text } of files) {
    if (rel === 'rendering/geom.ts') continue;
    text.split('\n').forEach((line: string, i: number) => {
      if (/\/\s*FLOOR_H\b/.test(line) || /\(\s*\w+(\.\w+)*\s*-\s*TOPSOIL\s*\)\s*\//.test(line) || /\/\s*\(\s*ROOM_H\s*\+\s*SLAB\s*\)/.test(line)) hits.push(`${rel}:${i + 1}: reverse floor lookup "/ FLOOR_H"`);
      if (/\bSLOTS_PER_FLOOR\b/.test(line) && rel !== 'systems/BuildingSystem.ts') hits.push(`${rel}:${i + 1}: SLOTS_PER_FLOOR`);
    });
  }
  return hits;
}

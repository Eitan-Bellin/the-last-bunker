// Data checks for CI (run by tools/sim/lint.mjs): research is a sound DAG, every cost names a real resource,
// every resource has a name in both languages, and every upgrade and dig of Acts II-VII fits in storage (L2).
import { RESEARCH } from '../../src/data/research';
import { BUILDING_DEFS, BUILDABLE_TYPES, DISTRICT_KINDS, getDef, isDistrict, roomFloors, roomSlots, type BuildingDef } from '../../src/data/buildingDefs';
import { CHAIN_INPUTS } from '../../src/data/chains';
import { cargoMult, earlyWarningLead, evacuationMult, expeditionTeamsBonus, hygieneMult, mourningMult, quarantineCapacity, returnSafetyMult, roomChildGrowth, ventilationRelief } from '../../src/data/roomEffects';
import { PopulationSystem, moraleBreakdown } from '../../src/systems/PopulationSystem';
import { StateManager } from '../../src/core/StateManager';
import { SeededRandom } from '../../src/core/Random';
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
  // [plan4:BL-1] The schema of every BuildingDef (names, width, placement, effects, unlocking research, chains).
  problems.push(...buildingSchemaProblems(known));

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
      // [plan4:BL-1] Rooms with placement rules (surface row, adjacency, flag, copies) are checked by effectHookProblems, not against the pre-X-2 rule.
      if (BUILDING_DEFS[type].place?.floors === 'surface' || BUILDING_DEFS[type].place?.adjacentTo || BUILDING_DEFS[type].place?.needsFlag || BUILDING_DEFS[type].maxCopies !== undefined) continue;
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

const PLACE_FLOORS = ['surface', 'entrance', 'deep', 'zone'];
const MORALE_KINDS = ['base', 'comfort', 'culture'];
const ENTRY_EFFECTS = ['childCapacity', 'childGrowth', 'quarantine', 'earlyWarning', 'cargo', 'returnSafety', 'hygiene', 'mourning', 'ventilation'];

/**
 * [plan4:BL-1] Schema checks for every BuildingDef: names and descriptions in he and en, a valid width, consistent placement fields,
 * costs and production in real resources, effects that make sense, one unlocking research node per type (the first node wins, see
 * isBuildingUnlocked) and chain inputs in real resources. Runs on the data as it is: today's rooms must pass without changes.
 */
export function buildingSchemaProblems(known: Set<string>): string[] {
  const problems: string[] = [];
  const types = new Set(Object.keys(BUILDING_DEFS));
  const bad = (type: string, msg: string) => problems.push(`room ${type}: ${msg}`);
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const entryOk = (e: unknown) => !!e && typeof e === 'object' && num((e as { base: unknown }).base) && num((e as { perLevel: unknown }).perLevel);
  for (const t of [...BUILDABLE_TYPES, ...DISTRICT_KINDS]) if (!types.has(t)) bad(t, 'listed as buildable or district but has no definition');
  for (const [type, def] of Object.entries(BUILDING_DEFS) as [string, BuildingDef][]) {
    for (const lang of ['he', 'en']) {
      if (typeof def.name?.[lang] !== 'string' || !def.name[lang].trim()) bad(type, `name.${lang} is empty`);
      if (typeof def.description?.[lang] !== 'string' || !def.description[lang].trim()) bad(type, `description.${lang} is empty`);
    }
    if (!(def.maxLevel >= 1) || !Number.isInteger(def.maxLevel)) bad(type, `maxLevel ${def.maxLevel} is not a positive integer`);
    if (!(def.maxWorkers >= 0) || !Number.isInteger(def.maxWorkers)) bad(type, `maxWorkers ${def.maxWorkers} is not a non-negative integer`);
    if (!(def.constructionTime >= 0) || !(def.costMultiplier >= 1)) bad(type, 'constructionTime/costMultiplier out of range');
    for (const [r, v] of Object.entries(def.baseCost ?? {})) if (!known.has(r) || !(v >= 0)) bad(type, `baseCost ${r}=${v} is not a real resource amount`);
    for (const [r, e] of Object.entries(def.production ?? {})) if (!known.has(r) || !entryOk(e)) bad(type, `production ${r} is not a real resource entry`);
    if (def.slots !== undefined && (!Number.isInteger(def.slots) || def.slots < 1 || def.slots > 5)) bad(type, `slots ${def.slots} must be an integer 1-5`);
    if (def.maxCopies !== undefined && (!Number.isInteger(def.maxCopies) || def.maxCopies < 1)) bad(type, `maxCopies ${def.maxCopies} must be an integer >= 1`);
    if (def.shape !== undefined && (!['daylight', 'wind'].includes(def.shape) || !def.production)) bad(type, `shape ${def.shape} needs 'daylight' or 'wind' and a production`);
    if (def.priceByAct !== undefined && typeof def.priceByAct !== 'boolean') bad(type, 'priceByAct must be a boolean');
    const pl = def.place;
    if (pl) {
      if (pl.floors !== undefined && !PLACE_FLOORS.includes(pl.floors)) bad(type, `place.floors ${pl.floors} is not one of ${PLACE_FLOORS.join('/')}`);
      if (pl.adjacentTo !== undefined && (!types.has(pl.adjacentTo) || pl.adjacentTo === type)) bad(type, `place.adjacentTo ${pl.adjacentTo} is not another known room`);
      if (pl.needsFlag !== undefined && (typeof pl.needsFlag !== 'string' || !pl.needsFlag.trim())) bad(type, 'place.needsFlag is empty');
      if (pl.minFloor !== undefined && (!Number.isInteger(pl.minFloor) || pl.minFloor < -1)) bad(type, `place.minFloor ${pl.minFloor} must be an integer >= -1`);
      if (pl.floors === 'surface' && (pl.minFloor ?? -1) !== -1) bad(type, 'a surface room cannot have a minFloor above the surface row');
      if (isDistrict(type as BuildingType) && pl.floors) bad(type, 'districts are dug, not placed: no place.floors');
    }
    const fx = def.effects;
    if (fx) {
      if (fx.moraleKind !== undefined && (!MORALE_KINDS.includes(fx.moraleKind) || !fx.morale)) bad(type, 'moraleKind needs base/comfort/culture and a morale effect');
      for (const k of ENTRY_EFFECTS) if ((fx as Record<string, unknown>)[k] !== undefined && !entryOk((fx as Record<string, unknown>)[k])) bad(type, `effects.${k} needs {base, perLevel} numbers`);
      if (fx.graduateStat !== undefined && (!fx.childCapacity || !(fx.graduateStat > 0))) bad(type, 'graduateStat needs childCapacity and a positive value');
      if (fx.expeditionTeams !== undefined && (!Array.isArray(fx.expeditionTeams) || fx.expeditionTeams.some((l, i, a) => !Number.isInteger(l) || l < 1 || l > def.maxLevel || (i > 0 && l <= a[i - 1])))) bad(type, 'expeditionTeams must be ascending levels within maxLevel');
      for (const k of ['evacuation', 'firebreak'] as const) if (fx[k] !== undefined && typeof fx[k] !== 'boolean') bad(type, `effects.${k} must be a boolean`);
      for (const r of Object.keys(fx.storageCap ?? {})) if (!known.has(r)) bad(type, `storageCap names unknown resource ${r}`);
    }
  }
  // One unlocking research node per room type: only the first counts in isBuildingUnlocked, a second would be dead data.
  const unlockers = new Map<string, string[]>();
  for (const r of RESEARCH) for (const e of r.effects) if (e.type === 'unlock') unlockers.set(e.building, [...(unlockers.get(e.building) ?? []), r.id]);
  for (const [type, nodes] of unlockers) {
    if (!types.has(type)) problems.push(`research ${nodes.join(',')}: unlocks unknown room ${type}`);
    else if (nodes.length > 1) bad(type, `unlocked by ${nodes.length} research nodes (${nodes.join(', ')}): only the first counts`);
  }
  // Chain inputs: real rooms, real resources, sane rates.
  for (const [type, inputs] of Object.entries(CHAIN_INPUTS)) {
    if (!types.has(type)) problems.push(`chains: ${type} is not a room`);
    for (const i of inputs ?? []) if (!known.has(i.resource) || !(i.base >= 0) || !(i.perLevel >= 0)) bad(type, `chain input ${i.resource} is not a real resource or has a negative rate`);
  }
  return problems;
}

/**
 * [plan4:BL-8] The effect readers have identity defaults: on a bunker of today's rooms every reader returns 1 / 0 (and morale is the old canteen sum).
 * Then one fake room that has every effect and rule is added to BUILDING_DEFS for a moment to prove the readers and placeBlock act on it.
 */
export function effectHookProblems(): string[] {
  const problems: string[] = [];
  const s = createInitialState();
  s.currentFloors = 8;
  const mk = (id: string, type: string, floor: number, x: number, level = 1) => ({ id, type: type as BuildingType, level, position: { x, y: 0, floor }, assignedSurvivorIds: [] as string[], constructionProgress: 0, constructionTotal: 0, isConstructing: false, specialization: null });
  s.buildings = [mk('a', 'generator', 2, 0, 3), mk('b', 'canteen', 0, 0, 2), mk('c', 'medbay', 0, 2, 2), mk('d', 'atrium', 1, 0, 2), mk('e', 'storage', 0, 4)];
  const ident: [string, number, number][] = [
    ['earlyWarningLead', earlyWarningLead(s), 0], ['expeditionTeamsBonus', expeditionTeamsBonus(s), 0], ['cargoMult', cargoMult(s), 1],
    ['returnSafetyMult', returnSafetyMult(s), 1], ['hygieneMult', hygieneMult(s), 1], ['mourningMult', mourningMult(s), 1],
    ['quarantineCapacity', quarantineCapacity(s), 0], ['ventilationRelief', ventilationRelief(s), 0], ['evacuationMult', evacuationMult(s, 2), 1],
    ['roomChildGrowth', roomChildGrowth(s), 1],
  ];
  for (const [name, got, want] of ident) if (got !== want) problems.push(`effects: ${name} is ${got} with no effect rooms, expected ${want} (identity)`);
  const m = moraleBreakdown(s);
  if (m.channels.comfort.raw !== 0 || m.channels.culture.raw !== 0) problems.push("morale: comfort/culture channels are not empty with today's rooms");
  if (m.total !== Math.min(22, m.channels.base.raw)) problems.push(`morale: total ${m.total} is not min(22, base ${m.channels.base.raw})`);

  const defs = BUILDING_DEFS as Record<string, BuildingDef>;
  const base = defs.canteen;
  const probe = '__lintProbe';
  try {
    defs[probe] = {
      ...base, maxWorkers: 0, slots: 2, maxCopies: 1, place: { floors: 'deep', needsFlag: 'lint:flag', minFloor: 4, adjacentTo: 'storage' as BuildingType },
      effects: { morale: { base: 3, perLevel: 1 }, moraleKind: 'culture', childCapacity: { base: 4, perLevel: 2 }, childGrowth: { base: 1.25, perLevel: 0.05 },
        earlyWarning: { base: 30, perLevel: 30 }, expeditionTeams: [3, 8], cargo: { base: 0.05, perLevel: 0.05 }, returnSafety: { base: 0.04, perLevel: 0.04 },
        hygiene: { base: 0.04, perLevel: 0.04 }, mourning: { base: 0.1, perLevel: 0.1 }, quarantine: { base: 4, perLevel: 1 }, ventilation: { base: 2, perLevel: 1 }, evacuation: true },
    };
    s.buildings = [...s.buildings, mk('p', probe, 5, 6, 3)];
    const got = { warn: earlyWarningLead(s), teams: expeditionTeamsBonus(s), cargo: cargoMult(s), safe: returnSafetyMult(s), hyg: hygieneMult(s), mourn: mourningMult(s), q: quarantineCapacity(s), vent: ventilationRelief(s), evac: evacuationMult(s, 4), far: evacuationMult(s, 0), grow: roomChildGrowth(s) };
    const want = { warn: 90, teams: 1, cargo: 1.15, safe: 0.88, hyg: 0.88, mourn: 0.7, q: 6, vent: 4, evac: 0.6, far: 1, grow: 1.35 };
    for (const k of Object.keys(want) as (keyof typeof want)[]) if (Math.abs(got[k] - want[k]) > 1e-9) problems.push(`effects: probe room ${k} = ${got[k]}, expected ${want[k]}`);
    const mm = moraleBreakdown(s);
    if (Math.abs(mm.channels.culture.raw - 5) > 1e-9 || mm.channels.base.raw !== m.channels.base.raw) problems.push('morale: a culture room did not feed the culture channel only');
    // Placement rules on a fresh bunker with a storage to touch.
    const t = createInitialState();
    t.currentFloors = 10;
    t.buildings = [mk('s', 'storage', 5, 0)];
    const bs = new BuildingSystem();
    const at = (floor: number, x: number) => bs.placeBlock(probe as BuildingType, { x, y: 0, floor }, t);
    if (at(5, 3) !== 'locked') problems.push(`placement: probe without its flag gave ${at(5, 3)}, expected locked`);
    t.storyFlags.push('lint:flag');
    const rules: [number, number, string | null][] = [[5, 3, null], [5, 6, 'adjacency'], [3, 3, 'zone'], [4, 3, 'adjacency'], [0, 0, 'zone']];
    for (const [f, x, want2] of rules) if ((at(f, x) ?? null) !== want2) problems.push(`placement: probe at floor ${f} slot ${x} gave ${at(f, x)}, expected ${want2}`);
    t.buildings = [...t.buildings, mk('q', probe, 5, 3)];
    if (bs.placeBlock(probe as BuildingType, { x: 8, y: 0, floor: 6 }, t) !== 'copies') problems.push('placement: maxCopies was not enforced');
    // Costs: an Act price multiplier only for rooms that ask.
    defs[probe].priceByAct = true;
    t.longGame.meta.act = 5;
    t.buildings = [];
    const priced = bs.getBuildCost(probe as BuildingType, t).materials;
    if (priced !== Math.ceil((base.baseCost.materials ?? 0) * 3)) problems.push(`cost: priceByAct in Act 5 gave ${priced}, expected x3 of ${base.baseCost.materials}`);
    if (bs.getBuildCost('canteen' as BuildingType, t).materials !== base.baseCost.materials) problems.push('cost: a room without priceByAct changed price in Act 5');
    // Children: only into a room with childCapacity, in a count of their own; adults never take a child's place (and vice versa).
    {
      const sm = new StateManager();
      const pop = new PopulationSystem();
      const rng = new SeededRandom(7);
      const kid = { ...pop.createSurvivor(rng), id: 's_k1', child: true };
      const adult = { ...pop.createSurvivor(rng), id: 's_a1' };
      sm.applyDelta({ path: 'buildings', value: [mk('n', probe, 5, 0), mk('w', 'canteen', 0, 0)] });
      sm.applyDelta({ path: 'survivors', value: [kid, adult] });
      if (!pop.assignSurvivorToBuilding(sm, kid.id, 'n')) problems.push('children: a child could not be placed in a room with childCapacity');
      if (pop.assignSurvivorToBuilding(sm, kid.id, 'w')) problems.push('children: a child was placed in a room without childCapacity');
      if (pop.assignSurvivorToBuilding(sm, adult.id, 'n')) problems.push('children: an adult took a place in a room with no workers');
    }
  } finally {
    delete defs[probe];
  }
  return problems;
}

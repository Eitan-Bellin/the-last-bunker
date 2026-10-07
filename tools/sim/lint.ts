// Data checks for CI (run by tools/sim/lint.mjs): research is a sound DAG, every cost names a real resource,
// every resource has a name in both languages, and every upgrade and dig of Acts II-VII fits in storage (L2).
import { RESEARCH } from '../../src/data/research';
import { BUILDING_DEFS } from '../../src/data/buildingDefs';
import { ALL_RESOURCES, RESOURCES } from '../../src/data/resources';
import type { BuildingType, GameState, ResourceType } from '../../src/core/GameState';
import { createInitialState, floorExtent, migrateState } from '../../src/core/GameState';
import { ACTS } from '../../src/data/acts';
import { TUNING } from '../../src/data/tuning';
import { BOOK, HELP_TOPICS } from '../../src/data/book';
import { CHAPTERS } from '../../src/data/story';
import { BuildingSystem } from '../../src/systems/BuildingSystem';
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
 * [plan4:QA-3] NON-FAILING report: places that still derive the floor from a Y coordinate (`/ FLOOR_H`) or assume a fixed slot count
 * (`SLOTS_PER_FLOOR`) outside rendering/geom.ts. The redesign (variable floor heights and widths) must route all of these through geom.ts;
 * once the count reaches 0 a later wave turns the report into a gate (return the lines as problems instead of warnings).
 */
export function legacyGeometryWarnings(files: { rel: string; text: string }[]): string[] {
  const hits: string[] = [];
  for (const { rel, text } of files) {
    if (rel === 'rendering/geom.ts') continue;
    text.split('\n').forEach((line: string, i: number) => {
      if (/\/\s*FLOOR_H\b/.test(line)) hits.push(`${rel}:${i + 1}: reverse floor lookup "/ FLOOR_H"`);
      if (/\bSLOTS_PER_FLOOR\b/.test(line)) hits.push(`${rel}:${i + 1}: SLOTS_PER_FLOOR`);
    });
  }
  return hits;
}

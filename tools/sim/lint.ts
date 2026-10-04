// Data checks for CI (run by tools/sim/lint.mjs): research is a sound DAG, every cost names a real resource,
// every resource has a name in both languages, and every upgrade and dig of Acts II-VII fits in storage (L2).
import { RESEARCH } from '../../src/data/research';
import { BUILDING_DEFS } from '../../src/data/buildingDefs';
import { ALL_RESOURCES, RESOURCES } from '../../src/data/resources';
import type { BuildingType, ResourceType } from '../../src/core/GameState';
import { createInitialState } from '../../src/core/GameState';
import { ACTS } from '../../src/data/acts';
import { TUNING } from '../../src/data/tuning';
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
    const prev = act.id > 1 ? ACTS[act.id - 2].floorCap : 3;
    for (let floors = prev; floors < act.floorCap; floors++) {
      s.currentFloors = floors;
      over(`dig to B${floors + 1}`, bs.digCost(s));
    }
  }
  return problems;
}

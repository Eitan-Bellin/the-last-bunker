import { loreBonus } from '../data/lore';
import { projectQueueSlots, projectRefineDiscount, projectResourceBonus } from '../data/projects'; // [LateGame B1]
import type { BuildingType, GameState, ResourceType } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { ResourceSystem } from './ResourceSystem';
import { bus } from '../core/EventBus';
import {
  REFINEMENTS, REFINEMENT_STEP, RESEARCH, getRefinement, getResearch, refinementResearch, type ResearchDef,
} from '../data/research';
import { effectiveLevel, getDef } from '../data/buildingDefs';

export type ResearchStatus = 'done' | 'active' | 'queued' | 'available' | 'locked';

/** Queue slots after the active research: 1 at the start, +1 per "Second Lab Bench" prestige level. */
const BASE_QUEUE_SLOTS = 1;

export function isResearched(state: GameState, id: string): boolean {
  return !!state.research[id]?.completed;
}

function completedDefs(state: GameState): ResearchDef[] {
  return RESEARCH.filter(r => state.research[r.id]?.completed);
}

export function refinementLevel(state: GameState, id: string): number {
  return state.refinements?.[id] ?? 0;
}

/** Finished research, counting every Refinement level (the objectives' research track uses this). */
export function researchCount(state: GameState): number {
  return completedDefs(state).length + Object.values(state.refinements ?? {}).reduce((s, v) => s + v, 0);
}

export function researchResourceMult(state: GameState, resource: ResourceType): number {
  let m = 1;
  for (const r of completedDefs(state)) {
    for (const e of r.effects) if (e.type === 'resourceMult' && e.resource === resource) m += e.value;
  }
  for (const ref of REFINEMENTS) if (ref.resource === resource) m += REFINEMENT_STEP * refinementLevel(state, ref.id);
  m += projectResourceBonus(state, resource); // [LateGame B1] water purifier / greenhouse stages
  return m;
}

export function researchBuildingMult(state: GameState, building: BuildingType): number {
  let m = 1;
  for (const r of completedDefs(state)) {
    for (const e of r.effects) if (e.type === 'buildingMult' && e.building === building) m += e.value;
  }
  // Know-how recovered from the previous residents' notes and tapes.
  return m + loreBonus(state.lore, building);
}

export function researchCapBonus(state: GameState, resource: ResourceType): number {
  let v = 0;
  for (const r of completedDefs(state)) {
    for (const e of r.effects) if (e.type === 'cap' && e.resource === resource) v += e.value;
  }
  return v;
}

export function researchMorale(state: GameState): number {
  let v = 0;
  for (const r of completedDefs(state)) {
    for (const e of r.effects) if (e.type === 'morale') v += e.value;
  }
  return v;
}

export function hasFeature(state: GameState, feature: string): boolean {
  return completedDefs(state).some(r => r.effects.some(e => e.type === 'feature' && e.feature === feature));
}

/** A building is available when it has no research requirement or its unlocking research is done. */
export function isBuildingUnlocked(state: GameState, type: BuildingType): boolean {
  const unlocking = RESEARCH.find(r => r.effects.some(e => e.type === 'unlock' && e.building === type));
  return !unlocking || isResearched(state, unlocking.id);
}

export function unlockingResearch(type: BuildingType): ResearchDef | undefined {
  return RESEARCH.find(r => r.effects.some(e => e.type === 'unlock' && e.building === type));
}

/**
 * Research runs one node at a time, with a short queue behind it. Queued nodes are paid for when
 * queued (so a queue never stalls on resources while the player is away) and refunded if cancelled.
 * `update()` advances the queue itself, so the same code drives both live ticks and offline `simulate()`.
 */
export class ResearchSystem {
  private resources: ResourceSystem;

  constructor(resources: ResourceSystem) {
    this.resources = resources;
  }

  /** The node to research next for this id: fixed nodes as-is, refinements at their next level. */
  /** [Long game P3] Whether the node's Eureka condition is met (it is then cheaper and faster). */
  eureka(state: GameState, def: ResearchDef): boolean {
    const e = def.eureka;
    if (!e) return false;
    const have = e.kind === 'floors' ? state.currentFloors
      : e.kind === 'explored' ? state.explorationMap.filter(h => h.explored && h.biome !== 'bunker').length
      : e.kind === 'specialized' ? state.buildings.filter(b => b.specialization).length
      : e.kind === 'pop' ? state.survivors.length
      : e.kind === 'crises' ? state.stats.totalCrisesSurvived
      : e.kind === 'charters' ? state.storyFlags.filter(f => f.startsWith('project:')).length
      : (state.lore ?? []).length;
    return have >= e.n;
  }

  /** [Long game P3] Why a node is closed beyond its prerequisites: its Act has not come, or its fork took another path. */
  blockReason(state: GameState, id: string): 'act' | 'fork' | null {
    const def = getResearch(id);
    if (!def) return null;
    if (def.act && (state.longGame?.meta.act ?? 99) < def.act) return 'act';
    if (def.fork) {
      const pending = new Set([this.activeId(state), ...this.queue(state)]);
      const taken = RESEARCH.find(r => r.fork === def.fork && r.id !== id && (isResearched(state, r.id) || pending.has(r.id)));
      if (taken) return 'fork';
    }
    return null;
  }

  /** The node the fork's other choice took (for "closed by ..."). */
  forkTaken(state: GameState, id: string): ResearchDef | undefined {
    const def = getResearch(id);
    if (!def?.fork) return undefined;
    const pending = new Set([this.activeId(state), ...this.queue(state)]);
    return RESEARCH.find(r => r.fork === def.fork && r.id !== id && (isResearched(state, r.id) || pending.has(r.id)));
  }

  defOf(state: GameState, id: string): ResearchDef | undefined {
    const base = getResearch(id);
    if (base && !getRefinement(id) && this.eureka(state, base)) {
      return {
        ...base,
        cost: Object.fromEntries(Object.entries(base.cost).map(([r, v]) => [r, Math.round((v ?? 0) * 0.7)])),
        time: Math.round(base.time * 0.6),
      };
    }
    const ref = getRefinement(id);
    if (ref) {
      const def = refinementResearch(ref, refinementLevel(state, id));
      // [LateGame B1] knowledge archive: cheaper refinements
      const off = projectRefineDiscount(state);
      if (off <= 0) return def;
      return { ...def, cost: Object.fromEntries(Object.entries(def.cost).map(([r, v]) => [r, Math.round((v ?? 0) * (1 - off))])) };
    }
    return getResearch(id);
  }

  isRefinement(id: string): boolean {
    return !!getRefinement(id);
  }

  status(state: GameState, id: string): ResearchStatus {
    const node = state.research[id];
    if (node?.completed) return 'done';
    if (node?.isResearching) return 'active';
    if (this.queue(state).includes(id)) return 'queued';
    const def = this.defOf(state, id);
    if (!def || this.blockReason(state, id)) return 'locked';
    return def.requires.every(req => isResearched(state, req)) ? 'available' : 'locked';
  }

  activeId(state: GameState): string | null {
    for (const [id, node] of Object.entries(state.research)) if (node.isResearching) return id;
    return null;
  }

  queue(state: GameState): string[] {
    return state.researchQueue ?? [];
  }

  queueSlots(state: GameState): number {
    return BASE_QUEUE_SLOTS + (state.prestige.upgrades['labBench'] ?? 0) + projectQueueSlots(state); // [LateGame B1] knowledge archive
  }

  /** Research points per second: labs speed it up, prestige upgrades shorten it. */
  speed(state: GameState): number {
    let labLevels = 0;
    for (const b of state.buildings) {
      if (b.type === 'laboratory') labLevels += Math.max(0, effectiveLevel(b)) * (b.assignedSurvivorIds.length > 0 ? 1 : 0.5);
    }
    const prestige = (1 + 0.1 * (state.prestige.upgrades['fastResearch'] ?? 0)) * (state.prestige.upgrades['ksScholar'] ? 1.3 : 1);
    return (1 + 0.25 * labLevels) * prestige;
  }

  /** Seconds until a queued (or the active) node finishes, at the current speed. */
  etaSeconds(state: GameState, id: string): number {
    const speed = this.speed(state);
    const active = this.activeId(state);
    let t = 0;
    if (active) {
      const node = state.research[active];
      t += (node.total - node.progress) / speed;
      if (active === id) return t;
    }
    for (const q of this.queue(state)) {
      t += (this.defOf(state, q)?.time ?? 0) / speed;
      if (q === id) return t;
    }
    return t;
  }

  /** Requirements count as met when they are done, active, or queued ahead. */
  private requirementsMet(state: GameState, def: ResearchDef): boolean {
    const pending = new Set([this.activeId(state), ...this.queue(state)]);
    return def.requires.every(req => isResearched(state, req) || pending.has(req));
  }

  /** True when the node can begin now, or be added to the queue behind the active one. */
  canStart(state: GameState, id: string): boolean {
    const def = this.defOf(state, id);
    if (!def || state.research[id]?.completed || state.research[id]?.isResearching || this.queue(state).includes(id)) return false;
    if (!this.requirementsMet(state, def) || this.blockReason(state, id)) return false;
    if (this.activeId(state) && this.queue(state).length >= this.queueSlots(state)) return false;
    return this.resources.canAfford(state, def.cost as Record<string, number>);
  }

  /** Starts the node, or queues it if something is already being researched. */
  start(sm: StateManager, id: string): boolean {
    const state = sm.state;
    const def = this.defOf(state, id);
    if (!def || !this.canStart(state, id)) return false;
    this.resources.spend(sm, def.cost as Record<string, number>);
    if (this.activeId(sm.state)) {
      sm.applyDelta({ path: 'researchQueue', value: [...this.queue(sm.state), id] });
      sm.applyDelta({ path: 'researchPaid', value: { ...(sm.state.researchPaid ?? {}), [id]: { ...def.cost } as Record<string, number> } });
    } else {
      this.begin(sm, id, def);
    }
    return true;
  }

  /** Removes a queued node (refunding it) and anything queued behind it that depended on it. */
  cancelQueued(sm: StateManager, id: string): boolean {
    if (!this.queue(sm.state).includes(id)) return false;
    let queue = this.queue(sm.state);
    const dropped = [id];
    queue = queue.filter(q => q !== id);
    // Cascade: later items whose requirements are no longer met by done/active/earlier-queued work.
    for (let changed = true; changed;) {
      changed = false;
      const active = this.activeId(sm.state);
      for (let i = 0; i < queue.length; i++) {
        const def = this.defOf(sm.state, queue[i]);
        const ahead = new Set([active, ...queue.slice(0, i)]);
        if (def && def.requires.every(r => isResearched(sm.state, r) || ahead.has(r))) continue;
        dropped.push(queue[i]);
        queue = queue.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
    for (const d of dropped) this.refund(sm, d);
    sm.applyDelta({ path: 'researchQueue', value: queue });
    return true;
  }

  private begin(sm: StateManager, id: string, def: ResearchDef): void {
    sm.applyDelta({
      path: 'research',
      value: { ...sm.state.research, [id]: { id, completed: false, progress: 0, total: def.time, isResearching: true } },
    });
  }

  /** Advances research by dt seconds; time left over after a finish flows into the next queued node. */
  update(sm: StateManager, dt: number): void {
    let remaining = dt;
    for (let guard = 0; remaining > 0 && guard < 20; guard++) {
      const state = sm.state;
      const id = this.activeId(state);
      if (!id) {
        if (!this.startNextQueued(sm)) return;
        continue;
      }
      const speed = this.speed(state);
      const node = state.research[id];
      const needed = (node.total - node.progress) / speed;
      if (needed > remaining) {
        sm.applyDelta({ path: `research.${id}.progress`, value: node.progress + remaining * speed });
        return;
      }
      remaining -= needed;
      this.complete(sm, id);
      this.startNextQueued(sm);
    }
  }

  private complete(sm: StateManager, id: string): void {
    const state = sm.state;
    const node = state.research[id];
    if (this.isRefinement(id)) {
      // Repeatable: bank the level and leave the node ready for the next one.
      sm.applyDelta({ path: 'refinements', value: { ...(state.refinements ?? {}), [id]: refinementLevel(state, id) + 1 } });
      sm.applyDelta({ path: 'research', value: { ...sm.state.research, [id]: { ...node, progress: 0, isResearching: false, completed: false } } });
    } else {
      sm.applyDelta({ path: 'research', value: { ...state.research, [id]: { ...node, progress: node.total, isResearching: false, completed: true } } });
    }
    bus.emit('research:complete', id);
  }

  /** Gives back what a queued node was paid (its current price for nodes queued before this was recorded). */
  private refund(sm: StateManager, id: string): void {
    const paid = sm.state.researchPaid?.[id] ?? this.defOf(sm.state, id)?.cost;
    if (paid) this.resources.gain(sm, paid);
    this.forgetPaid(sm, id);
  }

  private forgetPaid(sm: StateManager, id: string): void {
    const all = sm.state.researchPaid;
    if (!all || !(id in all)) return;
    const { [id]: _gone, ...rest } = all;
    sm.applyDelta({ path: 'researchPaid', value: rest });
  }

  /** Moves the head of the queue into the lab (already paid for). */
  private startNextQueued(sm: StateManager): boolean {
    const queue = [...this.queue(sm.state)];
    while (queue.length > 0) {
      const next = queue.shift()!;
      sm.applyDelta({ path: 'researchQueue', value: [...queue] });
      const def = this.defOf(sm.state, next);
      if (def && !sm.state.research[next]?.completed && def.requires.every(r => isResearched(sm.state, r))) {
        this.forgetPaid(sm, next);
        this.begin(sm, next, def);
        return true;
      }
      // Can't run (should not happen: the queue keeps prerequisites ahead): refund and drop it.
      this.refund(sm, next);
    }
    return false;
  }

  /** Buildings that exist and are unlocked; used to hide a type's def lookups for the UI. */
  buildingName(type: BuildingType, locale: string): string {
    const def = getDef(type);
    return def?.name[locale] ?? def?.name.en ?? type;
  }
}

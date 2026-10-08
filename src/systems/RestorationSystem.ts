import type { GameState, ResourceType, Ruin, SurvivorState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { SeededRandom } from '../core/Random';
import { bus } from '../core/EventBus';
import { MAX_RUIN_WORKERS, RUIN_KINDS, ruinCost } from '../data/ruins';
import { effectiveLevel, getDef } from '../data/buildingDefs';
import type { ResourceSystem } from './ResourceSystem';
import type { BuildingSystem } from './BuildingSystem';
import { pruneOrphanDoors } from './doors'; // [plan4:polish]

export interface RuinClearedInfo {
  ruin: Ruin;
  loot: Partial<Record<ResourceType, number>>;
  buildingId: string | null;
  lore: string | null;
}

export type RuinBlock = 'needsPump' | null;

/**
 * Winning the bunker back: survivors clear collapsed, abandoned and flooded areas by hand.
 * Clearing pays out salvage, sometimes a piece of the previous residents' story,
 * and wrecked rooms come back as working rooms.
 */
export class RestorationSystem {
  private sm: StateManager;
  private rng: SeededRandom;
  private resources: ResourceSystem;
  private buildings: BuildingSystem;

  constructor(sm: StateManager, rng: SeededRandom, resources: ResourceSystem, buildings: BuildingSystem) {
    this.sm = sm;
    this.rng = rng;
    this.resources = resources;
    this.buildings = buildings;
  }

  ruinAt(state: GameState, floor: number, x: number): Ruin | undefined {
    return state.ruins.find(r => r.floor === floor && x >= r.x && x < r.x + r.w);
  }

  workers(state: GameState, ruinId: string): SurvivorState[] {
    return state.survivors.filter(s => s.assignedBuildingId === ruinId && !s.isOnMission);
  }

  blockReason(state: GameState, ruin: Ruin): RuinBlock {
    if (ruin.flooded && !state.buildings.some(b => b.type === 'waterPump' && effectiveLevel(b) > 0)) return 'needsPump';
    return null;
  }

  cost(ruin: Ruin): Partial<Record<ResourceType, number>> {
    return ruinCost(ruin);
  }

  canStart(state: GameState, ruin: Ruin): boolean {
    if (ruin.started || this.blockReason(state, ruin)) return false;
    return this.resources.canAfford(state, this.cost(ruin) as Record<string, number>);
  }

  /** Work rate of one survivor: strength and a couple of traits matter. */
  private rate(s: SurvivorState): number {
    let r = 1 + (s.stats.strength - 5) * 0.06 + (s.stats.endurance - 5) * 0.02;
    if (s.traits.includes('tough')) r *= 1.2;
    if (s.traits.includes('lazy')) r *= 0.6;
    if (s.traits.includes('scavenger')) r *= 1.1;
    return Math.max(0.4, r);
  }

  speed(state: GameState, ruin: Ruin): number {
    return this.workers(state, ruin.id).reduce((sum, s) => sum + this.rate(s), 0);
  }

  secondsLeft(state: GameState, ruin: Ruin): number {
    const sp = this.speed(state, ruin);
    return sp > 0 ? (ruin.total - ruin.progress) / sp : Infinity;
  }

  /** Pays the cost and sends the best idle hands (or the given survivors) to work. */
  start(ruinId: string, survivorIds?: string[]): boolean {
    const state = this.sm.state;
    const ruin = state.ruins.find(r => r.id === ruinId);
    if (!ruin || !this.canStart(state, ruin)) return false;
    this.resources.spend(this.sm, this.cost(ruin) as Record<string, number>);
    this.sm.applyDelta({ path: 'ruins', value: state.ruins.map(r => (r.id === ruinId ? { ...r, started: true } : r)) });
    const ids = survivorIds ?? this.pickIdle(this.sm.state, MAX_RUIN_WORKERS);
    for (const id of ids) this.assign(ruinId, id);
    bus.emit('ruin:started', ruinId);
    return true;
  }

  pickIdle(state: GameState, n: number): string[] {
    const idle = state.survivors
      .filter(s => !s.assignedBuildingId && !s.isOnMission && s.health > 20)
      .sort((a, b) => this.rate(b) - this.rate(a))
      .slice(0, n)
      .map(s => s.id);
    if (idle.length >= n || (state.era ?? 0) > 0) return idle;
    if (idle.length > 0) return idle;
    // M7: in the Remnant a started ruin must never sit without hands (the beds are full, nobody new can come).
    // With nobody idle, borrow one worker: from a room with a second worker first, food, water and power last.
    const vital = (t: string) => (t === 'farm' || t === 'waterPump' || t === 'generator' ? 1 : 0);
    const staffed = state.buildings
      .filter(b => b.assignedSurvivorIds.length > 0)
      .sort((a, b) => vital(a.type) - vital(b.type) || b.assignedSurvivorIds.length - a.assignedSurvivorIds.length);
    const id = staffed.flatMap(b => b.assignedSurvivorIds).find(x => {
      const s = state.survivors.find(v => v.id === x);
      return !!s && !s.isOnMission && !s.child && s.health > 20;
    });
    return id ? [id] : [];
  }

  /** Started ruins that nobody is working on. */
  private handless(state: GameState, except?: string): Ruin[] {
    return state.ruins.filter(r => r.started && r.id !== except && this.workers(state, r.id).length === 0);
  }

  canAssign(state: GameState, ruinId: string): boolean {
    const ruin = state.ruins.find(r => r.id === ruinId);
    return !!ruin && ruin.started && this.workers(state, ruinId).length < MAX_RUIN_WORKERS;
  }

  /** Moves a survivor onto clearing duty (leaving any room job). */
  assign(ruinId: string, survivorId: string): boolean {
    const state = this.sm.state;
    if (!this.canAssign(state, ruinId)) return false;
    const s = state.survivors.find(x => x.id === survivorId);
    if (!s || s.isOnMission) return false;
    this.sm.applyDelta({
      path: 'buildings',
      value: state.buildings.map(b => (b.assignedSurvivorIds.includes(survivorId)
        ? { ...b, assignedSurvivorIds: b.assignedSurvivorIds.filter(id => id !== survivorId) } : b)),
    });
    this.sm.applyDelta({
      path: 'survivors',
      value: this.sm.state.survivors.map(x => (x.id === survivorId ? { ...x, assignedBuildingId: ruinId } : x)),
    });
    return true;
  }

  unassign(survivorId: string): void {
    this.sm.applyDelta({
      path: 'survivors',
      value: this.sm.state.survivors.map(x => (x.id === survivorId && x.assignedBuildingId?.startsWith('r_') ? { ...x, assignedBuildingId: null } : x)),
    });
  }

  update(dt: number): void {
    const state = this.sm.state;
    if (state.ruins.length === 0) return;
    let changed = false;
    const done: Ruin[] = [];
    const next = state.ruins.map(r => {
      if (!r.started) return r;
      const sp = this.speed(state, r);
      if (sp <= 0) return r;
      changed = true;
      const progress = r.progress + sp * dt;
      if (progress >= r.total) {
        done.push(r);
        return { ...r, progress: r.total };
      }
      return { ...r, progress };
    });
    if (changed) this.sm.applyDelta({ path: 'ruins', value: next });
    for (const r of done) this.complete(r);
  }

  private roll(range: [number, number]): number {
    return Math.round(range[0] + this.rng.next() * (range[1] - range[0]));
  }

  private complete(ruin: Ruin): void {
    const state = this.sm.state;
    const workers = this.workers(state, ruin.id).map(s => s.id);
    this.sm.applyDelta({ path: 'ruins', value: state.ruins.filter(r => r.id !== ruin.id) });
    this.sm.applyDelta({ path: 'ruinsCleared', value: (state.ruinsCleared ?? 0) + 1 });

    const loot: Partial<Record<ResourceType, number>> = {};
    const scale = ruin.w / 2;
    for (const [res, range] of Object.entries(RUIN_KINDS[ruin.kind].loot) as [ResourceType, [number, number]][]) {
      const v = Math.round(this.roll(range) * scale);
      if (v > 0) loot[res] = v;
    }
    this.resources.gain(this.sm, loot);

    let buildingId: string | null = null;
    if (ruin.restoresTo) {
      const b = this.buildings.placeBuilding(ruin.restoresTo, { x: ruin.x, y: 0, floor: ruin.floor }, this.sm);
      if (b) {
        buildingId = b.id;
        const idx = this.sm.state.buildings.findIndex(x => x.id === b.id);
        this.sm.applyDeltas([
          { path: `buildings.${idx}.isConstructing`, value: false },
          { path: `buildings.${idx}.constructionProgress`, value: b.constructionTotal },
          // [P2] A room the raiders wrecked comes back as it was.
          ...(ruin.restoresLevel ? [{ path: `buildings.${idx}.level`, value: ruin.restoresLevel }] : []),
          ...(ruin.restoresSpec ? [{ path: `buildings.${idx}.specialization`, value: ruin.restoresSpec }] : []),
        ]);
        this.buildings.recalculateMaxPopulation(this.sm);
      }
    }

    pruneOrphanDoors(this.sm); // [plan4:polish] a cleared ruin that does not come back leaves no door standing in the open

    // Workers stay on as the crew of the room they just restored (up to its capacity), the rest go idle.
    // M7: while another started ruin has no hands, the room keeps one crew member and the rest move on to it.
    const restored = buildingId ? this.sm.state.buildings.find(b => b.id === buildingId) : undefined;
    const waiting = this.handless(this.sm.state, ruin.id);
    const capacity = restored ? Math.min(getDef(restored.type)?.maxWorkers ?? 0, waiting.length > 0 ? 1 : Infinity) : 0;
    const crew = workers.slice(0, capacity);
    for (const id of workers) this.unassign(id);
    const spare = workers.filter(id => !crew.includes(id));
    for (const r of waiting) {
      while (spare.length > 0 && this.workers(this.sm.state, r.id).length < MAX_RUIN_WORKERS) this.assign(r.id, spare.shift()!);
    }
    if (restored && crew.length > 0) {
      this.sm.applyDelta({
        path: 'buildings',
        value: this.sm.state.buildings.map(b => (b.id === restored.id ? { ...b, assignedSurvivorIds: crew } : b)),
      });
      this.sm.applyDelta({
        path: 'survivors',
        value: this.sm.state.survivors.map(x => (crew.includes(x.id) ? { ...x, assignedBuildingId: restored.id } : x)),
      });
    }

    let lore: string | null = null;
    if (ruin.lore && !this.sm.state.lore.includes(ruin.lore)) {
      lore = ruin.lore;
      this.addLore(lore);
    }
    bus.emit('ruin:cleared', { ruin, loot, buildingId, lore, workers } as RuinClearedInfo & { workers: string[] });
  }

  addLore(id: string): void {
    const s = this.sm.state;
    if (s.lore.includes(id)) return;
    this.sm.applyDelta({ path: 'lore', value: [...s.lore, id] });
    this.sm.applyDelta({ path: 'loreUnread', value: [...(s.loreUnread ?? []), id] });
    bus.emit('lore:found', id);
  }

  markRead(id: string): void {
    const s = this.sm.state;
    if (!s.loreUnread?.includes(id)) return;
    this.sm.applyDelta({ path: 'loreUnread', value: s.loreUnread.filter(x => x !== id) });
  }
}

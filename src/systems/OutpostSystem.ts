import type { StateManager } from '../core/StateManager';
import type { GameState, ResourceType } from '../core/GameState';
import { bus } from '../core/EventBus';
import { BIOMES, type BiomeId } from '../data/surface';
import { ACT_CURRENCY, actPrice, refIncome } from '../data/pricing';
import { TUNING } from '../data/tuning';
import { hasFeature } from './ResearchSystem';
import type { ResourceSystem } from './ResourceSystem';
import type { ExplorationSystem } from './ExplorationSystem';

/** One outpost on the surface map. */
export interface Outpost {
  id: number;
  x: number;
  y: number;
  biome: string;
  /** World time it is finished (still building before it). */
  readyAt: number;
  /** Raided: it yields nothing until repaired. */
  damaged: boolean;
}

/** Outposts the Act allows (index = Act). */
const MAX_OUTPOSTS = [0, 0, 0, 2, 4, 6, 8, 8];

/**
 * [Long game P4] Outposts (long-game plan, pillar D): from Act III an explored area within reach can be claimed. An
 * outpost costs hours of the Act's income and takes hours to build, then sends home a share of the Act's currency and
 * what its ground holds (ruins give materials, caves water...), less the food and water its people eat. Raiders who beat
 * the bunker may hit an outpost too: a damaged one yields nothing until it is repaired. Runs on world time, also away.
 */
export class OutpostSystem {
  private sm: StateManager;
  private resources: ResourceSystem;
  private exploration: ExplorationSystem;
  private clock = 0;

  constructor(sm: StateManager, resources: ResourceSystem, exploration: ExplorationSystem) {
    this.sm = sm;
    this.resources = resources;
    this.exploration = exploration;
    bus.on('raid:resolved', (r: unknown) => {
      const key = (r as { key: string }).key;
      if (key === 'loseBig' || (key === 'loseSmall' && this.roll() < 0.5)) this.damageOne();
    });
  }

  list(state: GameState): Outpost[] {
    return (state.longGame?.world.outposts ?? []) as Outpost[];
  }

  at(state: GameState, x: number, y: number): Outpost | undefined {
    return this.list(state).find(o => o.x === x && o.y === y);
  }

  max(state: GameState): number {
    return MAX_OUTPOSTS[Math.min(MAX_OUTPOSTS.length - 1, state.longGame?.meta.act ?? 0)] + (hasFeature(state, 'expansionism') ? 2 : 0); // [P2-1]
  }

  cost(state: GameState): Record<string, number> {
    const act = state.longGame?.meta.act ?? 3;
    return actPrice(act, TUNING.outpostHours * Math.pow(1.1, this.list(state).length));
  }

  buildSeconds(state: GameState): number {
    return Math.round(TUNING.outpostBuildHours * 3600 * Math.pow(1.12, this.list(state).length));
  }

  repairCost(state: GameState): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [r, v] of Object.entries(this.cost(state))) out[r] = Math.round(v * 0.3);
    return out;
  }

  /** Why an outpost cannot be claimed here (null = it can). */
  block(state: GameState, x: number, y: number): 'act' | 'max' | 'explore' | 'reach' | 'taken' | 'home' | null {
    const hex = this.exploration.getHex(state, x, y);
    if (!hex || hex.biome === 'bunker') return 'home';
    if ((state.longGame?.meta.act ?? 0) < 3) return 'act';
    if (this.at(state, x, y)) return 'taken';
    if (this.list(state).length >= this.max(state)) return 'max';
    if (!hex.explored) return 'explore';
    if (!this.exploration.inReach(state, hex)) return 'reach';
    return null;
  }

  /** Claims the area (the caller has checked block() and pays cost()). */
  build(x: number, y: number): boolean {
    const state = this.sm.state;
    const lg = state.longGame;
    const hex = this.exploration.getHex(state, x, y);
    if (!lg || !hex || this.block(state, x, y)) return false;
    if (!this.resources.spend(this.sm, this.cost(state))) return false;
    const o: Outpost = { id: lg.world.seq + 1000 + this.list(state).length, x, y, biome: hex.biome, readyAt: lg.meta.worldT + this.buildSeconds(state), damaged: false };
    this.sm.applyDelta({ path: 'longGame.world.outposts', value: [...this.list(state), o] });
    bus.emit('outpost:start', o);
    return true;
  }

  repair(id: number): boolean {
    const state = this.sm.state;
    const o = this.list(state).find(x => x.id === id);
    if (!o || !o.damaged || !this.resources.spend(this.sm, this.repairCost(state))) return false;
    this.sm.applyDelta({ path: 'longGame.world.outposts', value: this.list(state).map(x => (x.id === id ? { ...x, damaged: false } : x)) });
    return true;
  }

  /** Per hour: what one working outpost sends home, and what its people eat and drink. */
  yieldPerHour(state: GameState, o: Outpost): Partial<Record<ResourceType, number>> {
    const act = state.longGame?.meta.act ?? 3;
    const out: Partial<Record<ResourceType, number>> = {};
    out[ACT_CURRENCY[act]] = refIncome(act) * TUNING.outpostYieldHours;
    const biome = BIOMES[o.biome as BiomeId];
    for (const [r, range] of Object.entries(biome?.loot ?? {}) as [ResourceType, [number, number]][]) {
      out[r] = (out[r] ?? 0) + ((range[0] + range[1]) / 2) * 6;
    }
    // [P2-1] The Expansionism doctrine: outposts yield 40% more (what they eat stays the same).
    if (hasFeature(state, 'expansionism')) for (const r of Object.keys(out) as ResourceType[]) out[r] = (out[r] ?? 0) * 1.4;
    out.food = (out.food ?? 0) - 6;
    out.water = (out.water ?? 0) - 6;
    return out;
  }

  private roll(): number {
    const lg = this.sm.state.longGame;
    const x = Math.sin((lg?.meta.worldT ?? 0) * 12.9898 + (lg?.world.seq ?? 0) * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  private damageOne(): void {
    const state = this.sm.state;
    const working = this.list(state).filter(o => !o.damaged && o.readyAt <= (state.longGame?.meta.worldT ?? 0));
    if (!working.length) return;
    const hit = working[Math.floor(this.roll() * working.length)];
    this.sm.applyDelta({ path: 'longGame.world.outposts', value: this.list(state).map(x => (x.id === hit.id ? { ...x, damaged: true } : x)) });
    bus.emit('outpost:damaged', hit);
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.clock < 60) return;
    const step = this.clock;
    this.clock = 0;
    const state = this.sm.state;
    const now = state.longGame?.meta.worldT ?? 0;
    const total: Partial<Record<ResourceType, number>> = {};
    for (const o of this.list(state)) {
      if (o.damaged || o.readyAt > now) continue;
      for (const [r, v] of Object.entries(this.yieldPerHour(state, o)) as [ResourceType, number][]) total[r] = (total[r] ?? 0) + v * step / 3600;
    }
    if (Object.keys(total).length) this.resources.gain(this.sm, total);
  }
}

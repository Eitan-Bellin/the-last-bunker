import { hasFeature } from './ResearchSystem';
import { seasonEffects } from '../data/seasons';
import type { BuildingInstance, GameState, ResourceType, ResourceState } from '../core/GameState';
import type { StateManager, StateDelta } from '../core/StateManager';
import { getDef, effectiveLevel, levelMultiplier, workforceMultiplier } from '../data/buildingDefs';
import { researchBuildingMult, researchCapBonus, researchResourceMult } from './ResearchSystem';
import { chainFactor, chainInputs, inputFed, inputRate } from '../data/chains';
import { incidentBlocks } from '../data/incidents';
import { specOf } from '../data/specializations';
import { BASE_CAPS, OVERFLOW_CREDITS, POWER_FLOOR, TICKED_RESOURCES } from '../data/resources';
import { modifierBreakdown, modifierProduct, prepareModifiers, registerModifier } from './modifiers';
import { difficultyOf } from '../data/difficulty';
import { actCapBonus } from '../data/pricing';

const EMERGENCY_EFFICIENCY = 0.25;
const FOOD_PER_SURVIVOR = 0.08;
const WATER_PER_SURVIVOR = 0.08;

// Blackout floors, base storage and overflow values live in the resource table (src/data/resources.ts).
export { BASE_CAPS, OVERFLOW_CREDITS } from '../data/resources';

/** S3: bigger rooms need more power: +50% of the base draw for every level above 1. */
export function roomPowerDraw(base: number, level: number): number {
  return level > 0 ? base * (1 + 0.5 * (level - 1)) : 0;
}

/** What the Projects system offers for overflow: returns how much of `amount` a project stage took (feature-detected). */
export interface OverflowAbsorber { absorb(state: GameState, resource: ResourceType, amount: number): number }

/** [Economy A4] Era 2+ storage x1.5, era 3 x2, so the bunker can save up for big projects. */
export function eraCapMultiplier(state: GameState): number {
  const era = state.era ?? 0;
  return era >= 3 ? 2 : era >= 2 ? 1.5 : 1;
}


// The output modifiers every room has always had (others register theirs from their own systems).
let moraleNow = 1;
registerModifier({
  id: 'morale',
  prepare: state => { moraleNow = moraleMultiplier(state); },
  // The grid does not care how the crew feels.
  mult: ({ resource }) => (resource === 'power' ? 1 : moraleNow),
});
registerModifier({ id: 'echo', mult: ({ state }) => prestigeMultiplier(state) });
// [P2] The season leans on food, water or materials.
registerModifier({
  id: 'season',
  mult: ({ state, resource }) => {
    const m = seasonEffects(state)?.output[resource] ?? 1;
    // [P3] Winter Stores (and the Mycelium doctrine) halve a season's food penalty.
    return m < 1 && resource === 'food' && hasFeature(state, 'winterStores') ? 1 - (1 - m) / 2 : m;
  },
});
// [Long game] A room that is changing its role produces nothing until the work is done.
registerModifier({ id: 'retool', mult: ({ state, building }) => (retooling(state, building) ? 0 : 1) });

export function retooling(state: GameState, b: BuildingInstance): boolean {
  return (b.retoolUntil ?? 0) > (state.longGame?.meta.worldT ?? 0);
}
registerModifier({ id: 'researchResource', mult: ({ state, resource }) => researchResourceMult(state, resource) });
registerModifier({ id: 'researchRoom', mult: ({ state, building }) => researchBuildingMult(state, building.type) });
registerModifier({
  id: 'blackout',
  mult: ({ resource, powerRatio }) => (resource === 'power' ? 1 : Math.max(powerRatio, POWER_FLOOR[resource] ?? 0)),
});

function moraleMultiplier(state: GameState): number {
  if (state.survivors.length === 0) return 1;
  const avg = state.survivors.reduce((sum, s) => sum + s.happiness, 0) / state.survivors.length;
  // S1: 0.75..1.5 (was 0.5..2.0); morale sat near 100 all game and was a free x2.
  return 0.75 + (avg / 100) * 0.75;
}

function prestigeMultiplier(state: GameState): number {
  const echoLevel = state.prestige.upgrades['echoPower'] ?? 0;
  return 1 + echoLevel * 0.1;
}

export class ResourceSystem {
  /** Late-game hook: resolves the Projects system lazily (it may not exist yet); set by GameEngine. */
  getAbsorber: (() => OverflowAbsorber | null | undefined) | null = null;
  /** Running totals of overflow since the last reset (the offline report reads and clears them). */
  overflowLog: Partial<Record<ResourceType, { converted: number; absorbed: number }>> = {};
  creditsMade = 0;

  update(sm: StateManager, dt: number): void {
    const state = sm.state;
    const caps = this.computeCaps(state);
    prepareModifiers(state);

    let powerProd = 0;
    let powerDemand = 0;
    // [P2] Winter heating.
    const seasonPower = hasFeature(state, 'geothermal') ? 1 : seasonEffects(state)?.powerDemand ?? 1;
    for (const b of state.buildings) {
      const level = effectiveLevel(b);
      const def = getDef(b.type);
      if (!def || level <= 0) continue;
      powerDemand += roomPowerDraw(def.powerConsumption, level) * seasonPower;
      const p = def.production?.power;
      if (p && !incidentBlocks(state, b)) powerProd += this.powerOutput(state, b, level);
    }

    const storedPower = state.resources.power.amount;
    const supplyRatio = storedPower > 0.01 || powerProd >= powerDemand
      ? 1
      : powerDemand > 0 ? powerProd / powerDemand : 1;
    // Unpowered rooms limp along on emergency effort so the bunker can never fully deadlock.
    const powerRatio = EMERGENCY_EFFICIENCY + (1 - EMERGENCY_EFFICIENCY) * supplyRatio;

    const production: Partial<Record<ResourceType, number>> = { power: powerProd };
    const consumption: Partial<Record<ResourceType, number>> = { power: powerDemand };

    for (const b of state.buildings) {
      const out = this.computeOutput(state, b, powerRatio);
      for (const [r, v] of Object.entries(out) as [ResourceType, number][]) {
        if (r === 'power') continue;
        production[r] = (production[r] ?? 0) + v;
      }
    }

    const appetite = difficultyOf(state).consumption;
    for (const s of state.survivors) {
      if (s.isOnMission) continue;
      const glutton = s.traits.includes('glutton') ? 2 : 1;
      const size = s.child ? 0.5 : 1;
      consumption.food = (consumption.food ?? 0) + FOOD_PER_SURVIVOR * glutton * size * appetite;
      consumption.water = (consumption.water ?? 0) + WATER_PER_SURVIVOR * size * appetite;
    }

    // Production chains draw their inputs; specialized rooms add their side products.
    for (const b of state.buildings) {
      if (effectiveLevel(b) <= 0 || incidentBlocks(state, b)) continue;
      for (const input of chainInputs(b)) {
        if (inputFed(state, input)) consumption[input.resource] = (consumption[input.resource] ?? 0) + inputRate(input, b);
      }
      const spec = specOf(b);
      // [Long game] Tier-2 roles grow with the room's level, slow down when starved, and stop while the room retools.
      const roleScale = spec?.levelScaled ? (effectiveLevel(b) / 5) * chainFactor(state, b) * (retooling(state, b) ? 0 : 1) : 1;
      for (const [r, v] of Object.entries(spec?.extra ?? {}) as [ResourceType, number][]) {
        production[r] = (production[r] ?? 0) + v * powerRatio * roleScale;
      }
    }

    const deltas: StateDelta[] = [];
    for (const rt of TICKED_RESOURCES) {
      const res = state.resources[rt];
      const prod = production[rt] ?? 0;
      const cons = consumption[rt] ?? 0;
      const cap = caps[rt] ?? res.cap;
      const raw = res.amount + (prod - cons) * dt;
      const newAmount = Math.max(0, Math.min(cap, raw));
      // [Economy A1/A3] Production beyond the cap is not thrown away: a project may absorb it first, the rest becomes credits.
      const over = Math.min(raw - cap, (prod - cons) * dt);
      if (over > 1e-9 && OVERFLOW_CREDITS[rt]) this.convertOverflow(state, rt, over, deltas);
      deltas.push(
        { path: `resources.${rt}.amount`, value: newAmount },
        { path: `resources.${rt}.productionRate`, value: prod },
        { path: `resources.${rt}.consumptionRate`, value: cons },
        { path: `resources.${rt}.cap`, value: cap },
      );
    }
    this.flushCredits(state, deltas);
    deltas.push({ path: 'powerRatio', value: powerRatio });
    if (production.food) {
      deltas.push({ path: 'stats.totalFoodProduced', value: state.stats.totalFoodProduced + production.food * dt });
    }
    sm.applyDeltas(deltas);
  }

  private pendingCredits = 0;

  private convertOverflow(state: GameState, rt: ResourceType, over: number, _deltas: StateDelta[]): void {
    let left = over;
    const log = (this.overflowLog[rt] ??= { converted: 0, absorbed: 0 });
    if (state.activeProjectId) {
      const used = this.getAbsorber?.()?.absorb(state, rt, left) ?? 0;
      if (used > 0) { left -= used; log.absorbed += used; }
    }
    if (left <= 0) return;
    log.converted += left;
    this.pendingCredits += left * (OVERFLOW_CREDITS[rt] ?? 0);
  }

  private flushCredits(state: GameState, deltas: StateDelta[]): void {
    if (this.pendingCredits <= 0) return;
    deltas.push({ path: 'resources.credits.amount', value: (state.resources.credits?.amount ?? 0) + this.pendingCredits });
    this.creditsMade += this.pendingCredits;
    this.pendingCredits = 0;
  }

  /**
   * [Long game UX] Where a resource comes from and where it goes, per second, grouped by room type (and "people"),
   * with the modifier stack of its biggest producer. Same formulas as update(); for the resource drawer.
   */
  breakdown(state: GameState, r: ResourceType): {
    sources: { key: string; value: number; count: number }[];
    sinks: { key: string; value: number; count: number }[];
    modifiers: { id: string; mult: number }[];
  } {
    prepareModifiers(state);
    const powerRatio = state.powerRatio ?? 1;
    const src = new Map<string, { value: number; count: number }>();
    const snk = new Map<string, { value: number; count: number }>();
    const add = (m: Map<string, { value: number; count: number }>, key: string, v: number) => {
      if (v <= 1e-6) return;
      const e = m.get(key) ?? { value: 0, count: 0 };
      e.value += v;
      e.count++;
      m.set(key, e);
    };
    let top: { b: BuildingInstance; v: number } | null = null;
    const seasonPower = hasFeature(state, 'geothermal') ? 1 : seasonEffects(state)?.powerDemand ?? 1;
    for (const b of state.buildings) {
      const level = effectiveLevel(b);
      const def = getDef(b.type);
      if (!def || level <= 0) continue;
      let v = 0;
      if (r === 'power') {
        if (def.production?.power && !incidentBlocks(state, b)) v = this.powerOutput(state, b, level);
        add(snk, b.type, roomPowerDraw(def.powerConsumption, level) * seasonPower);
      } else {
        v = this.computeOutput(state, b, powerRatio)[r] ?? 0;
      }
      const spec = specOf(b);
      const extra = spec?.extra?.[r];
      if (extra && !incidentBlocks(state, b)) {
        const roleScale = spec?.levelScaled ? (level / 5) * chainFactor(state, b) * (retooling(state, b) ? 0 : 1) : 1;
        v += extra * powerRatio * roleScale;
      }
      add(src, b.type, v);
      if (v > 0 && (!top || v > top.v)) top = { b, v };
      if (!incidentBlocks(state, b)) for (const input of chainInputs(b)) {
        if (input.resource === r && inputFed(state, input)) add(snk, b.type, inputRate(input, b));
      }
    }
    if (r === 'food' || r === 'water') {
      const appetite = difficultyOf(state).consumption;
      let people = 0;
      for (const s of state.survivors) {
        if (s.isOnMission) continue;
        const size = s.child ? 0.5 : 1;
        people += (r === 'food' ? FOOD_PER_SURVIVOR * (s.traits.includes('glutton') ? 2 : 1) : WATER_PER_SURVIVOR) * size * appetite;
      }
      if (people > 0) snk.set('people', { value: people, count: state.survivors.filter(s => !s.isOnMission).length });
    }
    const list = (m: Map<string, { value: number; count: number }>) => [...m.entries()].map(([key, e]) => ({ key, ...e })).sort((a, b) => b.value - a.value);
    const modifiers = top ? modifierBreakdown({ state, building: top.b, resource: r, powerRatio: r === 'power' ? 1 : powerRatio }) : [];
    return { sources: list(src), sinks: list(snk), modifiers };
  }

  /** Per-second output of one building under current conditions. */
  getBuildingOutput(state: GameState, building: BuildingInstance): Partial<Record<ResourceType, number>> {
    const level = effectiveLevel(building);
    if (level <= 0) return {};
    const def = getDef(building.type);
    if (incidentBlocks(state, building)) return {};
    prepareModifiers(state);
    if (def?.production?.power) return { power: this.powerOutput(state, building, level) };
    return this.computeOutput(state, building, state.powerRatio ?? 1);
  }

  /** What the room itself brings (crew, chain, specialization), before the modifiers. */
  private roomFactor(state: GameState, b: BuildingInstance): number {
    return workforceMultiplier(state, b) * chainFactor(state, b) * (specOf(b)?.outputMult ?? 1);
  }

  private powerOutput(state: GameState, b: BuildingInstance, level: number): number {
    const p = getDef(b.type)?.production?.power;
    if (!p) return 0;
    return p.base * levelMultiplier(p, level) * this.roomFactor(state, b) * modifierProduct({ state, building: b, resource: 'power', powerRatio: 1 });
  }

  private computeOutput(state: GameState, b: BuildingInstance, powerRatio: number): Partial<Record<ResourceType, number>> {
    const def = getDef(b.type);
    const level = effectiveLevel(b);
    if (!def?.production || level <= 0 || incidentBlocks(state, b)) return {};
    const room = this.roomFactor(state, b);
    const out: Partial<Record<ResourceType, number>> = {};
    for (const [r, entry] of Object.entries(def.production)) {
      if (r === 'power') continue;
      const resource = r as ResourceType;
      out[resource] = entry.base * levelMultiplier(entry, level) * room * modifierProduct({ state, building: b, resource, powerRatio });
    }
    return out;
  }

  computeCaps(state: GameState): Partial<Record<ResourceType, number>> {
    const caps = { ...BASE_CAPS };
    for (const r of Object.keys(caps) as ResourceType[]) caps[r] = (caps[r] ?? 0) + researchCapBonus(state, r);
    for (const b of state.buildings) {
      const level = effectiveLevel(b);
      for (const [r, v] of Object.entries(specOf(b)?.caps ?? {}) as [ResourceType, number][]) {
        if (level > 0) caps[r] = (caps[r] ?? 0) + v;
      }
      const extra = getDef(b.type)?.effects?.storageCap;
      if (!extra || level <= 0) continue;
      for (const [r, v] of Object.entries(extra)) {
        const key = r as ResourceType;
        caps[key] = (caps[key] ?? 0) + v * level;
      }
    }
    // [Progression hook] Storage Memory prestige upgrade (src/data/prestige.ts): +25% to every cap per level.
    for (const r of Object.keys(caps) as ResourceType[]) caps[r] = Math.round((caps[r] ?? 0) * (1 + 0.25 * (state.prestige.upgrades['storageMemory'] ?? 0)));
    // [Economy A4] Per-era storage multiplier (power is not stored in bulk, so it stays as is).
    const eraMult = eraCapMultiplier(state);
    if (eraMult > 1) for (const r of Object.keys(caps) as ResourceType[]) if (r !== 'power') caps[r] = Math.round((caps[r] ?? 0) * eraMult);
    // [Long game] L2: the Act's currencies hold a set number of hours of their reference income, so any price fits.
    for (const [r, v] of Object.entries(actCapBonus(state)) as [ResourceType, number][]) caps[r] = (caps[r] ?? 0) + v;
    return caps;
  }

  getMoraleMultiplier(state: GameState): number {
    return moraleMultiplier(state);
  }

  getPrestigeMultiplier(state: GameState): number {
    return prestigeMultiplier(state);
  }

  canAfford(state: GameState, costs: Record<string, number>): boolean {
    for (const [resource, amount] of Object.entries(costs)) {
      const res = state.resources[resource as ResourceType];
      if (!res || res.amount < amount) return false;
    }
    return true;
  }

  spend(sm: StateManager, costs: Record<string, number>): boolean {
    if (!this.canAfford(sm.state, costs)) return false;
    for (const [resource, amount] of Object.entries(costs)) {
      const current = sm.state.resources[resource as ResourceType].amount;
      sm.applyDelta({ path: `resources.${resource}.amount`, value: current - amount });
    }
    return true;
  }

  gain(sm: StateManager, gains: Partial<Record<ResourceType, number>>): void {
    for (const [resource, amount] of Object.entries(gains) as [ResourceType, number][]) {
      const res = sm.state.resources[resource];
      const cap = res.cap ?? Infinity;
      sm.applyDelta({ path: `resources.${resource}.amount`, value: Math.max(0, Math.min(cap, res.amount + amount)) });
    }
  }

  getResourceState(state: GameState, type: ResourceType): ResourceState {
    return state.resources[type];
  }
}

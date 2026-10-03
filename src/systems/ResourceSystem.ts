import type { BuildingInstance, GameState, ResourceType, ResourceState } from '../core/GameState';
import type { StateManager, StateDelta } from '../core/StateManager';
import { getDef, effectiveLevel, levelMultiplier, workforceMultiplier } from '../data/buildingDefs';
import { researchBuildingMult, researchCapBonus, researchResourceMult } from './ResearchSystem';
import { chainFactor, chainInputs, inputFed, inputRate } from '../data/chains';
import { incidentBlocks } from '../data/incidents';
import { specOf } from '../data/specializations';

const EMERGENCY_EFFICIENCY = 0.25;
/**
 * S3: in a blackout farms and pumps keep 70% and workshops 50% (hand tools), so a power shortage hurts
 * (labs, medicine, morale) without starving people or locking out the materials needed to fix it.
 */
const POWER_FLOOR: Partial<Record<ResourceType, number>> = { food: 0.7, water: 0.7, materials: 0.5 };
const FOOD_PER_SURVIVOR = 0.08;
const WATER_PER_SURVIVOR = 0.08;

export const BASE_CAPS: Partial<Record<ResourceType, number>> = {
  // M2: 300 materials so the first dig (180) always fits without a Storage Room.
  food: 150, water: 100, power: 50, materials: 300, medicine: 30, knowledge: 100, scrap: 200,
};

/** S3: bigger rooms need more power: +50% of the base draw for every level above 1. */
export function roomPowerDraw(base: number, level: number): number {
  return level > 0 ? base * (1 + 0.5 * (level - 1)) : 0;
}

/**
 * [Economy A1] Credits per unit of storage overflow. Power is not stored, so it never converts.
 * Medicine is rare so each unit is worth a lot; food and water are plentiful so they are worth little.
 */
export const OVERFLOW_CREDITS: Partial<Record<ResourceType, number>> = {
  food: 0.01, water: 0.01, materials: 0.03, knowledge: 0.05, medicine: 0.2, scrap: 0.03, // scrap has no table rate in the plan; treated like materials so late scrap overflow is not lost
};

/** What the Projects system offers for overflow: returns how much of `amount` a project stage took (feature-detected). */
export interface OverflowAbsorber { absorb(state: GameState, resource: ResourceType, amount: number): number }

/** [Economy A4] Era 2+ storage x1.5, era 3 x2, so the bunker can save up for big projects. */
export function eraCapMultiplier(state: GameState): number {
  const era = state.era ?? 0;
  return era >= 3 ? 2 : era >= 2 ? 1.5 : 1;
}

const TICKED_RESOURCES: ResourceType[] = ['food', 'water', 'power', 'materials', 'medicine', 'knowledge', 'scrap'];

export class ResourceSystem {
  /** Late-game hook: resolves the Projects system lazily (it may not exist yet); set by GameEngine. */
  getAbsorber: (() => OverflowAbsorber | null | undefined) | null = null;
  /** Running totals of overflow since the last reset (the offline report reads and clears them). */
  overflowLog: Partial<Record<ResourceType, { converted: number; absorbed: number }>> = {};
  creditsMade = 0;

  update(sm: StateManager, dt: number): void {
    const state = sm.state;
    const caps = this.computeCaps(state);
    const prestigeMult = this.getPrestigeMultiplier(state);

    let powerProd = 0;
    let powerDemand = 0;
    for (const b of state.buildings) {
      const level = effectiveLevel(b);
      const def = getDef(b.type);
      if (!def || level <= 0) continue;
      powerDemand += roomPowerDraw(def.powerConsumption, level);
      const p = def.production?.power;
      if (p && !incidentBlocks(state, b)) powerProd += p.base * levelMultiplier(p, level) * workforceMultiplier(state, b) * prestigeMult
        * researchResourceMult(state, 'power') * researchBuildingMult(state, b.type) * (specOf(b)?.outputMult ?? 1) * chainFactor(state, b);
    }

    const storedPower = state.resources.power.amount;
    const supplyRatio = storedPower > 0.01 || powerProd >= powerDemand
      ? 1
      : powerDemand > 0 ? powerProd / powerDemand : 1;
    // Unpowered rooms limp along on emergency effort so the bunker can never fully deadlock.
    const powerRatio = EMERGENCY_EFFICIENCY + (1 - EMERGENCY_EFFICIENCY) * supplyRatio;

    const production: Partial<Record<ResourceType, number>> = { power: powerProd };
    const consumption: Partial<Record<ResourceType, number>> = { power: powerDemand };

    const moraleMult = this.getMoraleMultiplier(state);
    for (const b of state.buildings) {
      const out = this.computeOutput(state, b, moraleMult, prestigeMult, powerRatio);
      for (const [r, v] of Object.entries(out) as [ResourceType, number][]) {
        if (r === 'power') continue;
        production[r] = (production[r] ?? 0) + v;
      }
    }

    for (const s of state.survivors) {
      if (s.isOnMission) continue;
      const glutton = s.traits.includes('glutton') ? 2 : 1;
      const size = s.child ? 0.5 : 1;
      consumption.food = (consumption.food ?? 0) + FOOD_PER_SURVIVOR * glutton * size;
      consumption.water = (consumption.water ?? 0) + WATER_PER_SURVIVOR * size;
    }

    // Production chains draw their inputs; specialized rooms add their side products.
    for (const b of state.buildings) {
      if (effectiveLevel(b) <= 0 || incidentBlocks(state, b)) continue;
      for (const input of chainInputs(b.type)) {
        if (inputFed(state, input)) consumption[input.resource] = (consumption[input.resource] ?? 0) + inputRate(input, b);
      }
      for (const [r, v] of Object.entries(specOf(b)?.extra ?? {}) as [ResourceType, number][]) {
        production[r] = (production[r] ?? 0) + v * powerRatio;
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

  /** Per-second output of one building under current conditions. */
  getBuildingOutput(state: GameState, building: BuildingInstance): Partial<Record<ResourceType, number>> {
    const level = effectiveLevel(building);
    if (level <= 0) return {};
    const def = getDef(building.type);
    if (incidentBlocks(state, building)) return {};
    if (def?.production?.power) {
      const p = def.production.power;
      return {
        power: p.base * levelMultiplier(p, level) * workforceMultiplier(state, building) * this.getPrestigeMultiplier(state)
          * researchResourceMult(state, 'power') * researchBuildingMult(state, building.type) * (specOf(building)?.outputMult ?? 1)
          * chainFactor(state, building),
      };
    }
    return this.computeOutput(state, building, this.getMoraleMultiplier(state), this.getPrestigeMultiplier(state), state.powerRatio ?? 1);
  }

  private computeOutput(
    state: GameState, b: BuildingInstance, moraleMult: number, prestigeMult: number, powerRatio: number,
  ): Partial<Record<ResourceType, number>> {
    const def = getDef(b.type);
    const level = effectiveLevel(b);
    if (!def?.production || level <= 0 || incidentBlocks(state, b)) return {};
    const workforce = workforceMultiplier(state, b) * chainFactor(state, b) * (specOf(b)?.outputMult ?? 1);
    const out: Partial<Record<ResourceType, number>> = {};
    for (const [r, entry] of Object.entries(def.production)) {
      if (r === 'power') continue;
      const power = Math.max(powerRatio, POWER_FLOOR[r as ResourceType] ?? 0);
      out[r as ResourceType] = entry.base * levelMultiplier(entry, level) * workforce * moraleMult * prestigeMult * power
        * researchResourceMult(state, r as ResourceType) * researchBuildingMult(state, b.type);
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
    return caps;
  }

  getMoraleMultiplier(state: GameState): number {
    if (state.survivors.length === 0) return 1;
    const avg = state.survivors.reduce((sum, s) => sum + s.happiness, 0) / state.survivors.length;
    // S1: 0.75..1.5 (was 0.5..2.0); morale sat near 100 all game and was a free x2.
    return 0.75 + (avg / 100) * 0.75;
  }

  getPrestigeMultiplier(state: GameState): number {
    const echoLevel = state.prestige.upgrades['echoPower'] ?? 0;
    return 1 + echoLevel * 0.1;
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

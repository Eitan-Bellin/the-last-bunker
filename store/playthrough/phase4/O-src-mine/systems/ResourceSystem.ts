import { hasMutator } from '../data/mutators';
import { lawAppetite, lawOutput } from '../data/laws';
import { hasFeature } from './ResearchSystem';
import { seasonEffects } from '../data/seasons';
import type { BuildingInstance, GameState, ResourceType, ResourceState } from '../core/GameState';
import type { StateManager, StateDelta } from '../core/StateManager';
import { getDef, effectiveLevel, levelMultiplier, shapeFactor, synergyTable, workforceMultiplier } from '../data/buildingDefs';
import { researchBuildingMult, researchCapBonus, researchResourceMult } from './ResearchSystem';
import { SURPLUS_BAND, SURPLUS_RESERVE, SURPLUS_DRAIN_SECONDS, chainFactor, chainInputs, inputFed, inputRate, surplusShare } from '../data/chains';
import { incidentBlocks } from '../data/incidents';
import { specOf } from '../data/specializations';
import { BASE_CAPS, OVERFLOW_CREDITS, POWER_FLOOR, TICKED_RESOURCES, resourceDef } from '../data/resources';
import { modifierBreakdown, modifierProduct, prepareModifiers, registerModifier } from './modifiers';
import { difficultyOf } from '../data/difficulty';
import { actCapBonus } from '../data/pricing';
import { TUNING } from '../data/tuning';
import { scenarioOf } from '../data/scenarios';
import { infraPowerDraw } from './InfraSystem'; // plan4:ST-14/15
import { isTier2 } from './economy';
import { moraleOutputMult, moraleRawAverage, worldClock } from './morale';
import { CONTRACT_CREDITS } from '../data/shop';
import { actCreditScale } from '../data/orders';

const EMERGENCY_EFFICIENCY = 0.25;
/**
 * [ux-wp2 R7] Stores that hold hours of production in Act I. Not materials: their overflow is what feeds the Vault Seal charter, and a
 * deeper store delayed Act I by half a day in the sim (the materials went to upgrades instead).
 */
const ACT1_BUFFERED: ResourceType[] = ['food', 'water', 'knowledge'];
/** [ux-wp2 R1] A reward may fill a store up to this many times its cap. */
export const OVERFILL_CAPS = 3;
const FOOD_PER_SURVIVOR = 0.08;
const WATER_PER_SURVIVOR = 0.08;

/**
 * [phase3] How much more a person eats and drinks in this Act than in Act I: TUNING.appetitePerAct per Act, the step to the new
 * Act coming in over TUNING.appetiteRampHours of world time.
 */
export function actAppetite(state: GameState): number {
  const meta = state.longGame?.meta;
  const act = Math.max(1, meta?.act ?? 1);
  if (act <= 1) return 1;
  const k = TUNING.appetitePerAct;
  const ramp = TUNING.appetiteRampHours > 0 ? Math.min(1, Math.max(0, ((meta?.worldT ?? 0) - (meta?.actSince ?? 0)) / (TUNING.appetiteRampHours * 3600))) : 1;
  return Math.pow(k, act - 2) * (1 + (k - 1) * ramp);
}

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
// [ux-wp2 M7] Scientific Memory (Genesis) also feeds the Act currencies: +5% per level.
registerModifier({ id: 'memory', mult: ({ state, resource }) => (isTier2(resource) ? 1 + 0.05 * (state.prestige.upgrades['fastResearch'] ?? 0) : 1) });
// [P3-5] The scenario's own rules (what grows well in this place and what does not).
registerModifier({ id: 'scenario', mult: ({ state, resource }) => scenarioOf(state).output?.[resource] ?? 1 });
// [P2-1] The Technocracy doctrine: every room +5%.
registerModifier({ id: 'technocracy', mult: ({ state }) => (hasFeature(state, 'technocracy') ? 1.05 : 1) });
// [P3] Laws in force.
registerModifier({ id: 'laws', mult: ({ state, resource }) => (state.longGame?.policy.laws.length ? lawOutput(state, resource) : 1) });
// [P2] The season leans on food, water or materials.
registerModifier({
  id: 'season',
  mult: ({ state, resource }) => {
    let m = seasonEffects(state)?.output[resource] ?? 1;
    // [P5] Harsh Winters mutator: every season's penalty doubled.
    if (m < 1 && hasMutator(state, 'harshWinters')) m = 1 - (1 - m) * 2;
    // [P3] Winter Stores (and the Mycelium doctrine) halve a season's food penalty.
    return m < 1 && resource === 'food' && hasFeature(state, 'winterStores') ? 1 - (1 - m) / 2 : m;
  },
});
// [P5] Lean Years mutator.
registerModifier({ id: 'mutators', mult: ({ state, resource }) => (resource === 'food' && hasMutator(state, 'leanYears') ? 0.85 : 1) });
// [plan4:BL-1] Neighbour pairs (SYNERGIES, doc 02 section 2.5): 'output' lifts everything a room makes (mushroom farm by the pump), 'knowledge' only
// knowledge (library by the laboratory), 'powerLoss' a power plant's output (generator by a battery bank loses less on the way).
// The table is built once per update (prepare), not per room and resource.
let synergyNow: ReturnType<typeof synergyTable> = new Map();
registerModifier({
  id: 'synergy',
  prepare: state => { synergyNow = synergyTable(state); },
  mult: ({ building, resource }) => {
    const row = synergyNow.get(building.id);
    if (!row) return 1;
    return 1 + (row.output ?? 0) + (resource === 'knowledge' ? row.knowledge ?? 0 : 0) + (resource === 'power' ? row.powerLoss ?? 0 : 0);
  },
});
/** [plan4:BL-1] The share of a chain input a room does not use because of a neighbour (recycler by the workshop: 20% less materials). */
function inputSaving(b: BuildingInstance, resource: ResourceType): number {
  return resource === 'materials' ? synergyNow.get(b.id)?.inputMult ?? 0 : 0;
}
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
  // [ux-wp2 S4] Mood above 100 now counts at half value (people stay at 100%, the surplus is the bunker's), and below 60 it hurts
  // twice as fast: a law's morale price is paid in output (src/systems/morale.ts).
  return moraleOutputMult(avg, moraleRawAverage(state));
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
    this.settleActStock(sm, caps);
    prepareModifiers(state);

    let powerProd = 0;
    let powerDemand = 0;
    // [P2] Winter heating.
    const rawSeason = seasonEffects(state)?.powerDemand ?? 1;
    const seasonPower = hasFeature(state, 'geothermal') ? 1 : hasMutator(state, 'harshWinters') ? 1 + (rawSeason - 1) * 2 : rawSeason;
    for (const b of state.buildings) {
      const level = effectiveLevel(b);
      const def = getDef(b.type);
      if (!def || level <= 0) continue;
      powerDemand += roomPowerDraw(def.powerConsumption, level) * seasonPower;
      const p = def.production?.power;
      if (p && !incidentBlocks(state, b)) powerProd += this.powerOutput(state, b, level);
    }

    powerDemand += infraPowerDraw(state); // [plan4:ST-14/15] shut doors 0.2 each, stairwell lights, vent fans

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

    const appetite = difficultyOf(state).consumption * lawAppetite(state) * actAppetite(state); // [phase3] x per Act
    for (const s of state.survivors) {
      if (s.isOnMission) continue;
      const glutton = s.traits.includes('glutton') ? 2 : 1;
      const size = s.child ? 0.5 : 1;
      consumption.food = (consumption.food ?? 0) + FOOD_PER_SURVIVOR * glutton * size * appetite;
      consumption.water = (consumption.water ?? 0) + WATER_PER_SURVIVOR * size * appetite;
    }

    // Production chains draw their inputs; specialized rooms add their side products.
    const surplusDraw: Partial<Record<ResourceType, number>> = {};
    for (const b of state.buildings) {
      if (effectiveLevel(b) <= 0 || incidentBlocks(state, b)) continue;
      for (const input of chainInputs(b, state)) {
        // [phase3] Surplus draws are summed here and served below, from what is left over.
        if (input.surplus) { surplusDraw[input.resource] = (surplusDraw[input.resource] ?? 0) + inputRate(input, b); continue; }
        if (inputFed(state, input)) consumption[input.resource] = (consumption[input.resource] ?? 0) + inputRate(input, b) * (1 - inputSaving(b, input.resource));
      }
      const spec = specOf(b);
      for (const [r, v] of Object.entries(spec?.extra ?? {}) as [ResourceType, number][]) {
        production[r] = (production[r] ?? 0) + this.extraOutput(state, b, r, v, powerRatio);
      }
    }

    const deltas: StateDelta[] = [];
    // [phase3] Surplus feeds the Act: each basic's surplus draw gets the share the bunker can spare: the net surplus (passed on in
    // full once the store is a band above the reserve) plus the stock above the reserve, fed over SURPLUS_DRAIN_SECONDS.
    // It is kept out of consumptionRate (that stays "what the bunker needs", so a store fed to the Act rooms never reads as short)
    // and reported as resources.<r>.surplusRate instead.
    const shares: Partial<Record<ResourceType, number>> = {};
    const surplusUse: Partial<Record<ResourceType, number>> = {};
    for (const [r, draw] of Object.entries(surplusDraw) as [ResourceType, number][]) {
      if (!(draw > 0)) continue;
      const res = state.resources[r];
      const cap = caps[r] ?? res?.cap ?? 0;
      const reserve = cap * SURPLUS_RESERVE;
      const above = Math.max(0, (res?.amount ?? 0) - reserve);
      const net = (production[r] ?? 0) - (consumption[r] ?? 0);
      const band = Math.min(1, above / Math.max(1, cap * SURPLUS_BAND));
      const share = Math.min(1, (Math.max(0, net) * band + above / SURPLUS_DRAIN_SECONDS) / draw);
      if (share <= 1e-4) continue;
      shares[r] = +share.toFixed(4);
      surplusUse[r] = draw * shares[r]!;
    }
    const prevShares = state.surplusShare ?? {};
    if (Object.keys(shares).length !== Object.keys(prevShares).length || Object.entries(shares).some(([r, v]) => prevShares[r as ResourceType] !== v)) {
      deltas.push({ path: 'surplusShare', value: shares });
    }
    // [plan4:BL-25] The pre-war vault makes blueprints: whole numbers and not a ticked resource, so the fraction builds up in stats.planDust and each whole plan moves over.
    const plans = production.blueprints ?? 0;
    if (plans > 0) {
      const dust = (state.stats.planDust ?? 0) + plans * dt;
      const whole = Math.floor(dust);
      deltas.push({ path: 'stats.planDust', value: dust - whole });
      if (whole > 0) deltas.push({ path: 'resources.blueprints.amount', value: (state.resources.blueprints?.amount ?? 0) + whole });
    }
    for (const rt of TICKED_RESOURCES) {
      const res = state.resources[rt];
      const prod = production[rt] ?? 0;
      const cons = consumption[rt] ?? 0;
      const use = surplusUse[rt] ?? 0; // [phase3]
      const cap = caps[rt] ?? res.cap;
      const raw = res.amount + (prod - cons - use) * dt;
      // [ux-wp2 R1] Stock above the cap (a reward that came in "overfilled") is kept until it is used; production never adds to it.
      const hold = Math.max(cap, res.amount);
      const newAmount = Math.max(0, Math.min(hold, raw));
      // [Economy A1/A3] Production beyond the cap is not thrown away: a project may absorb it first, the rest becomes credits.
      const over = Math.min(raw - hold, (prod - cons - use) * dt);
      if (over > 1e-9 && OVERFLOW_CREDITS[rt]) this.convertOverflow(state, rt, over, deltas);
      deltas.push(
        { path: `resources.${rt}.amount`, value: newAmount },
        { path: `resources.${rt}.productionRate`, value: prod },
        { path: `resources.${rt}.consumptionRate`, value: cons },
        { path: `resources.${rt}.cap`, value: cap },
      );
      if (use > 0 || res.surplusRate) deltas.push({ path: `resources.${rt}.surplusRate`, value: use });
    }
    this.flushCredits(state, deltas);
    this.payContracts(state, deltas);
    deltas.push({ path: 'powerRatio', value: powerRatio });
    // [phase1] When the lights went out (the darkness morale penalty ramps in from here, see darknessPenalty).
    const dark = powerRatio < 0.99;
    if (dark && state.darkSince === undefined) deltas.push({ path: 'darkSince', value: worldClock(state) });
    else if (!dark && state.darkSince !== undefined) deltas.push({ path: 'darkSince', value: undefined });
    if (production.food) {
      deltas.push({ path: 'stats.totalFoodProduced', value: state.stats.totalFoodProduced + production.food * dt });
    }
    sm.applyDeltas(deltas);
  }

  private pendingCredits = 0;

  /**
   * What a room's specialization adds of `r` beyond its own production (`v` per second from the spec).
   * [Long game] Tier-2 roles grow with the room's level, slow down when starved, and stop while the room retools.
   * [ux-wp2 S3] They also go through the room's crew (staffing, skill, mastery) and the whole modifier stack (morale, laws, research,
   * doctrines, Echo...), like every other product; their base rates are divided by TUNING.roleOutputNorm to keep the pacing.
   * Other extras (salvage yard, kitchen...) stay flat, as before.
   */
  private extraOutput(state: GameState, b: BuildingInstance, r: ResourceType, v: number, powerRatio: number): number {
    const spec = specOf(b);
    if (!spec?.levelScaled) return v * powerRatio;
    const roleScale = (effectiveLevel(b) / 5) * chainFactor(state, b) * (retooling(state, b) ? 0 : 1);
    if (roleScale <= 0) return 0;
    // The blackout modifier carries the power ratio for these goods.
    return (v / TUNING.roleOutputNorm) * roleScale * workforceMultiplier(state, b) * modifierProduct({ state, building: b, resource: r, powerRatio });
  }

  private convertOverflow(state: GameState, rt: ResourceType, over: number, _deltas: StateDelta[]): void {
    let left = over;
    const log = (this.overflowLog[rt] ??= { converted: 0, absorbed: 0 });
    if (state.activeProjectId) {
      const used = this.getAbsorber?.()?.absorb(state, rt, left) ?? 0;
      if (used > 0) { left -= used; log.absorbed += used; }
    }
    if (left <= 0) return;
    // [phase3] After Act I the basics earn no credits: what the project did not take is not "converted" (the welcome-back report
    // counts it as wasted).
    if (resourceDef(rt)?.tier === 1 && (state.longGame?.meta.act ?? 1) > TUNING.basicOverflowCreditsLastAct) return;
    log.converted += left;
    // [Q10] From Act IV the overflow is worth a quarter: credits piled up (median 126K a return) with nothing worth buying.
    this.pendingCredits += left * (OVERFLOW_CREDITS[rt] ?? 0) * ((state.longGame?.meta.act ?? 1) >= TUNING.overflowDecayAct ? TUNING.overflowDecay : 1);
  }

  /**
   * [phase3] When the Act changes, stock held above its cap (old overflow, Act I's production-sized stores) drops to the cap, so no
   * six-figure pile carries into the new Act. A save from before this rule only has its pile cut to OVERFILL_CAPS times the cap
   * (what a reward may overfill) on its first tick. The Act last settled is kept in longGame.meta.stockAct.
   */
  private settleActStock(sm: StateManager, caps: Partial<Record<ResourceType, number>>): void {
    const meta = sm.state.longGame?.meta;
    if (!meta || meta.stockAct === meta.act) return;
    const share = meta.stockAct === undefined ? OVERFILL_CAPS : 1;
    const deltas: StateDelta[] = [{ path: 'longGame.meta.stockAct', value: meta.act }];
    for (const rt of TICKED_RESOURCES) {
      if (rt === 'power') continue;
      const res = sm.state.resources[rt];
      const cap = caps[rt] ?? res?.cap ?? 0;
      if (!res || !(cap > 0)) continue;
      const limit = cap * share;
      if (res.amount > limit) deltas.push({ path: `resources.${rt}.amount`, value: limit });
    }
    sm.applyDeltas(deltas);
  }

  /**
   * [phase3] Every finished contract (stats.contractsDone, counted by ContractSystem online and away) pays CONTRACT_CREDITS at the
   * Act's credit scale. stats.contractsPaid remembers how many were paid; a save without it starts from its current count (no back pay).
   */
  private payContracts(state: GameState, deltas: StateDelta[]): void {
    const done = state.stats.contractsDone ?? 0;
    const paid = state.stats.contractsPaid;
    if (paid === done) return;
    deltas.push({ path: 'stats.contractsPaid', value: done });
    if (paid === undefined || done <= paid) return;
    // After flushCredits: read what it already added this tick.
    const flushed = deltas.filter(d => d.path === 'resources.credits.amount').pop()?.value as number | undefined;
    const pay = Math.round((done - paid) * CONTRACT_CREDITS * actCreditScale(state));
    deltas.push({ path: 'resources.credits.amount', value: (flushed ?? state.resources.credits?.amount ?? 0) + pay });
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
      // [ux-wp2 S3] The "why" list belongs to the biggest producer whose output goes through the modifier stack: a flat extra
      // (salvage yard scrap, kitchen food...) is not multiplied, so it must not pick the list.
      const spec = specOf(b);
      const extra = spec?.extra?.[r];
      let flat = 0;
      if (extra && !incidentBlocks(state, b)) {
        const e = this.extraOutput(state, b, r, extra, powerRatio);
        if (spec?.levelScaled) v += e;
        else flat = e;
      }
      add(src, b.type, v + flat);
      if (v > 0 && (!top || v > top.v)) top = { b, v };
      if (!incidentBlocks(state, b)) for (const input of chainInputs(b, state)) {
        if (input.resource !== r) continue;
        if (input.surplus) add(snk, b.type, inputRate(input, b) * surplusShare(state, r)); // [phase3]
        else if (inputFed(state, input)) add(snk, b.type, inputRate(input, b) * (1 - inputSaving(b, input.resource)));
      }
    }
    if (r === 'food' || r === 'water') {
      const appetite = difficultyOf(state).consumption * lawAppetite(state) * actAppetite(state); // [phase3]
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
    // [ux-wp2 S3/S7] The crew of that room (staffing, skill, mastery) leads the list: it now drives the Act currencies too.
    if (top) {
      const crew = workforceMultiplier(state, top.b);
      if (Math.abs(crew - 1) > 1e-3) modifiers.unshift({ id: 'crew', mult: crew });
    }
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
    return p.base * levelMultiplier(p, level) * this.roomFactor(state, b) * modifierProduct({ state, building: b, resource: 'power', powerRatio: 1 })
      * shapeFactor(getDef(b.type), state.stats.totalPlayTime); // [plan4:BL-8] solar follows the sun, wind the gusts; 1 for every other room
  }

  private computeOutput(state: GameState, b: BuildingInstance, powerRatio: number): Partial<Record<ResourceType, number>> {
    const def = getDef(b.type);
    const level = effectiveLevel(b);
    if (!def?.production || level <= 0 || incidentBlocks(state, b)) return {};
    const room = this.roomFactor(state, b) * shapeFactor(def, state.stats.totalPlayTime); // [plan4:BL-8] weather shape: 1 unless the def has one
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
    // [P5] Scarcity mutator: every store a quarter smaller (power aside).
    if (hasMutator(state, 'scarcity')) for (const r of Object.keys(caps) as ResourceType[]) if (r !== 'power') caps[r] = Math.round((caps[r] ?? 0) * 0.75);
    // [Long game] L2: the Act's currencies hold a set number of hours of their reference income, so any price fits.
    for (const [r, v] of Object.entries(actCapBonus(state)) as [ResourceType, number][]) caps[r] = (caps[r] ?? 0) + v;
    // [ux-wp2 R7] Act I: the basics hold at least capHours[1] hours of what the bunker makes (its stores used to fill in minutes).
    if ((state.longGame?.meta.act ?? 1) <= 1) {
      for (const r of ACT1_BUFFERED) caps[r] = Math.max(caps[r] ?? 0, Math.round(TUNING.capHours[1] * (state.resources[r]?.productionRate ?? 0) * 3600));
    }
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

  /**
   * Adds goods, held to storage. [ux-wp2 R1] `overfill`: a reward (supply crate, day chest, achievement) may go past the cap, up to
   * OVERFILL_CAPS times it, so it is never lost to a full store; the surplus is spent first and production does not refill it.
   */
  gain(sm: StateManager, gains: Partial<Record<ResourceType, number>>, opts?: { overfill?: boolean }): void {
    for (const [resource, amount] of Object.entries(gains) as [ResourceType, number][]) {
      const res = sm.state.resources[resource];
      if (!res) continue;
      const cap = res.cap ?? Infinity;
      // Never cuts a store that is already above its cap (an earlier reward).
      const limit = Math.max(opts?.overfill ? cap * OVERFILL_CAPS : cap, res.amount);
      sm.applyDelta({ path: `resources.${resource}.amount`, value: Math.max(0, Math.min(limit, res.amount + amount)) });
    }
  }

  getResourceState(state: GameState, type: ResourceType): ResourceState {
    return state.resources[type];
  }
}

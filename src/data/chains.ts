import type { BuildingInstance, BuildingType, GameState, ResourceType } from '../core/GameState';
import { effectiveLevel, levelMultiplier } from './buildingDefs';
import { specOf, SURPLUS } from './specializations';

/**
 * Light production chains (Sprint 6): some rooms turn one resource into another.
 * A required input that runs dry slows the room to a crawl; a boost input only speeds it up while it lasts.
 */
export interface ChainInput {
  resource: ResourceType;
  base: number;
  perLevel: number;
  /** Optional fuel: the room works without it, and better with it. */
  boost?: boolean;
  /** [phase3] Output multiplier while this boost is fed (default BOOST_FACTOR). */
  mult?: number;
  /**
   * [phase3] A surplus draw (also a boost): instead of all-or-nothing it takes the share of its draw the bunker can spare (the net
   * surplus, plus slowly what is stored above the reserve; ResourceSystem works it out per resource into state.surplusShare), and the
   * room's output rises in step: x(1 + (mult - 1) * share).
   */
  surplus?: boolean;
  /** [phase3] The input only exists from this Act on (before it the room neither eats it nor misses it). */
  fromAct?: number;
}

export const CHAIN_INPUTS: Partial<Record<BuildingType, ChainInput[]>> = {
  canteen: [{ resource: 'food', base: 0.1, perLevel: 0.35 }],
  medbay: [{ resource: 'water', base: 0.06, perLevel: 0.3 }],
  hydroponics: [{ resource: 'water', base: 0.15, perLevel: 0.3 }],
  reactor: [{ resource: 'water', base: 0.25, perLevel: 0.2 }],
  reactorHall: [{ resource: 'water', base: 0.7, perLevel: 0.2 }],
  atrium: [{ resource: 'water', base: 0.15, perLevel: 0.3 }],
  trainingRoom: [{ resource: 'food', base: 0.05, perLevel: 0.3 }],
  // M1: a lighter scrap draw; scrap is the late-game currency (digs, reactor, districts), not just fuel.
  workshop: [{ resource: 'scrap', base: 0.03, perLevel: 0.15, boost: true }, SURPLUS.workshopFood, SURPLUS.workshopWater, SURPLUS.workshopPower, SURPLUS.workshopKnowledge], // [phase3] + surplus
  laboratory: [{ resource: 'scrap', base: 0.02, perLevel: 0.3, boost: true }],
  // [plan4:BL-12] The recycler chews through materials to make scrap; without them it crawls.
  recycler: [{ resource: 'materials', base: 0.12, perLevel: 0.3 }],
  // [plan4:BL-15,20,21,31] the ward uses a little medicine (a boost), the motor pool a little scrap (a boost); the decon chamber and the bathhouse need water
  quarantineWard: [{ resource: 'medicine', base: 0.02, perLevel: 0.3, boost: true }],
  garage: [{ resource: 'scrap', base: 0.02, perLevel: 0.3, boost: true }],
  decon: [{ resource: 'water', base: 0.1, perLevel: 0.3 }],
  bathhouse: [{ resource: 'water', base: 0.08, perLevel: 0.3 }],
  // [plan4:BL-34..38] The Act rooms eat what the matching role eats (specializations.ts: assemblyLine, arcFurnace, dataVault, councilHall, seedForge), so a plant is
  // the same chain with a better output; a starved input slows the whole room as everywhere else.
  // [phase3] ... plus the surplus of the basics (SURPLUS in specializations.ts), the same draw as the role.
  componentsPlant: [{ resource: 'scrap', base: 0.05, perLevel: 0.3 }, { resource: 'materials', base: 0.1, perLevel: 0.3 }, SURPLUS.componentsFood, SURPLUS.componentsWater, SURPLUS.componentsPower],
  alloyFoundry: [{ resource: 'materials', base: 0.4, perLevel: 0.4 }, { resource: 'scrap', base: 0.04, perLevel: 0.3 }, SURPLUS.alloysWater, SURPLUS.alloysPower],
  dataCenter: [{ resource: 'knowledge', base: 0.3, perLevel: 0.3 }, SURPLUS.dataPower, SURPLUS.dataWater],
  forum: [{ resource: 'food', base: 0.3, perLevel: 0.3 }, SURPLUS.influenceFood, SURPLUS.influenceWater, SURPLUS.influencePower],
  seedLab: [{ resource: 'alloys', base: 0.006, perLevel: 0.2 }, { resource: 'data', base: 0.004, perLevel: 0.2 }, SURPLUS.seedWater, SURPLUS.seedFood, SURPLUS.seedPower],
};

export const STARVED_FACTOR = 0.35;
export const BOOST_FACTOR = 1.5;
/** M1: boost fuel only burns the surplus above this share of its storage cap, so digs and research can still save up. */
export const BOOST_RESERVE = 0.5;

/**
 * A room's inputs: its type's, plus its role's when it has one (a room passed by type alone gets only the type's).
 * [phase3] With `state`, the inputs of a later Act (fromAct) are left out.
 */
export function chainInputs(b: BuildingType | BuildingInstance, state?: GameState): ChainInput[] {
  let list: ChainInput[];
  if (typeof b === 'string') list = CHAIN_INPUTS[b] ?? [];
  else {
    const role = specOf(b)?.inputs;
    list = role ? [...(CHAIN_INPUTS[b.type] ?? []), ...role] : CHAIN_INPUTS[b.type] ?? [];
  }
  if (!state) return list;
  const act = state.longGame?.meta.act ?? 1;
  return list.some(i => (i.fromAct ?? 0) > act) ? list.filter(i => (i.fromAct ?? 0) <= act) : list;
}

/** Per-second draw of one input at the room's working level. */
export function inputRate(input: ChainInput, b: BuildingInstance): number {
  const level = effectiveLevel(b);
  return level > 0 ? input.base * levelMultiplier(input, level) : 0;
}

/**
 * [phase3] Surplus draws only take what would otherwise spill: the store is kept at this share of its cap (well above BOOST_RESERVE,
 * so research, digs and upgrades priced near the cap can still be saved up for).
 */
export const SURPLUS_RESERVE = 0.9;
/** [phase3] Stock above the reserve is fed to the surplus draws over this many seconds (slow enough that no "running out" warning fires). */
export const SURPLUS_DRAIN_SECONDS = 900;
/** [phase3] Just above the reserve the net surplus is passed on gradually across this share of the cap (no flicker at the line). */
export const SURPLUS_BAND = 0.05;

/** [phase3] The share (0..1) of their draw that the surplus inputs of `resource` get right now. */
export function surplusShare(state: GameState, resource: ResourceType): number {
  return state.surplusShare?.[resource] ?? 0;
}

/**
 * [phase3] Per second of `resource` the surplus draws took last tick (resources.<r>.surplusRate). It is kept out of consumptionRate:
 * productionRate - consumptionRate is what is spare, and this is how much of the spare the Act rooms use.
 */
export function surplusUse(state: GameState, resource: ResourceType): number {
  return state.resources[resource]?.surplusRate ?? 0;
}

/** Boost fuel kept back in storage: rooms only burn what is above it. */
export function boostReserve(state: GameState, input: ChainInput): number {
  return (state.resources[input.resource]?.cap ?? 0) * BOOST_RESERVE;
}

/** Whether there is stock for this input right now (for optional fuel: stock above the reserve). */
export function inputFed(state: GameState, input: ChainInput): boolean {
  if (input.surplus) return surplusShare(state, input.resource) > 0.01;
  const amount = state.resources[input.resource]?.amount ?? 0;
  return input.boost ? amount > Math.max(0.5, boostReserve(state, input)) : amount > 0.5;
}

/** Output multiplier from the room's inputs: starved, normal or boosted. */
export function chainFactor(state: GameState, b: BuildingInstance): number {
  let f = 1;
  for (const input of chainInputs(b, state)) {
    if (input.surplus) { f *= 1 + ((input.mult ?? BOOST_FACTOR) - 1) * surplusShare(state, input.resource); continue; }
    const fed = inputFed(state, input);
    if (input.boost) f *= fed ? input.mult ?? BOOST_FACTOR : 1;
    else if (!fed) f *= STARVED_FACTOR;
  }
  return f;
}

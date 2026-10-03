import type { BuildingInstance, BuildingType, GameState, ResourceType } from '../core/GameState';
import { effectiveLevel, levelMultiplier } from './buildingDefs';

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
  workshop: [{ resource: 'scrap', base: 0.03, perLevel: 0.15, boost: true }],
  laboratory: [{ resource: 'scrap', base: 0.02, perLevel: 0.3, boost: true }],
};

export const STARVED_FACTOR = 0.35;
export const BOOST_FACTOR = 1.5;
/** M1: boost fuel only burns the surplus above this share of its storage cap, so digs and research can still save up. */
export const BOOST_RESERVE = 0.5;

export function chainInputs(type: BuildingType): ChainInput[] {
  return CHAIN_INPUTS[type] ?? [];
}

/** Per-second draw of one input at the room's working level. */
export function inputRate(input: ChainInput, b: BuildingInstance): number {
  const level = effectiveLevel(b);
  return level > 0 ? input.base * levelMultiplier(input, level) : 0;
}

/** Boost fuel kept back in storage: rooms only burn what is above it. */
export function boostReserve(state: GameState, input: ChainInput): number {
  return (state.resources[input.resource]?.cap ?? 0) * BOOST_RESERVE;
}

/** Whether there is stock for this input right now (for optional fuel: stock above the reserve). */
export function inputFed(state: GameState, input: ChainInput): boolean {
  const amount = state.resources[input.resource]?.amount ?? 0;
  return input.boost ? amount > Math.max(0.5, boostReserve(state, input)) : amount > 0.5;
}

/** Output multiplier from the room's inputs: starved, normal or boosted. */
export function chainFactor(state: GameState, b: BuildingInstance): number {
  let f = 1;
  for (const input of chainInputs(b.type)) {
    const fed = inputFed(state, input);
    if (input.boost) f *= fed ? BOOST_FACTOR : 1;
    else if (!fed) f *= STARVED_FACTOR;
  }
  return f;
}

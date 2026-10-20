import type { BuildingInstance, BuildingType, GameState } from '../core/GameState';
import { isDistrict } from '../data/buildingDefs';

// [plan4:ST-19] Moving a finished room to another spot: the rules the UI and BuildingSystem.relocate share (pure functions of the state).

/** Share of the room's build price paid for a move (the price it was built at: count - 1 rooms of its type before it). */
export const RELOCATE_COST_SHARE = 0.1;
/** Seconds the room produces nothing while it is moved (it reuses the retool clock, retoolUntil, which the output maths already honours). */
export const RELOCATE_SECONDS = 30;

/** Why a room cannot be moved right now (null = it can): building or upgrading, trouble in it, already being moved / refitted, or a cavern. */
export type RelocateBlock = 'busy' | 'incident' | 'moving' | 'district' | null;

export function relocateBlock(state: GameState, b: BuildingInstance): RelocateBlock {
  if (isDistrict(b.type)) return 'district';
  if (b.isConstructing) return 'busy';
  if (state.incidents?.some(i => i.buildingId === b.id)) return 'incident';
  if ((b.retoolUntil ?? 0) > (state.longGame?.meta.worldT ?? 0)) return 'moving';
  return null;
}

/** The state as if the room were not there: where it may go is judged against this (it must not collide with itself, nor count as a copy). */
export function stateWithout(state: GameState, buildingId: string): GameState {
  return { ...state, buildings: state.buildings.filter(b => b.id !== buildingId) };
}

/** What a move costs: 10% of the build price the room was bought at (at least 1 of each material). */
export function relocateCost(bs: { getBuildCost(type: BuildingType, state: GameState): Record<string, number> }, state: GameState, b: BuildingInstance): Record<string, number> {
  const base = bs.getBuildCost(b.type, stateWithout(state, b.id));
  const out: Record<string, number> = {};
  for (const [r, v] of Object.entries(base)) out[r] = Math.max(1, Math.ceil(v * RELOCATE_COST_SHARE));
  return out;
}

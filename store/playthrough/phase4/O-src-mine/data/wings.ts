import { BASE_EAST, floorExtent, type GameState } from '../core/GameState';
import type { DigState } from '../core/state/longGame';
import { actPrice, digHours, payableHours } from './pricing';
import { projectDone } from './projects';
import { isDistrict } from './buildingDefs';

/**
 * [plan4:ST-5] How wide a floor may grow. A wing is dug in steps of WING_STEP slots; each Act allows more width, and depth
 * takes some back (rock is weaker deep down), so the bunker is wide in the middle and narrow at the bottom, like a real section.
 */
export const WING_STEP = 2;

/** Widest east side (slots east of the shaft) by Act I..VII. */
export const WING_CAP_EAST: readonly number[] = [12, 14, 16, 18, 20, 20, 22];
/** Widest west side (slots west of the shaft) by Act I..VII. Act I keeps the bunker closed to the sides (the first half hour does not change). */
export const WING_CAP_WEST: readonly number[] = [0, 2, 4, 6, 8, 10, 10];
/** The Deep Foundry project (Act IV charter) takes this much off the depth cut: its foundations hold wider caverns. */
export const DEEP_FOUNDRY_BONUS = 4;
/** The research that opens the second dig slot. */
export const PARALLEL_DIG = 'parallelDig';

/** Why a wing cannot be dug now. 'locked' = the state has no long game (nothing can be dug). */
export type WingBlock = null | 'act' | 'stability' | 'busy' | 'cost' | 'locked' | 'district';

export type WingOption = {
  floor: number;
  side: 'w' | 'e';
  /** Steps dug so far on this side (2 slots each). */
  steps: number;
  /** What the NEXT step costs. */
  cost: Record<string, number>;
  /** Crew-seconds at full crew for the next step. */
  seconds: number;
  block: WingBlock;
};

/** Slots a floor loses to depth: 2 for every 4 floors below the 8th (f = floor index, 0 = B1). */
export function stabilityCut(f: number): number {
  return 2 * Math.max(0, Math.floor((f - 8) / 4));
}

export function wingAct(state: GameState): number {
  return Math.min(WING_CAP_EAST.length, Math.max(1, state.longGame?.meta.act ?? 1));
}

/** The Act's width limit alone (before depth). */
export function actCap(state: GameState, side: 'w' | 'e'): number {
  return (side === 'e' ? WING_CAP_EAST : WING_CAP_WEST)[wingAct(state) - 1];
}

function deepBonus(state: GameState): number {
  return projectDone(state, 'deepFoundry') ? DEEP_FOUNDRY_BONUS : 0;
}

/** Widest east side (slots) floor f may have now: the Act's cap less the depth cut (the Deep Foundry gives some back), never below the classic 12. */
export function maxEast(state: GameState, f: number): number {
  const cap = actCap(state, 'e');
  return Math.min(cap, Math.max(BASE_EAST, cap - stabilityCut(f) + deepBonus(state)));
}

/** Widest west side (slots) floor f may have now (0 = none). */
export function maxWest(state: GameState, f: number): number {
  const cap = actCap(state, 'w');
  return Math.min(cap, Math.max(0, cap - stabilityCut(f) + deepBonus(state)));
}

/** Dig steps on one side of a floor. */
export function wingSteps(state: GameState, f: number, side: 'w' | 'e'): number {
  const x = floorExtent(state, f);
  return side === 'w' ? Math.floor(x.w / WING_STEP) : Math.max(0, Math.floor((x.e - BASE_EAST) / WING_STEP));
}

/** Dig steps on both sides of a floor (what a wing's time and crew grow with). */
export function floorWingSteps(state: GameState, f: number): number {
  return wingSteps(state, f, 'w') + wingSteps(state, f, 'e');
}

/** Price of the next wing step on floor f: a quarter of the hours the floor's depth would cost to dig, in the Act's currency. */
export function wingCost(state: GameState, f: number): Record<string, number> {
  const act = wingAct(state);
  // Shallow floors are priced as B7 (digHours starts there); never more than the Act's storage can pay in one go.
  const hours = Math.min(payableHours(act), 0.25 * digHours(Math.max(7, f + 1)));
  return actPrice(act, hours);
}

/** Seconds of full crew work for the next step: 90s x 1.25 per step already dug on the floor x 1.06 per floor, at most two hours. */
export function wingSeconds(state: GameState, f: number): number {
  return Math.round(Math.min(7200, 90 * Math.pow(1.25, floorWingSteps(state, f)) * Math.pow(1.06, f)));
}

/** People a wing dig wants: 2, plus one for every 6 steps already dug on the floor (at most 6). */
export function wingCrew(state: GameState, f: number): number {
  return Math.min(6, 2 + Math.floor(floorWingSteps(state, f) / 6));
}

/** Dig slots the bunker has: one, and a second once Parallel Digging is researched. */
export function digSlotCount(state: GameState): number {
  return state.research?.[PARALLEL_DIG]?.completed ? 2 : 1;
}

/** The dig in a slot (0 or 1), if the state has one. */
export function digAt(state: GameState, slot: number): DigState | undefined {
  return slot === 0 ? state.longGame?.dig : state.longGame?.dig2;
}

/** The first slot with no dig running, or -1 when all of the bunker's slots are busy. */
export function freeDigSlot(state: GameState): number {
  const n = digSlotCount(state);
  for (let i = 0; i < n; i++) { const d = digAt(state, i); if (d && d.floor == null) return i; }
  return -1;
}

/** Is a new floor being dug (in either slot)? Only one floor dig at a time. */
export function floorDigging(state: GameState): boolean {
  for (let i = 0; i < 2; i++) {
    const d = digAt(state, i);
    if (d && d.floor != null && d.kind !== 'wing') return true;
  }
  return false;
}

/** Is this exact wing already being dug? */
export function wingDigging(state: GameState, f: number, side: 'w' | 'e'): boolean {
  for (let i = 0; i < 2; i++) {
    const d = digAt(state, i);
    if (d && d.floor === f && d.kind === 'wing' && d.side === side) return true;
  }
  return false;
}

/** Why floor f's side cannot grow another step right now (null = it can). Priority: Act, depth, district tunnel, crew slots, price. */
export function wingBlock(state: GameState, f: number, side: 'w' | 'e'): WingBlock {
  if (!state.longGame?.dig) return 'locked';
  const x = floorExtent(state, f);
  const have = side === 'w' ? x.w : x.e;
  if (have + WING_STEP > actCap(state, side)) return 'act';
  if (have + WING_STEP > (side === 'w' ? maxWest(state, f) : maxEast(state, f))) return 'stability';
  // A district tunnel on this floor's east side is under construction: the rock there is busy.
  if (side === 'e' && state.buildings.some(b => isDistrict(b.type) && b.isConstructing && b.position.floor === f)) return 'district';
  if (wingDigging(state, f, side) || freeDigSlot(state) < 0) return 'busy';
  const cost = wingCost(state, f);
  for (const [r, v] of Object.entries(cost)) if ((state.resources[r as keyof GameState['resources']]?.amount ?? 0) < v) return 'cost';
  return null;
}

/** One entry per floor and side above the bunker's bottom (floors < currentFloors): what it costs to widen and why it may not. */
export function wingOptions(state: GameState): WingOption[] {
  const out: WingOption[] = [];
  for (let f = 0; f < state.currentFloors; f++) {
    for (const side of ['w', 'e'] as const) {
      out.push({ floor: f, side, steps: wingSteps(state, f, side), cost: wingCost(state, f), seconds: wingSeconds(state, f), block: wingBlock(state, f, side) });
    }
  }
  return out;
}

/** Widest total reach (west + east slots) of the whole bunker, with how wide it may grow now: the Command panel's "wing width" line. */
export function wingSummary(state: GameState, side: 'w' | 'e'): { have: number; max: number } {
  let have = 0, max = 0;
  for (let f = 0; f < state.currentFloors; f++) {
    const x = floorExtent(state, f);
    have = Math.max(have, side === 'w' ? x.w : x.e);
    max = Math.max(max, side === 'w' ? maxWest(state, f) : maxEast(state, f));
  }
  return { have, max };
}

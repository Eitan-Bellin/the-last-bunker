import type { GameState, ResourceType } from '../core/GameState';
import { ACT_CURRENCY } from '../data/pricing';

/**
 * [ux-wp2] Small pure helpers of the economy pass (strategy S3/S7, mid/late M7), shared by the systems that apply them
 * and by the UI that explains them. No state is written here.
 */

/** The Act currencies (tier 2): components, alloys, data, influence, seed cores. */
export const TIER2: ReadonlySet<ResourceType> = new Set(ACT_CURRENCY.slice(3));

export function isTier2(r: ResourceType): boolean {
  return TIER2.has(r);
}

/** Adults at home with no job: no room, no project or dig crew, not on an expedition. */
export function idleAdults(state: GameState): number {
  let n = 0;
  for (const s of state.survivors) if (!s.child && !s.isOnMission && !s.assignedBuildingId) n++;
  return n;
}

/** [S7] General labour: idle hands help the dig and the charter crews. Up to this much faster... */
export const LABOUR_MAX = 0.2;
/** ...approached with diminishing returns: about two thirds of it with this many idle adults. */
export const LABOUR_SCALE = 40;

/** [S7] The share idle adults add to dig and charter work (0..LABOUR_MAX): 10 idle +4%, 47 idle +14%, 120 idle +19%. */
export function labourBonus(state: GameState): number {
  const idle = idleAdults(state);
  return idle > 0 ? LABOUR_MAX * (1 - Math.exp(-idle / LABOUR_SCALE)) : 0;
}

/**
 * [M7] Systems Memory (the Genesis upgrade that used to be Scavenger's Luck, id kept so bought levels carry over):
 * every level takes 5% off dig, room upgrade and charter work time.
 */
export const MEMORY_STEP = 0.95;

export function memoryTimeMult(state: GameState): number {
  return Math.pow(MEMORY_STEP, state.prestige?.upgrades?.['lootLuck'] ?? 0);
}

/** Work speed of the dig and charter crews from the bunker as a whole: idle labour and Systems Memory. */
export function workSpeedMult(state: GameState): number {
  return (1 + labourBonus(state)) / memoryTimeMult(state);
}

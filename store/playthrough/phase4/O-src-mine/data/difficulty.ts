import type { GameState } from '../core/GameState';
import type { Difficulty } from '../core/state/longGame';

/**
 * The three difficulties chosen at the start of a game (long-game plan, pillar B). Warden is today's game.
 * Later phases add their own knobs here (threat director, event rate, death severity, Legacy multiplier).
 */
export interface DifficultyDef {
  id: Difficulty;
  icon: string;
  /** Food and water each person eats and drinks. */
  consumption: number;
  /** Raiders' strength. */
  raidStrength: number;
  /** While away, hunger and thirst never take anyone below this health. */
  awayHealthFloor: number;
  /** Extra stock at the start (share of the usual start stock). */
  startStock: number;
  /** Ignored danger may kill while the player is away (never on Settler). */
  awayDeaths: boolean;
  /** Legacy (Genesis payout) multiplier, by the easiest difficulty the run was played on. */
  legacy: number;
  /** [P2] Whether anyone can die at all (Settler: injuries only, never a death). */
  canDie: boolean;
  /** [P2] Online, health never drops below this (Settler keeps everyone standing). */
  onlineHealthFloor: number;
  /** [P2] Hours without new raids after a hard hit or a death. */
  breatherHours: number;
  /** [P2] The threat director's meter is scaled by this. */
  threat: number;
  /** [P2] A crushing raid can wreck a room (it becomes a ruin to restore). */
  roomDamage: boolean;
  /** [P2] After a day of ignored danger away, the chance an injury turns fatal. */
  awayToll: number;
}

export const DIFFICULTIES: readonly DifficultyDef[] = [
  { id: 'settler', icon: '[[heart]]', consumption: 0.8, raidStrength: 0.75, awayHealthFloor: 35, startStock: 0.5, awayDeaths: false, legacy: 0.75, canDie: false, onlineHealthFloor: 5, breatherHours: 18, threat: 0.7, roomDamage: false, awayToll: 0 },
  { id: 'warden', icon: '[[vault]]', consumption: 1, raidStrength: 1, awayHealthFloor: 15, startStock: 0, awayDeaths: true, legacy: 1, canDie: true, onlineHealthFloor: 0, breatherHours: 10, threat: 1, roomDamage: true, awayToll: 0.4 },
  { id: 'last', icon: '[[skull]]', consumption: 1.25, raidStrength: 1.3, awayHealthFloor: 1, startStock: -0.25, awayDeaths: true, legacy: 1.4, canDie: true, onlineHealthFloor: 0, breatherHours: 4, threat: 1.3, roomDamage: true, awayToll: 0.65 },
];

export function difficultyOf(state: GameState): DifficultyDef {
  const id = state.longGame?.meta.difficulty ?? 'warden';
  return DIFFICULTIES.find(d => d.id === id) ?? DIFFICULTIES[1];
}

/** Easiest first: the run's lowest difficulty is what achievements and Legacy credit. */
export function easier(a: Difficulty, b: Difficulty): Difficulty {
  const order = DIFFICULTIES.map(d => d.id);
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

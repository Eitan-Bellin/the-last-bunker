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
}

export const DIFFICULTIES: readonly DifficultyDef[] = [
  { id: 'settler', icon: '[[heart]]', consumption: 0.8, raidStrength: 0.75, awayHealthFloor: 35, startStock: 0.5, awayDeaths: false },
  { id: 'warden', icon: '[[vault]]', consumption: 1, raidStrength: 1, awayHealthFloor: 15, startStock: 0, awayDeaths: true },
  { id: 'last', icon: '[[skull]]', consumption: 1.25, raidStrength: 1.3, awayHealthFloor: 1, startStock: -0.25, awayDeaths: true },
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

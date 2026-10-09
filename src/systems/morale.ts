import type { GameState } from '../core/GameState';
import { LAWS, activeLaws } from '../data/laws';
import { moraleTargets } from './PopulationSystem';

/**
 * [ux-wp2 S4] Morale and output. People's morale stays 0..100, but the bunker's mood can run above that (a well-kept bunker
 * sits at 105-115 "raw"); that surplus is worth half, up to SURPLUS_MAX points. Below LOW_MORALE every point costs twice as
 * much output. So a law's morale price is a real price: it eats the surplus first, then output.
 */
export const SURPLUS_SHARE = 0.5;
export const SURPLUS_MAX = 10;
export const LOW_MORALE = 60;

/** Output multiplier of every room (power aside) for an average morale `avg` (0..100) and a raw average mood `raw`. */
export function moraleOutputMult(avg: number, raw: number = avg): number {
  const e = avg + Math.min(SURPLUS_MAX, Math.max(0, raw - 100) * SURPLUS_SHARE);
  let m = 0.75 + (e / 100) * 0.75;
  if (e < LOW_MORALE) m -= ((LOW_MORALE - e) / 100) * 0.75;
  return Math.max(0.6, m);
}

/** The raw average mood right now (before each person's 100 limit); 50 with nobody home. */
export function moraleRawAverage(state: GameState): number {
  return state.survivors.length === 0 ? 50 : moraleTargets(state).raw;
}

/** "In your bunker" numbers for a law card: what passing it (or, if it is in force, repealing it) does here and now. */
export interface LawImpact {
  /** Whether the law is in force (the numbers are then those of repealing it, signs as seen from "with the law"). */
  active: boolean;
  /** Where people's morale settles without and with the law (0..100). */
  moraleWithout: number;
  moraleWith: number;
  /** Output of a typical room without and with the law (morale and the law's own output share together). */
  outputWithout: number;
  outputWith: number;
  /** outputWith / outputWithout - 1, e.g. 0.07 = +7%. */
  outputChange: number;
}

/**
 * [ux-wp2 S4] Pure: the morale and output a law brings in this bunker, at steady state (morale has settled). For the laws UI:
 * "in your bunker: output +7%, morale 97 -> 91". `null` for an unknown law. The output is the general one (food, materials...);
 * a law that only touches one resource (Free Schools) reports 0 here.
 */
export function lawImpact(state: GameState, lawId: string): LawImpact | null {
  const law = LAWS.find(l => l.id === lawId);
  if (!law) return null;
  const active = activeLaws(state).some(l => l.id === lawId);
  const shift = law.morale ?? 0;
  const now = moraleTargets(state);
  const other = moraleTargets(state, active ? -shift : shift);
  const without = active ? other : now;
  const withLaw = active ? now : other;
  const outputWithout = moraleOutputMult(without.target, without.raw);
  const outputWith = moraleOutputMult(withLaw.target, withLaw.raw) * (law.output ?? 1);
  return {
    active,
    moraleWithout: without.target,
    moraleWith: withLaw.target,
    outputWithout,
    outputWith,
    outputChange: outputWith / outputWithout - 1,
  };
}

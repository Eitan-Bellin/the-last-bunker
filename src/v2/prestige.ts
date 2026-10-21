// v2 "new bunker" (prestige): start the mine and the base over for a permanent sale bonus. Points grow with the cube
// root of what this run earned; each point adds 10% to every sale. Gems, builders and the bonus carry over.
import { newBase } from './base.ts';
import { newSave, type MineSave } from './mine.ts';

export interface PrestigeSave { count: number; points: number; lifetime: number }

export const PRESTIGE_MIN_CC = 4;
export const POINT_BONUS = 0.1;
export const pointsFor = (runEarned: number) => Math.floor(Math.cbrt(Math.max(0, runEarned) / 1e7));
export const prestigeMul = (p: PrestigeSave | undefined) => 1 + POINT_BONUS * (p?.points ?? 0);

export function canRebirth(s: MineSave): boolean {
  return (s.base?.cc ?? 1) >= PRESTIGE_MIN_CC && pointsFor(s.stats.earned) >= 1;
}

/** The save of the next bunker (the caller stores it and reloads). */
export function rebirth(s: MineSave, now: number): MineSave {
  const p = s.prestige ?? { count: 0, points: 0, lifetime: 0 };
  const next = newSave();
  next.gems = s.gems;
  next.prestige = { count: p.count + 1, points: p.points + pointsFor(s.stats.earned), lifetime: p.lifetime + s.stats.earned };
  next.base = newBase(now);
  next.base.builders = s.base?.builders ?? 2;
  next.stats.playS = s.stats.playS;
  return next;
}

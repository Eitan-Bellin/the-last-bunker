import type { ResourceType, SurvivorState } from '../core/GameState';

/**
 * [LateGame B3] Mastery: workers get better at their role the longer they do it.
 * Rank 1-5; each rank takes about twice as long as the one before (rank 5 after ~3 days of work).
 * Every rank above 1 adds 5% to the output of the room they work in; at rank 5 they pick a specialization.
 */
export const MASTERY_STEPS = [17_280, 51_840, 120_960, 259_200];
export const MAX_RANK = 5;
export const RANK_BONUS = 0.05;

/** Rank (1-5) for a worker's accumulated work seconds. */
export function rankOfXp(mxp: number): number {
  let r = 1;
  for (const t of MASTERY_STEPS) if (mxp >= t) r++;
  return r;
}

export function rankOf(s: SurvivorState): number {
  return rankOfXp(s.mxp ?? 0);
}

/** Progress inside the current rank as [done seconds, seconds this rank takes]; full at rank 5. */
export function rankProgress(s: SurvivorState): [number, number] {
  const mxp = s.mxp ?? 0;
  const r = rankOfXp(mxp);
  if (r >= MAX_RANK) return [1, 1];
  const from = r === 1 ? 0 : MASTERY_STEPS[r - 2];
  return [mxp - from, MASTERY_STEPS[r - 1] - from];
}

/** Seconds of work a quick training is worth: a quarter of the way through the current rank. */
export function trainingGain(s: SurvivorState): number {
  const [, span] = rankProgress(s);
  return Math.round(span * 0.25);
}

/** Price of one quick training: knowledge and food, more for higher ranks. */
export function trainingCost(s: SurvivorState): Partial<Record<ResourceType, number>> {
  const r = rankOf(s);
  return { knowledge: 40 * r, food: 60 * r };
}

export type SpecId = 'master' | 'mentor';
export const SPECS: { id: SpecId; icon: string; name: Record<'he' | 'en', string>; desc: Record<'he' | 'en', string> }[] = [
  {
    id: 'master', icon: '[[star]]',
    name: { he: 'אמן', en: 'Master' },
    desc: { he: '+15% תפוקה בחדר שבו הוא עובד', en: '+15% output in the room they work in' },
  },
  {
    id: 'mentor', icon: '[[books]]',
    name: { he: 'מורה', en: 'Mentor' },
    desc: { he: 'כל מי שעובד איתו בחדר לומד מהר ב־50%', en: 'Everyone working with them in the room learns 50% faster' },
  },
];

export const MASTER_BONUS = 0.15;
export const MENTOR_BOOST = 0.5;

/** Output multiplier of a room from its workers' ranks and "master" specializations (1 = none). */
export function masteryMultiplier(workers: SurvivorState[]): number {
  if (workers.length === 0) return 1;
  let sum = 0;
  for (const w of workers) sum += (rankOf(w) - 1) * RANK_BONUS + (w.spec === 'master' ? MASTER_BONUS : 0);
  return 1 + sum / workers.length;
}

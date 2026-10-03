import type { GameState } from '../core/GameState';
import { rankOf } from './mastery';
import { openPartners } from './trade';

/**
 * [LateGame B4] The weekly challenge: every Sunday one goal out of twelve is picked for the week.
 * Goals count from the moment the week starts ("N more than at the start"). The prize is cosmetic
 * (a plate colour or an entrance flag) and trade credits.
 */
export interface ChallengeDef {
  id: string;
  icon: string;
  text: Record<'he' | 'en', string>;
  target: number;
  /** The counter the goal follows; progress is its growth since the week began. */
  counter: (s: GameState) => number;
  /** Custom progress from the counters saved at the week's start (default: the counter's growth). */
  progress?: (s: GameState, base: Record<string, number>) => number;
  /** Only picked when it makes sense for the bunker right now. */
  avail: (s: GameState) => boolean;
}

export const WEEKLY_CREDITS = 300;

/** Cosmetic prizes, handed out in order, one per challenge won. */
export const COSMETICS = ['plate:amber', 'flag:red', 'plate:green', 'flag:blue', 'plate:violet', 'flag:gold'];

const levels = (s: GameState) => s.buildings.reduce((n, b) => n + b.level, 0);
const explored = (s: GameState) => s.explorationMap.filter(h => h.explored).length;
const researched = (s: GameState) => Object.values(s.research).filter(r => r.completed).length;
const deals = (s: GameState, id: string) => s.lateGame?.trade?.deals?.[id] ?? 0;
const PARTNER_IDS = ['terminus', 'clan', 'noa'];
/** Partners that got a successful caravan since the week began. */
const partnersTraded = (s: GameState, base: Record<string, number>) => PARTNER_IDS.filter(p => deals(s, p) > (base[`d_${p}`] ?? 0)).length;

export const CHALLENGES: ChallengeDef[] = [
  { id: 'newcomers', icon: '[[people]]', target: 10, counter: s => s.stats.totalSurvivorsRecruited, avail: s => s.survivors.length >= 3,
    text: { he: 'קבלו 10 ניצולים חדשים לבונקר', en: 'Welcome 10 new survivors to the bunker' } },
  { id: 'grow', icon: '[[heart]]', target: 15, counter: s => s.survivors.length, avail: s => s.maxPopulation - s.survivors.length >= 15,
    text: { he: 'הגדילו את האוכלוסייה ב־15 אנשים', en: 'Grow the population by 15 people' } },
  { id: 'stages2', icon: '[[build]]', target: 2, counter: s => s.lateGame?.stagesDone ?? 0, avail: s => (s.era ?? 0) >= 2,
    text: { he: 'השלימו 2 שלבי פרויקט', en: 'Finish 2 project stages' } },
  { id: 'stages3', icon: '[[trophy]]', target: 3, counter: s => s.lateGame?.stagesDone ?? 0, avail: s => (s.era ?? 0) >= 2,
    text: { he: 'השלימו 3 שלבי פרויקט', en: 'Finish 3 project stages' } },
  { id: 'caravans3', icon: '[[cart]]', target: 3, counter: s => s.lateGame?.trade?.caravans ?? 0, avail: s => openPartners(s).length > 0,
    text: { he: 'סיימו 3 שיירות סחר בשלום', en: 'Bring 3 trade caravans home safely' } },
  { id: 'allPartners', icon: '[[flag]]', target: 3, counter: s => s.lateGame?.trade?.caravans ?? 0, progress: partnersTraded, avail: s => openPartners(s).length >= 3,
    text: { he: 'שיירה מוצלחת לכל 3 השותפים', en: 'A successful caravan to each of the 3 partners' } },
  { id: 'expeditions', icon: '[[walker]]', target: 8, counter: s => s.stats.totalMissionsCompleted, avail: s => (s.era ?? 0) >= 1,
    text: { he: 'החזירו 8 משלחות מהשטח', en: 'Bring 8 expeditions home' } },
  { id: 'explore', icon: '[[map]]', target: 10, counter: explored, avail: s => s.explorationMap.some(h => !h.explored),
    text: { he: 'גלו 10 משושים חדשים במפה', en: 'Discover 10 new map hexes' } },
  { id: 'research', icon: '[[research]]', target: 3, counter: researched, avail: s => s.buildings.some(b => b.type === 'laboratory'),
    text: { he: 'השלימו 3 מחקרים', en: 'Complete 3 researches' } },
  { id: 'levels', icon: '[[up]]', target: 12, counter: levels, avail: s => s.buildings.length >= 5,
    text: { he: 'הוסיפו 12 רמות לחדרים', en: 'Add 12 levels to your rooms' } },
  { id: 'ranks', icon: '[[star]]', target: 5, counter: s => s.survivors.reduce((n, v) => n + rankOf(v), 0), avail: s => s.survivors.length >= 8,
    text: { he: 'העלו את דרגות המומחיות של העובדים ב־5 בסך הכול', en: 'Raise your workers\' mastery ranks by 5 in total' } },
  { id: 'training', icon: '[[books]]', target: 3, counter: s => s.lateGame?.trained ?? 0, avail: s => s.buildings.some(b => b.type === 'trainingRoom'),
    text: { he: 'אמנו עובדים באימון מהיר 3 פעמים', en: 'Give workers 3 quick trainings' } },
];

export function getChallenge(id: string | null | undefined): ChallengeDef | undefined {
  return CHALLENGES.find(c => c.id === id);
}

/** The counters a challenge follows, at the moment the week starts. */
export function snapshot(s: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of CHALLENGES) out[c.id] = c.counter(s);
  for (const p of PARTNER_IDS) out[`d_${p}`] = deals(s, p);
  return out;
}

/** Progress of a challenge since the week began, capped at its target. */
export function challengeProgress(s: GameState, c: ChallengeDef, base: Record<string, number>): number {
  const v = c.progress ? c.progress(s, base) : c.counter(s) - (base[c.id] ?? c.counter(s));
  return Math.max(0, Math.min(c.target, v));
}

/** Local Sunday of the week a moment falls in, as "YYYY-MM-DD". */
export function weekKey(ms: number): string {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Stable pick among the challenges that fit (a plain hash of the week, the same on every device). */
export function pickChallenge(s: GameState, week: string): ChallengeDef {
  const fit = CHALLENGES.filter(c => c.avail(s));
  const list = fit.length ? fit : CHALLENGES;
  let h = 0;
  for (const ch of week) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

import type { GameState } from '../core/GameState';
import { relationLevel } from './trade';
import { scenarioOf } from './scenarios';
import { RESEARCH } from './research'; // [phase4] names for the drivers line
import { LAWS } from './laws';

/**
 * [Long game P5] How the run ends (long-game plan, pillar E): when the last Act is complete, the bunker's story closes
 * in the way it was lived. The ending is read from the choices that shaped the run (doctrines, laws, the world outside)
 * and adds to the Legacy.
 * [phase4] Every doctrine pushes exactly one ending (+2): each of the 8 Crossroads offers three different endings, six doctrines per ending.
 * Laws add a little; the Commonwealth also reads the partners and contracts. `pushes` is the tally the Command panel's Endings tab lists.
 */
export type EndingId = 'commonwealth' | 'fortress' | 'garden' | 'ark';

/** [phase4] One thing that raises an ending's score. */
export interface EndingPush {
  kind: 'doctrine' | 'law';
  /** The research node (doctrine) or law id. */
  id: string;
  /** Score it adds while chosen / in force. */
  w: number;
}

export interface EndingDef {
  id: EndingId;
  icon: string;
  name: Record<'he' | 'en', string>;
  text: Record<'he' | 'en', string>;
  /** [Q8] What raises this ending's score, in plain words (the Bunker Book); [phase4] built from `pushes` and `other` below. */
  drivers: Record<'he' | 'en', string>;
  /** Extra Legacy (share of the Genesis payout). */
  legacy: number;
  /** [phase4] Where the score starts (the Ark: what is left when nothing else pulls). */
  base: number;
  /** [phase4] The doctrines and laws that push this ending. */
  pushes: EndingPush[];
  /** [phase4] What else raises it, in plain words (the Endings tab), and how much it is worth now. */
  other?: { text: Record<'he' | 'en', string>; score: (s: GameState) => number };
}

/** [phase4] What one doctrine is worth to its ending. */
export const DOCTRINE_PUSH = 2;

const done = (s: GameState, id: string) => !!s.research[id]?.completed;
const law = (s: GameState, id: string) => (s.longGame?.policy.laws ?? []).includes(id);
const contracts = (s: GameState) => (s.stats as unknown as { contractsDone?: number }).contractsDone ?? 0;
const doctrines = (...ids: string[]): EndingPush[] => ids.map(id => ({ kind: 'doctrine' as const, id, w: DOCTRINE_PUSH }));

export const ENDINGS: EndingDef[] = ([
  {
    id: 'commonwealth', icon: '[[chat]]', legacy: 0.1, base: 0,
    name: { he: 'חבר העמים', en: 'The Commonwealth' },
    text: {
      he: 'בונקר 17 לא נשאר מתחת לאדמה. הדרכים שסללתם, החוזים ששמרתם והאנשים שהאכלתם הפכו שכנים לברית. כשתתחיל הבראשית, היא תתחיל עם חברים.',
      en: 'Bunker 17 did not stay underground. The roads you paved, the contracts you kept and the people you fed turned neighbours into an alliance. When Genesis begins, it begins among friends.',
    },
    pushes: [...doctrines('surfaceFarms', 'commune', 'diplomacy', 'precisionCraft', 'merchantRepublic', 'republic'), { kind: 'law', id: 'openDoors', w: 1 }],
    other: {
      text: { he: 'ידידות עם כל שלושת השותפים (+1) וחוזים (עד +0.5)', en: 'Friendship with all three partners (+1) and contracts (up to +0.5)' },
      score: s => (['terminus', 'clan', 'noa'].every(p => relationLevel(s, p) >= 5) ? 1 : 0) + Math.min(0.5, contracts(s) / 4000),
    },
  },
  {
    id: 'fortress', icon: '[[vault]]', legacy: 0.1, base: 0,
    name: { he: 'המבצר', en: 'The Fortress' },
    text: {
      he: 'העולם ניסה לקחת ממכם שוב ושוב, ושוב ושוב הדלת החזיקה. מה שתעבירו לעולם הבא הוא לא רק זרעים וספרים, אלא הידיעה שאפשר לעמוד.',
      en: 'The world tried to take from you again and again, and again and again the door held. What you carry into the next world is not only seeds and books, but the knowledge that one can stand.',
    },
    pushes: [...doctrines('fission', 'militia', 'fortress', 'foundryDoctrine', 'isolationism', 'vanguardCrossing'), { kind: 'law', id: 'martialLaw', w: 1 }, { kind: 'law', id: 'doubleShifts', w: 0.5 }],
  },
  {
    id: 'garden', icon: '[[clover]]', legacy: 0.1, base: 0,
    name: { he: 'הגן', en: 'The Garden' },
    text: {
      he: 'מתחת לכיפת השמיים גדלים עכשיו עצים שאף אחד כאן לא ראה מעולם. אתם מוכנים לבראשית כמו שגננים מוכנים לאביב: עם זרעים בכיס וידיים בעפר.',
      en: 'Under the Sky Dome now grow trees nobody here had ever seen. You are ready for Genesis the way gardeners are ready for spring: seeds in the pocket and hands in the soil.',
    },
    pushes: [...doctrines('solarArray', 'mycelium', 'rangers', 'expansionism', 'confederation', 'seedCrossing'), { kind: 'law', id: 'dayOfRest', w: 1 }, { kind: 'law', id: 'rationing', w: 0.5 }],
  },
  {
    id: 'ark', icon: '[[vault]]', legacy: 0.1, base: 0.5,
    name: { he: 'התיבה', en: 'The Ark' },
    text: {
      he: 'לא כל מה שבניתם ישרוד את המעבר. אבל השמות, השירים והזרעים בתיבה כן. מישהו בעולם הבא יפתח אותה, ויידע שהייתם כאן.',
      en: 'Not everything you built will survive the crossing. But the names, the songs and the seeds in the Ark will. Someone in the next world will open it, and know that you were here.',
    },
    pushes: [...doctrines('geothermal', 'hydroDoctrine', 'meritocracy', 'deepMining', 'technocracy', 'archiveCrossing'), { kind: 'law', id: 'freeSchools', w: 1 }],
  },
] as Omit<EndingDef, 'drivers'>[]).map(e => ({ ...e, drivers: driversOf(e) }));

/** [phase4] "Doctrines: Fission, Militia... · laws: Martial Law · ..." in each language. */
function driversOf(e: Omit<EndingDef, 'drivers'>): Record<'he' | 'en', string> {
  const out = { he: '', en: '' };
  for (const lang of ['he', 'en'] as const) {
    const docs = e.pushes.filter(p => p.kind === 'doctrine').map(p => RESEARCH.find(r => r.id === p.id)?.name[lang]?.replace(/^[^:]*:s*/, '') ?? p.id);
    const laws = e.pushes.filter(p => p.kind === 'law').map(p => LAWS.find(l => l.id === p.id)?.name[lang] ?? p.id);
    const parts = [
      `${lang === 'he' ? 'דוקטרינות' : 'Doctrines'}: ${docs.join(', ')}`,
      `${lang === 'he' ? 'חוקים' : 'laws'}: ${laws.join(', ')}`,
      ...(e.other ? [e.other.text[lang]] : []),
    ];
    out[lang] = parts.join(' · ');
  }
  return out;
}

/** [phase4] Whether a push counts in this run now. */
export function pushActive(s: GameState, p: EndingPush): boolean {
  return p.kind === 'doctrine' ? done(s, p.id) : law(s, p.id);
}

/** [phase4] The ending a doctrine pushes (each doctrine pushes one). */
export function endingOfDoctrine(id: string): EndingDef | undefined {
  return ENDINGS.find(e => e.pushes.some(p => p.kind === 'doctrine' && p.id === id));
}

/** How strongly this run fits the ending, from the choices alone (the highest wins). */
export function endingChoiceScore(s: GameState, e: EndingDef): number {
  return e.base + e.pushes.reduce((sum, p) => sum + (pushActive(s, p) ? p.w : 0), 0) + (e.other?.score(s) ?? 0);
}

/** The run's score for an ending: what the choices made, plus the lean of the place (scenario) it was lived in. */
export function endingScore(state: GameState, e: EndingDef): number {
  return endingChoiceScore(state, e) + (scenarioOf(state).endingBonus?.[e.id] ?? 0);
}

export function endingOf(state: GameState): EndingDef {
  return [...ENDINGS].sort((a, b) => endingScore(state, b) - endingScore(state, a))[0];
}

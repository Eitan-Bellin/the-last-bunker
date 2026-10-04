import type { GameState } from '../core/GameState';
import { relationLevel } from './trade';

/**
 * [Long game P5] How the run ends (long-game plan, pillar E): when the last Act is complete, the bunker's story closes
 * in the way it was lived. The ending is read from the choices that shaped the run (doctrines, the world outside,
 * the projects built) and adds to the Legacy.
 */
export interface EndingDef {
  id: 'commonwealth' | 'fortress' | 'garden' | 'ark';
  icon: string;
  name: Record<'he' | 'en', string>;
  text: Record<'he' | 'en', string>;
  /** Extra Legacy (share of the Genesis payout). */
  legacy: number;
  /** How strongly this run fits the ending (the highest wins; the Ark is the default). */
  score: (s: GameState) => number;
}

const done = (s: GameState, id: string) => !!s.research[id]?.completed;
const law = (s: GameState, id: string) => (s.longGame?.policy.laws ?? []).includes(id);
const contracts = (s: GameState) => (s.stats as unknown as { contractsDone?: number }).contractsDone ?? 0;

export const ENDINGS: EndingDef[] = [
  {
    id: 'commonwealth', icon: '[[chat]]', legacy: 0.1,
    name: { he: 'חבר העמים', en: 'The Commonwealth' },
    text: {
      he: 'בונקר 17 לא נשאר מתחת לאדמה. הדרכים שסללתם, החוזים ששמרתם והאנשים שהאכלתם הפכו שכנים לברית. כשתתחיל הבראשית, היא תתחיל עם חברים.',
      en: 'Bunker 17 did not stay underground. The roads you paved, the contracts you kept and the people you fed turned neighbours into an alliance. When Genesis begins, it begins among friends.',
    },
    // Read from the choices: the Diplomacy doctrine, the Commune, open doors, and friends on every road.
    score: s => (done(s, 'diplomacy') ? 3 : 0) + (done(s, 'commune') ? 1 : 0) + (law(s, 'openDoors') ? 1 : 0)
      + (['terminus', 'clan', 'noa'].every(p => relationLevel(s, p) >= 5) ? 1 : 0) + Math.min(0.5, contracts(s) / 4000),
  },
  {
    id: 'fortress', icon: '[[vault]]', legacy: 0.1,
    name: { he: 'המבצר', en: 'The Fortress' },
    text: {
      he: 'העולם ניסה לקחת ממכם שוב ושוב, ושוב ושוב הדלת החזיקה. מה שתעבירו לעולם הבא הוא לא רק זרעים וספרים, אלא הידיעה שאפשר לעמוד.',
      en: 'The world tried to take from you again and again, and again and again the door held. What you carry into the next world is not only seeds and books, but the knowledge that one can stand.',
    },
    score: s => (done(s, 'fortress') ? 2 : 0) + (done(s, 'rangers') ? 2 : 0) + (done(s, 'militia') ? 1 : 0) + (done(s, 'bunkerDoctrine') ? 1 : 0) + (law(s, 'martialLaw') ? 1 : 0),
  },
  {
    id: 'garden', icon: '[[clover]]', legacy: 0.1,
    name: { he: 'הגן', en: 'The Garden' },
    text: {
      he: 'מתחת לכיפת השמיים גדלים עכשיו עצים שאף אחד כאן לא ראה מעולם. אתם מוכנים לבראשית כמו שגננים מוכנים לאביב: עם זרעים בכיס וידיים בעפר.',
      en: 'Under the Sky Dome now grow trees nobody here had ever seen. You are ready for Genesis the way gardeners are ready for spring: seeds in the pocket and hands in the soil.',
    },
    score: s => (done(s, 'mycelium') || done(s, 'surfaceFarms') ? 2 : done(s, 'hydroDoctrine') ? 1 : 0) + (s.storyFlags.includes('project:skyDome') ? 1 : 0)
      + (law(s, 'dayOfRest') ? 1 : 0) + (law(s, 'rationing') ? 0.5 : 0),
  },
  {
    id: 'ark', icon: '[[vault]]', legacy: 0.05,
    name: { he: 'התיבה', en: 'The Ark' },
    text: {
      he: 'לא כל מה שבניתם ישרוד את המעבר. אבל השמות, השירים והזרעים בתיבה כן. מישהו בעולם הבא יפתח אותה, ויידע שהייתם כאן.',
      en: 'Not everything you built will survive the crossing. But the names, the songs and the seeds in the Ark will. Someone in the next world will open it, and know that you were here.',
    },
    score: () => 1.5,
  },
];

export function endingOf(state: GameState): EndingDef {
  return [...ENDINGS].sort((a, b) => b.score(state) - a.score(state))[0];
}

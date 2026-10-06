import type { GameState } from '../core/GameState';
import { projectDone } from './projects';
import { relationLevel } from './trade';

/**
 * The long game's Acts (long-game plan, section 5): the run's chapters. Eras stay the bunker's look and story beats;
 * Acts set how far the bunker may grow (room level, people, floors) and what it must achieve to move on. Each Act
 * ends with its charter: big projects (src/data/projects.ts, `charter`) built in stages with resources and crew.
 * Release 1 has Acts I-IV; Genesis opens when Act IV is complete.
 */
/** [Q2] What kind of work a goal is, so the guide (src/systems/Guide.ts) can say what blocks it and where to go. */
export type GoalKind = 'era' | 'ruins' | 'research' | 'dig' | 'levels' | 'pop' | 'outposts' | 'influence' | 'seedVault';

export interface ActGoal {
  kind: GoalKind;
  /** For 'levels' goals: the room level (Mk) the goal counts. */
  level?: number;
  text: Record<'he' | 'en', string>;
  progress: (s: GameState) => [number, number];
}

export interface ActDef {
  id: number;
  name: Record<'he' | 'en', string>;
  tagline: Record<'he' | 'en', string>;
  /** Highest room level (Mk) in this Act. */
  levelCap: number;
  /** Most people the bunker can hold in this Act (beds beyond it stay empty). */
  popCap: number;
  /** Deepest floor count that may be dug in this Act. */
  floorCap: number;
  /** What it takes to finish this Act (the charter projects are added to these). */
  goals: ActGoal[];
  /** Projects that make up this Act's charter. */
  charter: string[];
  /** [UX] What this Act opens, in plain words (shown on its title card). */
  opens?: Record<'he' | 'en', string>;
}

const researched = (s: GameState) => Object.values(s.research).filter(r => r.completed).length;
const allCleared = (s: GameState): [number, number] => {
  // A cleared ruin leaves the list: done = cleared, left = what still stands.
  const left = s.ruins?.length ?? 0;
  const done = s.ruinsCleared ?? 0;
  return left === 0 ? [1, 1] : [done, done + left];
};
const atLeast = (have: number, want: number): [number, number] => [Math.min(have, want), want];
/** Rooms at or above a level. */
const roomsAt = (s: GameState, level: number) => s.buildings.filter(b => b.level >= level && !(b.isConstructing && b.level === level)).length;

export const ACTS: ActDef[] = [
  {
    id: 1,
    name: { he: 'מערכה I · לשרוד', en: 'Act I · Survive' },
    tagline: { he: 'להחזיר חיים למקום מת', en: 'Bring a dead place back to life' },
    levelCap: 3, popCap: 12, floorCap: 5,
    goals: [
      { kind: 'era', text: { he: 'הגיעו לעידן המושבה', en: 'Reach the Colony era' }, progress: s => atLeast(s.era ?? 0, 2) },
      { kind: 'ruins', text: { he: 'פנו את כל ההריסות', en: 'Clear every ruin' }, progress: allCleared },
      { kind: 'research', text: { he: 'השלימו 10 מחקרים', en: 'Complete 10 researches' }, progress: s => atLeast(researched(s), 10) },
    ],
    charter: ['vaultSeal'],
  },
  {
    id: 2,
    name: { he: 'מערכה II · לשקם', en: 'Act II · Rebuild' },
    tagline: { he: 'מבונקר לבית', en: 'From a bunker to a home' },
    levelCap: 5, popCap: 30, floorCap: 8,
    goals: [
      { kind: 'dig', text: { he: 'חפרו 8 קומות', en: 'Dig 8 levels' }, progress: s => atLeast(s.currentFloors, 8) },
      { kind: 'research', text: { he: 'השלימו 22 מחקרים', en: 'Complete 22 researches' }, progress: s => atLeast(researched(s), 22) },
      { kind: 'levels', level: 5, text: { he: '10 חדרים ברמה 5', en: '10 rooms at level 5' }, progress: s => atLeast(roomsAt(s, 5), 10) },
    ],
    charter: ['radioMast', 'purifier'],
    opens: { he: 'נפתחים: חוזים עם העולם בחוץ, מנהל העבודה, עונות השנה, ודוקטרינות חשמל ומזון במחקר. החלטות שאינן דחופות מחכות בתיבת ההחלטות.', en: 'Opens: contracts with the world outside, the Foreman, the seasons, and power and food doctrines in research. Decisions that can wait now wait in the Decisions inbox.' },
  },
  {
    id: 3,
    name: { he: 'מערכה III · להתיישב', en: 'Act III · Settle' },
    tagline: { he: 'קהילה שמייצרת בעצמה', en: 'A community that makes its own' },
    levelCap: 7, popCap: 65, floorCap: 11,
    goals: [
      { kind: 'era', text: { he: 'הגיעו לעידן העיר התחתית', en: 'Reach the Undercity era' }, progress: s => atLeast(s.era ?? 0, 3) },
      { kind: 'dig', text: { he: 'חפרו 11 קומות', en: 'Dig 11 levels' }, progress: s => atLeast(s.currentFloors, 11) },
      { kind: 'levels', level: 7, text: { he: '8 חדרים ברמה 7', en: '8 rooms at level 7' }, progress: s => atLeast(roomsAt(s, 7), 8) },
    ],
    charter: ['greenhouse', 'archive', 'metroTunnel'],
    opens: { he: 'נפתחים: רכיבים (פס הרכבה בבית המלאכה), מאחזים על פני השטח, החוק הראשון, ודוקטרינות חברה והגנה.', en: 'Opens: components (Assembly Line in the workshop), outposts on the surface, the first law, and society and defense doctrines.' },
  },
  {
    id: 4,
    name: { he: 'מערכה IV · להתרחב', en: 'Act IV · Expand' },
    tagline: { he: 'עיר שלמה מתחת לעולם', en: 'A whole city beneath the world' },
    levelCap: 9, popCap: 110, floorCap: 14,
    goals: [
      { kind: 'dig', text: { he: 'חפרו 14 קומות', en: 'Dig 14 levels' }, progress: s => atLeast(s.currentFloors, 14) },
      { kind: 'levels', level: 9, text: { he: '6 חדרים ברמה 9', en: '6 rooms at level 9' }, progress: s => atLeast(roomsAt(s, 9), 6) },
      { kind: 'pop', text: { he: 'הגיעו ל־90 ניצולים', en: 'Reach 90 survivors' }, progress: s => atLeast(s.survivors.length, 90) },
    ],
    charter: ['wall', 'deepFoundry'],
    opens: { he: 'נפתחים: סגסוגות (כבשן קשת בגנרטור), חדרים עד רמה 9, ועוד מאחזים.', en: 'Opens: alloys (Arc Furnace in the generator), rooms up to level 9, and more outposts.' },
  },
  {
    id: 5,
    name: { he: 'מערכה V · לעלות', en: 'Act V · Rise' },
    tagline: { he: 'שחר מעל האפר', en: 'Dawn above the ash' },
    levelCap: 10, popCap: 150, floorCap: 17,
    goals: [
      { kind: 'outposts', text: { he: 'החזיקו 3 מאחזים', en: 'Hold 3 outposts' }, progress: s => atLeast(((s.longGame?.world.outposts ?? []) as unknown[]).length, 3) },
      { kind: 'dig', text: { he: 'חפרו 17 קומות', en: 'Dig 17 levels' }, progress: s => atLeast(s.currentFloors, 17) },
      { kind: 'levels', level: 10, text: { he: '8 חדרים ברמה 10', en: '8 rooms at level 10' }, progress: s => atLeast(roomsAt(s, 10), 8) },
    ],
    charter: ['surfaceGate', 'skyDome'],
    opens: { he: 'נפתחים: נתונים (כספת נתונים במעבדה), רמה 10, חוק שני.', en: 'Opens: data (Data Vault in the lab), level 10, a second law.' },
  },
  {
    id: 6,
    name: { he: 'מערכה VI · למשול', en: 'Act VI · Govern' },
    tagline: { he: 'רפובליקה בין שכנים', en: 'A republic among neighbours' },
    levelCap: 10, popCap: 190, floorCap: 20,
    goals: [
      { kind: 'influence', text: { he: 'צברו 1,500 השפעה', en: 'Gather 1,500 influence' }, progress: s => atLeast(Math.floor(s.resources.influence?.amount ?? 0), 1500) },
      { kind: 'pop', text: { he: 'הגיעו ל־150 ניצולים', en: 'Reach 150 survivors' }, progress: s => atLeast(s.survivors.length, 150) },
      { kind: 'dig', text: { he: 'חפרו 20 קומות', en: 'Dig 20 levels' }, progress: s => atLeast(s.currentFloors, 20) },
    ],
    charter: ['tradeLeague', 'constitution'],
    opens: { he: 'נפתחים: השפעה (אולם המועצה בחדר האוכל), חוק שלישי.', en: 'Opens: influence (Council Hall in the canteen), a third law.' },
  },
  {
    id: 7,
    name: { he: 'מערכה VII · בראשית', en: 'Act VII · Genesis' },
    tagline: { he: 'מה שיעבור לעולם הבא', en: 'What will cross into the next world' },
    levelCap: 10, popCap: 190, floorCap: 24,
    goals: [
      { kind: 'dig', text: { he: 'חפרו 24 קומות', en: 'Dig 24 levels' }, progress: s => atLeast(s.currentFloors, 24) },
      { kind: 'pop', text: { he: 'הגיעו ל־170 ניצולים', en: 'Reach 170 survivors' }, progress: s => atLeast(s.survivors.length, 170) },
      { kind: 'seedVault', text: { he: 'השלימו את כספת הזרעים (מחקר)', en: 'Complete the Seed Vault (research)' }, progress: s => [s.research.seedVault?.completed ? 1 : 0, 1] },
    ],
    charter: ['ark', 'genesisCore'],
    opens: { he: 'נפתחים: ליבות זרע (כור הזרעים), התיבה וליבת בראשית.', en: 'Opens: seed cores (the Seed Forge), the Ark and the Genesis Core.' },
  },
];

/** The deepest the bunker can ever go in this release, and the highest room level. */
export const MAX_ACT = ACTS.length;

/**
 * [Q7] Contracts and seasons open this long after Act II begins (day ~4 for an engaged player), so the second Act no longer
 * lands five new systems on day 1.5. A bunker from before the long game, and every later Act, has them from the start.
 */
export const ACT2_LATE_SYSTEMS_AFTER = 2.5 * 86_400;

export function lateActTwoSystems(state: GameState): boolean {
  const lg = state.longGame;
  if (!lg) return false;
  if (lg.meta.legacy || lg.meta.act >= 3) return lg.meta.act >= 2;
  return lg.meta.act === 2 && lg.meta.worldT - lg.meta.actSince >= ACT2_LATE_SYSTEMS_AFTER;
}

export function actOf(state: GameState): ActDef {
  const n = state.longGame?.meta.act ?? 1;
  return ACTS[Math.min(ACTS.length, Math.max(1, n)) - 1];
}

/** Every goal of the Act, charter projects included, with its progress. */
export function actGoals(state: GameState, act: ActDef = actOf(state)): { text: Record<'he' | 'en', string>; progress: [number, number]; project?: string }[] {
  return [
    ...act.goals.map(g => ({ text: g.text, progress: g.progress(state) })),
    ...act.charter.map(id => ({ text: { he: '', en: '' }, progress: [projectDone(state, id) ? 1 : 0, 1] as [number, number], project: id })),
  ];
}

export function actComplete(state: GameState, act: ActDef = actOf(state)): boolean {
  return actGoals(state, act).every(g => g.progress[0] >= g.progress[1]);
}

/** A room type's highest level right now: its own top level, held to the Act's ceiling. */
export function levelCapFor(state: GameState, defMax: number): number {
  // Rooms with fewer levels (districts and halls: 5) count each level as two Mk steps.
  return Math.min(defMax, Math.max(1, Math.floor((actOf(state).levelCap * defMax) / 10)));
}

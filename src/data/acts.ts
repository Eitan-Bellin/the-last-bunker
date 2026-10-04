import type { GameState } from '../core/GameState';
import { projectDone } from './projects';
import { relationLevel } from './trade';

/**
 * The long game's Acts (long-game plan, section 5): the run's chapters. Eras stay the bunker's look and story beats;
 * Acts set how far the bunker may grow (room level, people, floors) and what it must achieve to move on. Each Act
 * ends with its charter: big projects (src/data/projects.ts, `charter`) built in stages with resources and crew.
 * Release 1 has Acts I-IV; Genesis opens when Act IV is complete.
 */
export interface ActGoal {
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
}

const researched = (s: GameState) => Object.values(s.research).filter(r => r.completed).length;
const allCleared = (s: GameState): [number, number] => {
  const total = s.ruins?.length ?? 0;
  return total === 0 ? [1, 1] : [Math.min(total, s.ruinsCleared ?? 0), total];
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
      { text: { he: 'הגיעו לעידן המושבה', en: 'Reach the Colony era' }, progress: s => atLeast(s.era ?? 0, 2) },
      { text: { he: 'פנו את כל ההריסות', en: 'Clear every ruin' }, progress: allCleared },
      { text: { he: 'השלימו 10 מחקרים', en: 'Complete 10 researches' }, progress: s => atLeast(researched(s), 10) },
    ],
    charter: ['vaultSeal'],
  },
  {
    id: 2,
    name: { he: 'מערכה II · לשקם', en: 'Act II · Rebuild' },
    tagline: { he: 'מבונקר לבית', en: 'From a bunker to a home' },
    levelCap: 5, popCap: 30, floorCap: 8,
    goals: [
      { text: { he: 'חפרו 8 קומות', en: 'Dig 8 levels' }, progress: s => atLeast(s.currentFloors, 8) },
      { text: { he: 'השלימו 22 מחקרים', en: 'Complete 22 researches' }, progress: s => atLeast(researched(s), 22) },
      { text: { he: '10 חדרים ברמה 5', en: '10 rooms at level 5' }, progress: s => atLeast(roomsAt(s, 5), 10) },
    ],
    charter: ['radioMast', 'purifier'],
  },
  {
    id: 3,
    name: { he: 'מערכה III · להתיישב', en: 'Act III · Settle' },
    tagline: { he: 'קהילה שמייצרת בעצמה', en: 'A community that makes its own' },
    levelCap: 7, popCap: 65, floorCap: 11,
    goals: [
      { text: { he: 'הגיעו לעידן העיר התחתית', en: 'Reach the Undercity era' }, progress: s => atLeast(s.era ?? 0, 3) },
      { text: { he: 'חפרו 11 קומות', en: 'Dig 11 levels' }, progress: s => atLeast(s.currentFloors, 11) },
      { text: { he: '8 חדרים ברמה 7', en: '8 rooms at level 7' }, progress: s => atLeast(roomsAt(s, 7), 8) },
    ],
    charter: ['greenhouse', 'archive', 'metroTunnel'],
  },
  {
    id: 4,
    name: { he: 'מערכה IV · להתרחב', en: 'Act IV · Expand' },
    tagline: { he: 'עיר שלמה מתחת לעולם', en: 'A whole city beneath the world' },
    levelCap: 9, popCap: 110, floorCap: 14,
    goals: [
      { text: { he: 'חפרו 14 קומות', en: 'Dig 14 levels' }, progress: s => atLeast(s.currentFloors, 14) },
      { text: { he: '6 חדרים ברמה 9', en: '6 rooms at level 9' }, progress: s => atLeast(roomsAt(s, 9), 6) },
      { text: { he: 'הגיעו ל־90 ניצולים', en: 'Reach 90 survivors' }, progress: s => atLeast(s.survivors.length, 90) },
    ],
    charter: ['wall', 'deepFoundry'],
  },
  {
    id: 5,
    name: { he: 'מערכה V · לעלות', en: 'Act V · Rise' },
    tagline: { he: 'שחר מעל האפר', en: 'Dawn above the ash' },
    levelCap: 10, popCap: 150, floorCap: 17,
    goals: [
      { text: { he: 'החזיקו 3 מאחזים', en: 'Hold 3 outposts' }, progress: s => atLeast(((s.longGame?.world.outposts ?? []) as unknown[]).length, 3) },
      { text: { he: 'חפרו 17 קומות', en: 'Dig 17 levels' }, progress: s => atLeast(s.currentFloors, 17) },
      { text: { he: '8 חדרים ברמה 10', en: '8 rooms at level 10' }, progress: s => atLeast(roomsAt(s, 10), 8) },
    ],
    charter: ['surfaceGate', 'skyDome'],
  },
  {
    id: 6,
    name: { he: 'מערכה VI · למשול', en: 'Act VI · Govern' },
    tagline: { he: 'רפובליקה בין שכנים', en: 'A republic among neighbours' },
    levelCap: 10, popCap: 190, floorCap: 20,
    goals: [
      { text: { he: 'צברו 1,500 השפעה', en: 'Gather 1,500 influence' }, progress: s => atLeast(Math.floor(s.resources.influence?.amount ?? 0), 1500) },
      { text: { he: 'הגיעו ל־150 ניצולים', en: 'Reach 150 survivors' }, progress: s => atLeast(s.survivors.length, 150) },
      { text: { he: 'חפרו 20 קומות', en: 'Dig 20 levels' }, progress: s => atLeast(s.currentFloors, 20) },
    ],
    charter: ['tradeLeague', 'constitution'],
  },
  {
    id: 7,
    name: { he: 'מערכה VII · בראשית', en: 'Act VII · Genesis' },
    tagline: { he: 'מה שיעבור לעולם הבא', en: 'What will cross into the next world' },
    levelCap: 10, popCap: 190, floorCap: 24,
    goals: [
      { text: { he: 'חפרו 24 קומות', en: 'Dig 24 levels' }, progress: s => atLeast(s.currentFloors, 24) },
      { text: { he: 'הגיעו ל־170 ניצולים', en: 'Reach 170 survivors' }, progress: s => atLeast(s.survivors.length, 170) },
      { text: { he: 'השלימו את כספת הזרעים (מחקר)', en: 'Complete the Seed Vault (research)' }, progress: s => [s.research.seedVault?.completed ? 1 : 0, 1] },
    ],
    charter: ['ark', 'genesisCore'],
  },
];

/** The deepest the bunker can ever go in this release, and the highest room level. */
export const MAX_ACT = ACTS.length;

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
  return Math.min(defMax, actOf(state).levelCap);
}

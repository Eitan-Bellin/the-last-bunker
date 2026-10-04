import type { GameState } from '../core/GameState';
import { START_FLOODED } from './ruins';

export type EraKey = 'remnant' | 'restoration' | 'colony' | 'undercity';

export interface EraGoal {
  text: Record<string, string>;
  progress: (s: GameState) => [number, number];
}

export interface EraDef {
  id: number;
  key: EraKey;
  name: Record<string, string>;
  tagline: Record<string, string>;
  /** Shown when the era begins. */
  story: Record<string, string>;
  /** Scene grading: tint multiplies colors, the rest feed a color matrix. */
  grade: { tint: number; saturation: number; brightness: number; contrast: number };
  /** How dark the unlit parts of the bunker are (0 = fully lit). */
  gloom: number;
  /** Painted look (gfx2): base light level of the unlit structure, before the lamps add theirs (0..1). */
  ambient: number;
  /** Goals to reach the next era (empty for the last). */
  next: EraGoal[];
}

const restored = (s: GameState, t: string) => s.buildings.some(b => b.type === t && !(b.isConstructing && b.level === 1));
/** Bunkers that never had ruins (saves from before restoration existed) count as fully cleared. */
const cleared = (s: GameState) => ((s.ruins?.length ?? 0) === 0 ? 99 : (s.ruinsCleared ?? 0));
/** S8: at least one flooded area drained (true when the map never had one, or for saves from before ruins). */
const drained = (s: GameState) => START_FLOODED === 0 || (s.ruins?.length ?? 0) === 0 || s.ruins.filter(r => r.flooded).length < START_FLOODED;
/** Six areas cleared, but the sixth only counts once a flooded one is among them. */
const remnantClears = (s: GameState): [number, number] => [Math.min(drained(s) ? 6 : 5, cleared(s)), 6];
/** Power the bunker generates right now (per second). */
const powerOut = (s: GameState) => Math.floor(s.resources.power?.productionRate ?? 0);
const explored = (s: GameState) => s.explorationMap.filter(h => h.explored && h.biome !== 'bunker').length;
const researched = (s: GameState) => Object.values(s.research).filter(r => r.completed).length;
const bool = (v: boolean): [number, number] => [v ? 1 : 0, 1];

export const ERAS: EraDef[] = [
  {
    id: 0, key: 'remnant',
    name: { he: 'השריד', en: 'The Remnant' },
    tagline: { he: 'מקום מת שמחכה לחיים', en: 'A dead place waiting for life' },
    story: {
      he: 'שבע שנים אחרי האפר. הדלת של בונקר 17 נפתחה בפעם הראשונה מזה שנים, ובפנים רק אבק, מים עומדים ושקט. מישהו גר כאן לפניכם.',
      en: 'Seven years after the ashes. The door of Bunker 17 opened for the first time in years, and inside there is only dust, standing water and silence. Someone lived here before you.',
    },
    // G4: no extra contrast in the dark eras, it crushed the (already dark) wrecked kit to black.
    grade: { tint: 0xd2d6de, saturation: 0.66, brightness: 0.98, contrast: 1.0 },
    gloom: 0.55,
    ambient: 0.22,
    next: [
      { text: { he: 'שקמו את הגנרטור', en: 'Restore the generator' }, progress: s => bool(restored(s, 'generator')) },
      { text: { he: 'שקמו משאבת מים וחווה', en: 'Restore a water pump and a farm' }, progress: s => [Number(restored(s, 'waterPump')) + Number(restored(s, 'farm')), 2] },
      START_FLOODED > 0
        ? { text: { he: 'פנו 6 אזורים, ביניהם אזור מוצף', en: 'Clear 6 areas, including a flooded one' }, progress: remnantClears }
        : { text: { he: 'פנו 6 אזורים הרוסים', en: 'Clear 6 ruined areas' }, progress: remnantClears },
    ],
  },
  {
    id: 1, key: 'restoration',
    name: { he: 'השיקום', en: 'Restoration' },
    tagline: { he: 'האורות חוזרים', en: 'The lights come back' },
    story: {
      he: 'הגנרטור נוהם, המים זורמים, ובחווה נובטים הזרעים שהשאירו הדיירים הקודמים. הבונקר כבר לא קבר. הוא בית.',
      en: 'The generator hums, the water flows, and the seeds the previous residents left behind are sprouting. The bunker is no longer a tomb. It is a home.',
    },
    grade: { tint: 0xe8e2d8, saturation: 0.85, brightness: 0.97, contrast: 1.0 },
    gloom: 0.3,
    ambient: 0.32,
    next: [
      { text: { he: 'הגיעו ל־10 ניצולים', en: 'Reach 10 survivors' }, progress: s => [Math.min(10, s.survivors.length), 10] },
      { text: { he: 'חפרו קומה רביעית', en: 'Dig a fourth level' }, progress: s => [Math.min(4, s.currentFloors), 4] },
      { text: { he: 'השלימו 6 מחקרים', en: 'Complete 6 researches' }, progress: s => [Math.min(6, researched(s)), 6] },
    ],
  },
  {
    id: 2, key: 'colony',
    name: { he: 'המושבה', en: 'The Colony' },
    tagline: { he: 'קהילה מתחת לאדמה', en: 'A community underground' },
    story: {
      he: 'הבונקר מלא קולות: ילדים במסדרון, מוזיקה מחדר האוכל, ויכוחים על תורנויות. מושבה של ממש נולדה מתחת לאפר.',
      en: 'The bunker is full of voices: children in the corridor, music from the canteen, arguments over chores. A real colony was born beneath the ash.',
    },
    grade: { tint: 0xfff2e0, saturation: 1.0, brightness: 1.02, contrast: 1.02 },
    gloom: 0.15,
    ambient: 0.4,
    next: [
      // Economy pass: the Undercity is the run-up to Genesis, so its gate is a long goal that also moves while away
      // (expeditions), and power is measured by output instead of one reactor that a full bunker may have no room for.
      { text: { he: 'הגיעו ל־40 ניצולים', en: 'Reach 40 survivors' }, progress: s => [Math.min(40, s.survivors.length), 40] },
      { text: { he: 'ייצרו 250 חשמל בשנייה (כור עוזר מאוד)', en: 'Generate 250 power per second (a reactor helps a lot)' }, progress: s => [Math.min(250, powerOut(s)), 250] },
      { text: { he: 'חפרו 7 קומות', en: 'Dig 7 levels' }, progress: s => [Math.min(7, s.currentFloors), 7] },
      // [P4] The Undercity is earned by deeds, not by waiting for expeditions: fewer areas, and contracts with the world outside.
      { text: { he: 'חקרו 80 אזורים על פני השטח', en: 'Explore 80 areas of the surface' }, progress: s => [Math.min(80, explored(s)), 80] },
      {
        text: { he: 'השלימו 8 חוזים (ממערכה II)', en: 'Complete 8 contracts (from Act II)' },
        progress: s => (!s.longGame || s.longGame.meta.legacy ? [1, 1] : [Math.min(8, (s.stats as unknown as { contractsDone?: number }).contractsDone ?? 0), 8]),
      },
      {
        text: { he: 'פרצו למחוז או בנו אולם דו־קומתי', en: 'Open a district or raise a two-storey hall' },
        progress: s => bool(['cave', 'lake', 'metro', 'atrium', 'reactorHall'].some(t => restored(s, t))),
      },
    ],
  },
  {
    id: 3, key: 'undercity',
    name: { he: 'עיר תחתית', en: 'Undercity' },
    tagline: { he: 'עיר שלמה מתחת לעולם', en: 'A whole city beneath the world' },
    story: {
      he: 'מה שהתחיל כחדר אחד חלוד הוא עכשיו עיר: מחוזות, מנהרות, אורות שלא כבים. בפעם הראשונה מאז האפר, יש עתיד.',
      en: 'What began as one rusty room is now a city: districts, tunnels, lights that never go out. For the first time since the ashes, there is a future.',
    },
    grade: { tint: 0xffffff, saturation: 1.1, brightness: 1.05, contrast: 1.0 },
    gloom: 0.05,
    ambient: 0.48,
    next: [],
  },
];

export function eraOf(state: GameState): EraDef {
  return ERAS[Math.min(ERAS.length - 1, Math.max(0, state.era ?? 0))];
}

export function eraComplete(era: EraDef, state: GameState): boolean {
  return era.next.length > 0 && era.next.every(g => {
    const [c, t] = g.progress(state);
    return c >= t;
  });
}

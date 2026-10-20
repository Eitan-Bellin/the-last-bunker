import type { GameState, ResourceType } from '../core/GameState';
import { actBundle } from './pricing';

/**
 * [Balance plan P3-5, lean] Exodus: after the first Genesis the next timeline may begin somewhere else. A scenario is a place with
 * its own rules (what grows, what is scarce, how crowded the roads are), its own start and a lean toward one ending. The bunker the
 * player just finished stays on as a "home": it sends a share of the new Act's currency every hour (see `homeTribute`), so an earlier
 * timeline keeps helping the next one. The classic Bunker 17 is always on offer; the other sites open after the first Genesis.
 */
export interface ScenarioDef {
  id: string;
  icon: string;
  name: Record<'he' | 'en', string>;
  tagline: Record<'he' | 'en', string>;
  /** What is different here, in plain words. */
  rules: Record<'he' | 'en', string>;
  /** Output multipliers per resource (every room). */
  output?: Partial<Record<ResourceType, number>>;
  /** Digging a floor takes this many times as long. */
  digTime?: number;
  /** Gap between newcomers (smaller = more people). */
  arrivals?: number;
  /** Added to the threat meter's target. */
  threat?: number;
  /** Caravans take this many times as long. */
  caravans?: number;
  /** Walls hold this many times as well. */
  walls?: number;
  /** Start of the timeline: extra stock and extra dug floors. */
  start?: { stock?: Partial<Record<ResourceType, number>>; floors?: number };
  /** Added to an ending's score. */
  endingBonus?: Partial<Record<'commonwealth' | 'fortress' | 'garden' | 'ark', number>>;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'bunker17', icon: '[[vault]]',
    name: { he: 'בונקר 17', en: 'Bunker 17' },
    tagline: { he: 'הבית הישן: הדלת, הריסות, והעולם שמחכה בחוץ', en: 'The old home: the door, the ruins, and the world waiting outside' },
    rules: { he: 'הכללים הרגילים. בלי שינוי.', en: 'The usual rules. No changes.' },
  },
  {
    id: 'metro', icon: '[[car]]',
    name: { he: 'תחנת המטרו', en: 'The Metro Station' },
    tagline: { he: 'צומת של מנהרות: כולם עוברים כאן, ולא כולם באים בשלום', en: 'A crossroads of tunnels: everyone passes through, and not everyone comes in peace' },
    rules: { he: 'ניצולים מגיעים מהר ב־20%, שיירות מהירות ב־30%, אוכל −15% (אין שמש), האיום +5. הסוף נוטה לחבר העמים.', en: 'Newcomers arrive 20% faster, caravans 30% faster, food −15% (no sunlight), threat +5. The ending leans to the Commonwealth.' },
    output: { food: 0.85 }, arrivals: 0.8, caravans: 0.7, threat: 5,
    endingBonus: { commonwealth: 1.5 },
  },
  {
    id: 'mine', icon: '[[pick]]',
    name: { he: 'המכרה', en: 'The Mine' },
    tagline: { he: 'עפרות מתחת לרגליים, ושום דבר ירוק מעליהן', en: 'Ore underfoot, and nothing green above it' },
    rules: { he: 'חומרים +25%, גרוטאות +25%, חפירה מהירה ב־25%, אוכל −20%, מתחילים עם שתי קומות חפורות. הסוף נוטה למבצר.', en: 'Materials +25%, scrap +25%, digging 25% faster, food −20%, start with two floors dug. The ending leans to the Fortress.' },
    output: { materials: 1.25, scrap: 1.25, food: 0.8 }, digTime: 0.75, walls: 1.1,
    start: { floors: 2 },
    endingBonus: { fortress: 1.5 },
  },
  {
    id: 'seedvault', icon: '[[clover]]',
    name: { he: 'כספת הזרעים', en: 'The Seed Vault' },
    tagline: { he: 'מקום שקט, תאים מוארים, וקצת פחות מוכנות למלחמה', en: 'A quiet place, lit chambers, and a little less readiness for war' },
    rules: { he: 'אוכל +30%, מים +10%, ידע −10%, חומות חלשות ב־20%. מתחילים עם מלאי אוכל. הסוף נוטה לגן.', en: 'Food +30%, water +10%, knowledge −10%, walls 20% weaker. Start with a stock of food. The ending leans to the Garden.' },
    output: { food: 1.3, water: 1.1, knowledge: 0.9 }, walls: 0.8,
    start: { stock: { food: 120, water: 60 } },
    endingBonus: { garden: 1.5 },
  },
];

export function getScenario(id: string | undefined): ScenarioDef {
  return SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0];
}

export function scenarioOf(state: GameState): ScenarioDef {
  return getScenario(state.longGame?.meta.scenario);
}

/** Sites other than the classic one open after the first Genesis. */
export function scenarioUnlocked(state: GameState, id: string): boolean {
  return id === 'bunker17' || state.prestige.rebirthCount >= 1;
}

/** A bunker from an earlier timeline that still sends a share of the new Act's income home. */
export interface HomeSite {
  scenario: string;
  /** The Act it had reached when its timeline closed (1..7). */
  act: number;
  /** The timeline it came from (0 for the first). */
  run: number;
  ending?: string;
}

/** Share of one hour of the current Act's income each hour, per home: more for a home that got further. */
export function homeShare(home: HomeSite): number {
  return 0.01 * Math.max(1, home.act);
}

/** What the homes send each hour in the run's current Act (the Act's own mix of goods, see pricing.actBundle). */
export function homeTribute(state: GameState): Partial<Record<ResourceType, number>> {
  const lg = state.longGame;
  const homes = (lg?.meta.homes ?? []) as HomeSite[];
  if (!lg || homes.length === 0 || lg.meta.legacy) return {};
  const share = Math.min(0.12, homes.reduce((s, h) => s + homeShare(h), 0));
  return actBundle(Math.max(1, lg.meta.act), share);
}

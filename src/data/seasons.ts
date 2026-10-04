import type { GameState, ResourceType } from '../core/GameState';
import type { IconName } from '../ui/icons';

/**
 * [Long game] Seasons (long-game plan, pillar B): four of them, about four real days each, on the world clock, so
 * they turn while the player is away too and can be forecast exactly. Each one leans on a different part of the bunker.
 */
export interface SeasonDef {
  id: 'spring' | 'summer' | 'autumn' | 'winter';
  icon: IconName;
  name: Record<'he' | 'en', string>;
  desc: Record<'he' | 'en', string>;
  /** Output multipliers per resource (rooms). */
  output: Partial<Record<ResourceType, number>>;
  /** Rooms' power draw multiplier (heating in winter). */
  powerDemand: number;
  /** Raiders' strength (few travel in deep winter, many in summer). */
  raid: number;
  /** Gap between newcomers at the door (smaller = more people). */
  arrivals: number;
}

/** World seconds in a season. */
export const SEASON_SECONDS = 4 * 86_400;

export const SEASONS: readonly SeasonDef[] = [
  {
    id: 'spring', icon: 'clover', output: { food: 1.15 }, powerDemand: 1, raid: 1, arrivals: 0.8,
    name: { he: 'אביב', en: 'Spring' },
    desc: { he: 'אוכל +15% · יותר אנשים בדרכים', en: 'Food +15% · more people on the roads' },
  },
  {
    id: 'summer', icon: 'sun', output: { water: 0.85 }, powerDemand: 1, raid: 1.2, arrivals: 1,
    name: { he: 'קיץ', en: 'Summer' },
    desc: { he: 'מים −15% · פושטים חזקים יותר', en: 'Water −15% · stronger raiders' },
  },
  {
    id: 'autumn', icon: 'wheat', output: { food: 1.25, materials: 1.1 }, powerDemand: 1, raid: 1, arrivals: 1,
    name: { he: 'סתיו', en: 'Autumn' },
    desc: { he: 'קציר: אוכל +25% · חומרים +10%', en: 'Harvest: food +25% · materials +10%' },
  },
  {
    id: 'winter', icon: 'snow', output: { food: 0.75 }, powerDemand: 1.25, raid: 0.8, arrivals: 1.4,
    name: { he: 'חורף', en: 'Winter' },
    desc: { he: 'אוכל −25% · חימום: חשמל +25% · פחות פושטים', en: 'Food −25% · heating: power use +25% · fewer raiders' },
  },
];

/** The season at a world time, with how long it has left. */
export function seasonAt(state: GameState, worldT = state.longGame?.meta.worldT ?? 0): { index: number; def: SeasonDef; left: number } {
  const since = Math.max(0, worldT - (state.longGame?.season.startedAt ?? 0));
  const n = Math.floor(since / SEASON_SECONDS);
  const index = n % SEASONS.length;
  return { index, def: SEASONS[index], left: SEASON_SECONDS - (since - n * SEASON_SECONDS) };
}

/** The next season (the forecast). */
export function nextSeason(state: GameState): SeasonDef {
  return SEASONS[(seasonAt(state).index + 1) % SEASONS.length];
}

/** Seasons only matter once the bunker has a world to face (from the second Act). */
export function seasonsActive(state: GameState): boolean {
  return (state.longGame?.meta.act ?? 0) >= 2;
}

/** The current season's effects, or none before seasons start. */
export function seasonEffects(state: GameState): SeasonDef | null {
  return seasonsActive(state) ? seasonAt(state).def : null;
}

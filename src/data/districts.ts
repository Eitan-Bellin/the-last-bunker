import type { BuildingType, GameState, ResourceType } from '../core/GameState';
import type { IconName } from '../ui/icons';

/**
 * Districts (Sprint 7): natural spaces found by digging sideways out of the bunker's east wall.
 * Each is a wide painted cavern that works like a big room with its own trade.
 */
export type DistrictKind = 'cave' | 'lake' | 'metro';

export interface DistrictDef {
  kind: DistrictKind;
  icon: IconName;
  /** Lowest level index (0 = B1) where the tunnel can reach it. */
  floor: number;
  cost: Partial<Record<ResourceType, number>>;
  name: Record<'he' | 'en', string>;
  find: Record<'he' | 'en', string>;
}

export const DISTRICTS: DistrictDef[] = [
  {
    kind: 'cave', icon: 'sparkle', floor: 1,
    cost: { materials: 300, scrap: 60 },
    name: { he: 'מערת הגבישים', en: 'Crystal Cave' },
    find: {
      he: 'המכושים פרצו לחלל עצום. גבישים ירוקים זוהרים בקירות, ומים מטפטפים מהתקרה. מקום מושלם לכרייה, ולמחקר.',
      en: 'The picks broke into a vast hollow. Green crystals glow in the walls and water drips from the ceiling. Perfect for mining, and for study.',
    },
  },
  {
    kind: 'lake', icon: 'wave', floor: 2,
    cost: { materials: 500, scrap: 100 },
    name: { he: 'האגם התת־קרקעי', en: 'Underground Lake' },
    find: {
      he: 'מאחורי הסלע: אגם שקט ושחור, ועליו סירה ישנה קשורה למזח. המים נקיים. יש בהם דגים עיוורים.',
      en: 'Behind the rock: a still black lake with an old boat tied to a jetty. The water is clean. There are blind fish in it.',
    },
  },
  {
    kind: 'metro', icon: 'district', floor: 3,
    cost: { materials: 800, scrap: 160, blueprints: 1 },
    name: { he: 'תחנת המטרו הנטושה', en: 'Abandoned Metro Station' },
    find: {
      he: 'רציף שלם, קרון שירד מהפסים ושלטים חלודים. המנהרות ממשיכות לכל העיר. המשלחות יגיעו מהר יותר.',
      en: 'A whole platform, a derailed car and rusty signs. The tunnels run under the entire city. Expeditions will travel faster.',
    },
  },
];

export const DISTRICT_TYPES: BuildingType[] = DISTRICTS.map(d => d.kind);

export function districtDef(kind: string): DistrictDef | undefined {
  return DISTRICTS.find(d => d.kind === kind);
}

/** The next district the player can tunnel to, if any. */
export function nextDistrict(state: GameState): DistrictDef | undefined {
  if (!state.storyFlags.includes('districts:unlocked')) return undefined;
  return DISTRICTS.find(d => !state.buildings.some(b => b.type === d.kind) && d.floor < state.currentFloors);
}

/** Expeditions travel through the metro tunnels. */
export function metroSpeedup(state: GameState): number {
  return state.buildings.some(b => b.type === 'metro' && !b.isConstructing) ? 0.75 : 1;
}

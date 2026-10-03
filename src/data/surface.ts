import type { ResourceType } from '../core/GameState';

export type BiomeId = 'bunker' | 'ruins' | 'wasteland' | 'toxicForest' | 'shatteredCity' | 'caves' | 'militaryZone';

export interface BiomeDef {
  id: BiomeId;
  danger: number;
  color: number;
  name: Record<string, string>;
  loot: Partial<Record<ResourceType, [number, number]>>;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  bunker: { id: 'bunker', danger: 0, color: 0x6a6a72, name: { he: 'הבונקר', en: 'The Bunker' }, loot: {} },
  ruins: {
    id: 'ruins', danger: 1, color: 0x8a7a62, name: { he: 'הריסות', en: 'Ruins' },
    loot: { materials: [8, 18], scrap: [3, 8], food: [2, 6] },
  },
  wasteland: {
    id: 'wasteland', danger: 2, color: 0xa08a4a, name: { he: 'שממה', en: 'Wasteland' },
    loot: { scrap: [6, 14], materials: [6, 14], water: [3, 8] },
  },
  toxicForest: {
    id: 'toxicForest', danger: 3, color: 0x5a7a3a, name: { he: 'יער רעיל', en: 'Toxic Forest' },
    loot: { food: [8, 18], medicine: [2, 5], knowledge: [3, 8] },
  },
  shatteredCity: {
    id: 'shatteredCity', danger: 3, color: 0x6a6e7a, name: { he: 'עיר מנותצת', en: 'Shattered City' },
    loot: { materials: [14, 30], scrap: [10, 22], medicine: [1, 4] },
  },
  caves: {
    id: 'caves', danger: 3, color: 0x4a4048, name: { he: 'מערות', en: 'Caves' },
    loot: { water: [10, 20], scrap: [8, 16], knowledge: [2, 6] },
  },
  militaryZone: {
    id: 'militaryZone', danger: 4, color: 0x5a5a3a, name: { he: 'אזור צבאי', en: 'Military Zone' },
    loot: { scrap: [20, 40], materials: [16, 32], medicine: [3, 8] },
  },
};

export interface PoiDef {
  id: string;
  icon: string;
  name: Record<string, string>;
  loot: Partial<Record<ResourceType, number>>;
  recruit?: boolean;
  story?: boolean;
}

export const POIS: Record<string, PoiDef> = {
  supermarket: { id: 'supermarket', icon: '[[cart]]', name: { he: 'סופרמרקט', en: 'Supermarket' }, loot: { food: 40, water: 20 } },
  pharmacy: { id: 'pharmacy', icon: '[[medicine]]', name: { he: 'בית מרקחת', en: 'Pharmacy' }, loot: { medicine: 15 } },
  hardware: { id: 'hardware', icon: '[[build]]', name: { he: 'חנות כלי עבודה', en: 'Hardware Store' }, loot: { materials: 70, scrap: 15 } },
  junkyard: { id: 'junkyard', icon: '[[recycle]]', name: { he: 'מגרש גרוטאות', en: 'Junkyard' }, loot: { scrap: 60 } },
  library: { id: 'library', icon: '[[books]]', name: { he: 'ספרייה', en: 'Library' }, loot: { knowledge: 40 } },
  survivorCamp: { id: 'survivorCamp', icon: '[[tent]]', name: { he: 'מחנה ניצולים', en: 'Survivor Camp' }, loot: { food: 10 }, recruit: true },
  militaryDepot: { id: 'militaryDepot', icon: '[[medal]]', name: { he: 'מחסן צבאי', en: 'Military Depot' }, loot: { scrap: 60, blueprints: 1 } },
  abandonedLab: { id: 'abandonedLab', icon: '[[laboratory]]', name: { he: 'מעבדה נטושה', en: 'Abandoned Lab' }, loot: { knowledge: 60, blueprints: 1 } },
  crashSite: { id: 'crashSite', icon: '[[satellite]]', name: { he: 'לוויין שהתרסק', en: 'Crashed Satellite' }, loot: { scrap: 40, blueprints: 1, knowledge: 30 } },
  genesisVault: {
    id: 'genesisVault', icon: '[[isotope7]]', name: { he: 'כספת בראשית', en: 'Genesis Vault' },
    loot: { blueprints: 2, knowledge: 80, scrap: 80 }, story: true,
  },
};

/** Two outer rings beyond the old radius 7: far enough that only Vehicles reach them (270 hexes in all). */
export const MAP_RADIUS = 9;
/** How far a team can walk; the rings beyond need the Vehicles research. */
export const FOOT_RADIUS = 7;

/** Trip length in seconds before speed-ups: about 8 min next door, 45 min at the edge of the map. */
export function baseTripSeconds(distance: number, danger: number): number {
  return 120 + 240 * distance + 120 * danger;
}

/** Farther places haven't been picked clean: loot grows with the distance walked. */
export function distanceLootMult(distance: number): number {
  return 1 + 0.35 * distance;
}

/** A long haul: the team stays out for the night and comes back loaded. */
export const LONG_TRIP_TIME = 6;
export const LONG_TRIP_LOOT = 4;

export function hexDistance(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

export const HEX_NEIGHBORS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

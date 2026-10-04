import type { BuildingType } from '../core/GameState';

export type ZoneId = 'living' | 'agri' | 'engineering' | 'deep';

export interface ZoneDef {
  id: ZoneId;
  floor: number;
  icon: string;
  name: Record<string, string>;
  /** Wall tint and ambient light colour for the level. */
  rock: number;
  floorTile: number;
  ambient: number;
}

export const ZONES: ZoneDef[] = [
  {
    id: 'living', floor: 0, icon: '[[quarters]]',
    name: { he: 'מגורים', en: 'Living' },
    rock: 0x3d342c, floorTile: 0x55555e, ambient: 0xffc870,
  },
  {
    id: 'agri', floor: 1, icon: '[[farm]]',
    name: { he: 'חקלאות ומים', en: 'Farming & Water' },
    rock: 0x35382a, floorTile: 0x4e5650, ambient: 0xd8ffb0,
  },
  {
    id: 'engineering', floor: 2, icon: '[[settings]]',
    name: { he: 'הנדסה', en: 'Engineering' },
    rock: 0x34343a, floorTile: 0x4a4c54, ambient: 0xffb070,
  },
];

/** Levels dug below the three founding levels accept any room type. */
const DEEP: Omit<ZoneDef, 'floor'> = {
  id: 'deep', icon: '[[pick]]',
  name: { he: 'מפלס עמוק', en: 'Deep Level' },
  rock: 0x2e2a28, floorTile: 0x46464c, ambient: 0xffd8a0,
};

export const BASE_FLOORS = ZONES.length;
/** [Long game] 24 floors in all (the Acts open them a few at a time). */
export const MAX_FLOORS = 24;

const BUILDING_ZONE: Partial<Record<BuildingType, ZoneId>> = {
  quarters: 'living',
  canteen: 'living',
  medbay: 'living',
  radioTower: 'living',
  trainingRoom: 'living',
  armory: 'living',
  farm: 'agri',
  waterPump: 'agri',
  hydroponics: 'agri',
  waterPurifier: 'agri',
  generator: 'engineering',
  workshop: 'engineering',
  laboratory: 'engineering',
  reactor: 'engineering',
};

/** Floors a building type may be placed on: its own zone plus any deep level (storage fits anywhere). */
export function allowedFloors(type: BuildingType, totalFloors: number = BASE_FLOORS): number[] {
  const deep: number[] = [];
  for (let f = BASE_FLOORS; f < totalFloors; f++) deep.push(f);
  if (type === 'reactorHall') return deep;
  const zone = BUILDING_ZONE[type];
  if (!zone) return [...ZONES.map(z => z.floor), ...deep];
  return [ZONES.find(z => z.id === zone)!.floor, ...deep];
}

export function zoneForFloor(floor: number): ZoneDef {
  return ZONES.find(z => z.floor === floor) ?? { ...DEEP, floor };
}

export function needsWater(type: BuildingType): boolean {
  return type === 'farm' || type === 'canteen' || type === 'medbay' || type === 'quarters' || type === 'hydroponics';
}

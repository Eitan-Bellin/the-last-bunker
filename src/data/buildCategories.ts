import type { BuildingType } from '../core/GameState';

/**
 * [plan4:BL-39] The build menu's categories (02-new-buildings.md section 5). Every buildable room belongs to one; the menu only shows
 * the categories that have at least one buildable room, so the surface and trade chips appear when their rooms arrive.
 */
export type BuildCategory = 'living' | 'food' | 'power' | 'industry' | 'health' | 'defense' | 'surface' | 'infra' | 'trade';

/** Chip order. */
export const BUILD_CATEGORIES: { id: BuildCategory; icon: string }[] = [
  { id: 'living', icon: '[[quarters]]' },
  { id: 'food', icon: '[[food]]' },
  { id: 'power', icon: '[[power]]' },
  { id: 'industry', icon: '[[workshop]]' },
  { id: 'health', icon: '[[medbay]]' },
  { id: 'defense', icon: '[[armory]]' },
  { id: 'surface', icon: '[[surface]]' },
  { id: 'infra', icon: '[[storage]]' },
  { id: 'trade', icon: '[[cart]]' },
];

const CATEGORY_OF: Partial<Record<BuildingType, BuildCategory>> = {
  quarters: 'living', canteen: 'living', commons: 'living', library: 'living', atrium: 'living', trainingRoom: 'living', radioTower: 'living',
  farm: 'food', hydroponics: 'food', mushroomFarm: 'food', waterPump: 'food', waterPurifier: 'food', condenser: 'food',
  generator: 'power', reactor: 'power', reactorHall: 'power', batteryBank: 'power',
  workshop: 'industry', recycler: 'industry', laboratory: 'industry',
  medbay: 'health',
  armory: 'defense', gatePost: 'defense', barracks: 'defense',
  storage: 'infra',
  // [plan4:BL-15..32] wave 2 rooms
  quarantineWard: 'health', bathhouse: 'health', nursery: 'living', school: 'living', memorialHall: 'living',
  solarArray: 'surface', windTurbine: 'surface', watchtower: 'surface',
  garage: 'trade', market: 'trade', decon: 'trade',
  aquaculture: 'food',
};

/** A room's category; anything not listed yet counts as infrastructure. */
export function buildCategoryOf(type: BuildingType): BuildCategory {
  return CATEGORY_OF[type] ?? 'infra';
}

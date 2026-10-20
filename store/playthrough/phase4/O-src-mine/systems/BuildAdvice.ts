import type { BuildingType } from '../core/GameState';

/**
 * [plan4:BL-39] "Recommended now" for the build menu: which rooms answer which need, best first (power, water, food, beds, mood,
 * children). Pure data, like the Guide: nothing here changes the game.
 * [ux-redesign w2fix] The ranking itself lives in the Build menu (src/ui/components/BuildMenu.ts, by time-to-empty); the old
 * `recommendedRooms` function was moved to `_deprecated/systems/BuildAdvice.recommendedRooms.ts`. These lists are the one source.
 */
export interface BuildTip {
  type: BuildingType;
  /** i18n key of the reason ("build.rec.power"). */
  why: string;
}

/** Rooms that make each store, best first ([plan4:BL-16/17] roof power after the fuel plants). */
export const NEED_ROOMS: Record<'food' | 'water' | 'power', BuildingType[]> = {
  power: ['generator', 'reactor', 'solarArray', 'windTurbine'],
  water: ['waterPump', 'condenser', 'waterPurifier'],
  food: ['farm', 'hydroponics', 'mushroomFarm'],
};
/** Power is made but the store runs low: a battery. */
export const BATTERY_ROOMS: BuildingType[] = ['batteryBank'];
/** The bunker is (almost) full. */
export const BED_ROOMS: BuildingType[] = ['quarters', 'barracks'];
/** Mood is low. */
export const MORALE_ROOMS: BuildingType[] = ['commons', 'canteen'];
/** [plan4:BL-26/30] Children need a place of their own: a nursery first, then a school. */
export const KID_ROOMS = { first: ['nursery'] as BuildingType[], then: ['school'] as BuildingType[] };

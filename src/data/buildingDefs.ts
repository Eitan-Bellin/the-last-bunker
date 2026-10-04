import raw from './buildings.json';
import { masteryMultiplier } from './mastery'; // [LateGame B3]
import { timeOfDay } from './dayCycle';
import type { BuildingInstance, BuildingType, GameState, SurvivorStats } from '../core/GameState';

export interface ProductionEntry {
  base: number;
  perLevel: number;
}

export interface BuildingDef {
  name: Record<string, string>;
  description: Record<string, string>;
  tier: number;
  size: { w: number; h: number };
  maxLevel: number;
  baseCost: Record<string, number>;
  costMultiplier: number;
  constructionTime: number;
  production?: Record<string, ProductionEntry>;
  effects?: {
    maxPopulation?: { base: number; perLevel: number };
    morale?: { base: number; perLevel: number };
    defense?: { base: number; perLevel: number };
    storageCap?: Record<string, number>;
    unlockFloor?: boolean;
  };
  optimalStat?: keyof SurvivorStats;
  statBonusPerPoint?: number;
  baseEfficiency?: number;
  maxWorkers: number;
  powerConsumption: number;
  color: string;
}

export const BUILDING_DEFS = raw as unknown as Record<BuildingType, BuildingDef>;

export const BUILDABLE_TYPES: BuildingType[] = [
  'quarters', 'canteen', 'medbay', 'radioTower', 'trainingRoom', 'armory',
  'farm', 'waterPump', 'hydroponics', 'waterPurifier',
  'generator', 'workshop', 'laboratory', 'reactor',
  'storage', 'atrium', 'reactorHall',
];

/** Natural caverns reached by tunnelling sideways (not built from the menu). */
export const DISTRICT_KINDS: BuildingType[] = ['cave', 'lake', 'metro'];
/** Rooms that rise through two levels. */
export const HALL_KINDS: BuildingType[] = ['atrium', 'reactorHall'];
export const DISTRICT_SLOTS = 4;

export function isDistrict(type: BuildingType): boolean {
  return DISTRICT_KINDS.includes(type);
}

export function isHall(type: BuildingType): boolean {
  return HALL_KINDS.includes(type);
}

/** How many levels a room spans. */
export function roomFloors(type: BuildingType): number {
  return isHall(type) ? 2 : 1;
}

/** The classic top level (half the room's Mk ceiling): specialization opens here, and the old "max level" goals count it. */
export function specLevel(def: BuildingDef): number {
  return Math.max(1, Math.round(def.maxLevel / 2));
}

export function getDef(type: BuildingType): BuildingDef | undefined {
  return BUILDING_DEFS[type];
}

const TRAIT_BUILDING_BONUS: Record<string, BuildingType[]> = {
  greenThumb: ['farm', 'hydroponics'],
  engineer: ['generator', 'workshop', 'reactor', 'waterPurifier'],
  medic: ['medbay'],
  charming: ['canteen', 'radioTower'],
  quickLearner: ['laboratory'],
  tough: ['armory', 'trainingRoom'],
};

export function traitBonus(traits: string[], type: BuildingType): number {
  let bonus = 0;
  for (const t of traits) {
    if (TRAIT_BUILDING_BONUS[t]?.includes(type)) bonus += 0.25;
  }
  return bonus;
}

/** Width of a room in floor slots (the bunker is a side-on cross-section, one room deep). */
export function roomSlots(type: BuildingType): number {
  if (isDistrict(type)) return DISTRICT_SLOTS;
  if (isHall(type)) return 3;
  const def = getDef(type);
  if (!def) return 2;
  return def.size.w * def.size.h >= 4 ? 3 : 2;
}

/** Same-type, same-level rooms side by side form a compound; each neighbour adds 10%. */
export function compoundNeighbors(state: GameState, b: BuildingInstance): number {
  if (b.isConstructing && b.level === 1) return 0;
  const w = roomSlots(b.type);
  let n = 0;
  for (const o of state.buildings) {
    if (o === b || o.id === b.id || o.type !== b.type || o.level !== b.level || o.position.floor !== b.position.floor) continue;
    if (o.isConstructing && o.level === 1) continue;
    const ow = roomSlots(o.type);
    if (o.position.x + ow === b.position.x || b.position.x + w === o.position.x) n++;
  }
  return n;
}

/** Level the building operates at; while upgrading it keeps working at its previous level. */
export function effectiveLevel(b: BuildingInstance): number {
  return b.isConstructing ? b.level - 1 : b.level;
}

export function levelMultiplier(entry: { perLevel: number }, level: number): number {
  // [Economy A4] Diminishing returns at high levels: level 5 is ~x2.6 (was x3), so late rooms don't snowball.
  return 1 + entry.perLevel * Math.pow(Math.max(0, level - 1), 0.85);
}

/** Staffing x worker-skill multiplier for a building, before morale/power/prestige. */
export function workforceMultiplier(state: GameState, building: BuildingInstance): number {
  const def = getDef(building.type);
  const compound = 1 + 0.1 * compoundNeighbors(state, building);
  if (!def || def.maxWorkers === 0) return compound;

  const workers = building.assignedSurvivorIds
    .map(id => state.survivors.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s && !s.isOnMission);

  const baseEff = def.baseEfficiency ?? 0.2;
  const staffing = (baseEff + (1 - baseEff) * Math.min(1, workers.length / def.maxWorkers)) * compound;
  if (workers.length === 0) return staffing;

  let skill = 0;
  // Night owls work better after dark; a loner works better with the room to themselves.
  const night = timeOfDay(state.stats.totalPlayTime).night > 0.5;
  for (const w of workers) {
    const stat = def.optimalStat ? w.stats[def.optimalStat] : 5;
    let personal = traitBonus(w.traits, building.type);
    if (w.traits.includes('nightOwl') && night) personal += 0.2;
    if (w.traits.includes('loner') && workers.length === 1) personal += 0.25;
    skill += 1 + (stat - 5) * (def.statBonusPerPoint ?? 0.05) + personal;
  }
  skill /= workers.length;
  // [LateGame B3] Mastery: +5% per rank above 1, +15% for a Master.
  return staffing * Math.max(0.5, skill) * masteryMultiplier(workers);
}

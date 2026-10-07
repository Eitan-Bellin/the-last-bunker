import raw from './buildings.json';
import { masteryMultiplier } from './mastery'; // [LateGame B3]
import { timeOfDay, windAt } from './dayCycle';
import { SURFACE_TYPES, withSurfaceFallbacks } from './surfaceDefs'; // [plan4:ST-16]
import type { BuildingInstance, BuildingType, GameState, SurvivorStats } from '../core/GameState';

export interface ProductionEntry {
  base: number;
  perLevel: number;
}

/** [plan4:BL-1] Where a room may stand. Every field is optional; no `place` = the old rules (own zone plus deep levels). */
export interface PlaceRules {
  /** surface = the gate-house row above ground (floor -1), entrance = floor 0, deep = levels dug past the founding three, zone = the type's own zone (the old default, spelled out). [plan4:ST-16] entranceOrSurface = floor 0 or the surface row. */
  floors?: 'surface' | 'entrance' | 'entranceOrSurface' | 'deep' | 'zone';
  /** The room must touch (same floor, edge to edge) a room of this type; a lake district for the fish ponds. */
  adjacentTo?: BuildingType;
  /** A story flag (state.storyFlags) that must be set: the room opens by an event, not (or not only) by research. */
  needsFlag?: string;
  /** Lowest floor index it may stand on. */
  minFloor?: number;
}

/** [plan4:BL-3] The three morale channels: each has its own ceiling (22 / 6 / 6). */
export type MoraleKind = 'base' | 'comfort' | 'culture';

/** [plan4:BL-1] What a room does besides producing: every value is `base + perLevel * (level - 1)` unless said otherwise. */
export interface BuildingEffects {
  maxPopulation?: { base: number; perLevel: number };
  morale?: { base: number; perLevel: number };
  defense?: { base: number; perLevel: number };
  storageCap?: Record<string, number>;
  unlockFloor?: boolean;
  /** Which channel `morale` feeds (default 'base', the canteen channel). */
  moraleKind?: MoraleKind;
  /** Children (not workers) the room can hold: nursery, school. Separate from maxWorkers. */
  childCapacity?: ProductionEntry;
  /** Growing-up speed multiplier for the children of the bunker (1.25 + 0.05 per level for a nursery). */
  childGrowth?: ProductionEntry;
  /** Stat points a child who spent most of its childhood in the room gets on growing up (a school: 1). Needs childCapacity. */
  graduateStat?: number;
  /** Sick people the ward holds apart (they take half the epidemic's harm). */
  quarantine?: ProductionEntry;
  /** Seconds added to the raid warning (capped at 300 in all). */
  earlyWarning?: ProductionEntry;
  /** Expedition teams out at once: +1 for every level in this list the room has reached (e.g. [3, 8]). */
  expeditionTeams?: number[];
  /** Caravan cargo value, as a fraction (0.05 = +5%). */
  cargo?: ProductionEntry;
  /** Fraction cut from injuries on the way home from expeditions and caravans (capped at 0.5 in all). */
  returnSafety?: ProductionEntry;
  /** Fraction cut from the odds of epidemics and roaches (capped at 0.5 in all). */
  hygiene?: ProductionEntry;
  /** Fraction cut from the mourning penalty after a death (capped at 0.6 in all). */
  mourning?: ProductionEntry;
  /** Fewer injuries from fire and collapse within 3 floors (x0.6). */
  evacuation?: boolean;
  /** Points of crowding penalty the room takes away. */
  ventilation?: ProductionEntry;
  /** A fire does not jump into or out of this room. */
  firebreak?: boolean;
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
  effects?: BuildingEffects;
  /** [plan4:BL-1] Width in floor slots (1-5); overrides the width derived from `size` in roomSlots. */
  slots?: 1 | 2 | 3 | 4 | 5;
  /** [plan4:BL-1] Most rooms of this type the bunker may hold (placeBlock, the build menu and the bot respect it). */
  maxCopies?: number;
  place?: PlaceRules;
  /** [plan4:BL-8] Production follows the weather: daylight = the sun (nothing at night), wind = the gusts. */
  shape?: 'daylight' | 'wind';
  /** [plan4:BL-5] The build price grows with the Act (x1 .. x5, see actMult). Old rooms keep their price. */
  priceByAct?: boolean;
  optimalStat?: keyof SurvivorStats;
  statBonusPerPoint?: number;
  baseEfficiency?: number;
  maxWorkers: number;
  powerConsumption: number;
  color: string;
}

export const BUILDING_DEFS = withSurfaceFallbacks(raw as unknown as Record<BuildingType, BuildingDef>); // [plan4:ST-16] guarded: only adds a surface type buildings.json lacks

export const BUILDABLE_TYPES: BuildingType[] = [
  'quarters', 'canteen', 'medbay', 'radioTower', 'trainingRoom', 'armory',
  'farm', 'waterPump', 'hydroponics', 'waterPurifier',
  'generator', 'workshop', 'laboratory', 'reactor',
  'storage', 'atrium', 'reactorHall',
  // [plan4:BL-9..14,19,33] first eight new rooms
  'batteryBank', 'commons', 'library', 'recycler', 'condenser', 'mushroomFarm', 'gatePost', 'barracks',
];
// [plan4:ST-16] the surface row's rooms (a no-op for those a merge already listed above)
for (const t of SURFACE_TYPES) if (!BUILDABLE_TYPES.includes(t)) BUILDABLE_TYPES.push(t);

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

/** [plan4:BL-8] A room that makes power (generators, reactors, solar, wind): replaces the name lists in the HUD, the feedback sounds and the maintenance table. */
export function isPowerPlant(type: BuildingType): boolean {
  return !!getDef(type)?.production?.power;
}

/** [plan4:BL-5] Price multiplier of an Act (1-based) for rooms with `priceByAct`. */
export const ACT_PRICE_MULT = [1, 1, 1.5, 2.2, 3, 4, 5];
export function actMult(act: number): number {
  return ACT_PRICE_MULT[Math.min(ACT_PRICE_MULT.length, Math.max(1, Math.round(act))) - 1];
}

/** [plan4:BL-1] A room's effect at a level: `base + perLevel * (level - 1)`. */
export function entryAt(entry: ProductionEntry, level: number): number {
  return entry.base + entry.perLevel * (level - 1);
}

/** [plan4:BL-8] What the weather does to a room's output: 1 for rooms without a `shape`. */
export function shapeFactor(def: BuildingDef | undefined, playTime: number): number {
  if (!def?.shape) return 1;
  if (def.shape === 'daylight') return Math.max(0, 1 - timeOfDay(playTime).night);
  return 0.4 + 0.9 * windAt(playTime);
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
  const def = getDef(type);
  if (def?.slots) return def.slots; // [plan4:BL-1] an explicit width wins over the derived one
  if (isDistrict(type)) return DISTRICT_SLOTS;
  if (isHall(type)) return 3;
  if (!def) return 2;
  return def.size.w * def.size.h >= 4 ? 3 : 2;
}

/** [plan4:BL-1] Two rooms (or a room and a planned spot) touch when they share a floor and an edge: side by side with no gap. */
export function touching(a: { type: BuildingType; position: { x: number; floor: number } }, b: { type: BuildingType; position: { x: number; floor: number } }): boolean {
  if (a.position.floor !== b.position.floor) return false;
  return b.position.x + roomSlots(b.type) === a.position.x || a.position.x + roomSlots(a.type) === b.position.x;
}

/** Same-type, same-level rooms side by side form a compound; each neighbour adds 10%. */
export function compoundNeighbors(state: GameState, b: BuildingInstance): number {
  if (b.isConstructing && b.level === 1) return 0;
  let n = 0;
  for (const o of state.buildings) {
    if (o === b || o.id === b.id || o.type !== b.type || o.level !== b.level || o.position.floor !== b.position.floor) continue;
    if (o.isConstructing && o.level === 1) continue;
    if (touching(o, b)) n++;
  }
  return n;
}

/** [plan4:BL-1] A neighbour pair bonus (doc 02 section 2.5): rooms of type `a` and `b` that touch each get `value` of `effect`. */
export interface SynergyRule {
  a: BuildingType;
  b: BuildingType;
  /** What it improves; the reader of that effect adds `synergyBonus(state, room, effect)`. */
  effect: 'morale' | 'knowledge' | 'hygiene' | 'childGrowth' | 'childCapacity' | 'inputMult' | 'powerLoss' | 'output' | 'cargo' | 'healMult';
  value: number;
}
/** Filled by the Rooms-Data agent as the rooms of each pair arrive. */
export const SYNERGIES: SynergyRule[] = [
  // [plan4:BL-9..14] neighbour pairs (02-new-buildings.md section 2.5) of the first eight rooms. Readers of each effect arrive with the systems that own it.
  { a: 'canteen', b: 'commons', effect: 'morale', value: 0.05 },
  { a: 'library', b: 'laboratory', effect: 'knowledge', value: 0.08 },
  { a: 'recycler', b: 'workshop', effect: 'inputMult', value: 0.2 },
  { a: 'batteryBank', b: 'generator', effect: 'powerLoss', value: 0.05 },
  { a: 'batteryBank', b: 'reactor', effect: 'powerLoss', value: 0.05 },
  { a: 'mushroomFarm', b: 'waterPump', effect: 'output', value: 0.1 },
];
/** Neighbours that count, and the most a room can gain in all. */
export const SYNERGY_MAX_NEIGHBOURS = 3;
export const SYNERGY_MAX_BONUS = 0.2;

export interface SynergyLink {
  with: BuildingType;
  effect: SynergyRule['effect'];
  value: number;
}

/** The neighbour bonuses a room gets (and which neighbours give them). Rooms still under their first build do not count. */
export function synergyOf(state: GameState, b: BuildingInstance): { total: number; links: SynergyLink[] } {
  const links: SynergyLink[] = [];
  if (SYNERGIES.length === 0 || (b.isConstructing && b.level === 1)) return { total: 0, links };
  for (const o of state.buildings) {
    if (links.length >= SYNERGY_MAX_NEIGHBOURS) break;
    if (o === b || o.id === b.id || (o.isConstructing && o.level === 1) || !touching(o, b)) continue;
    for (const r of SYNERGIES) {
      if ((r.a === b.type && r.b === o.type) || (r.b === b.type && r.a === o.type)) links.push({ with: o.type, effect: r.effect, value: r.value });
    }
  }
  const capped = links.slice(0, SYNERGY_MAX_NEIGHBOURS);
  return { total: Math.min(SYNERGY_MAX_BONUS, capped.reduce((n, l) => n + l.value, 0)), links: capped };
}

/** One effect's share of a room's neighbour bonus (0 without a matching neighbour). */
export function synergyBonus(state: GameState, b: BuildingInstance, effect: SynergyRule['effect']): number {
  if (SYNERGIES.length === 0) return 0;
  const { links } = synergyOf(state, b);
  return Math.min(SYNERGY_MAX_BONUS, links.filter(l => l.effect === effect).reduce((n, l) => n + l.value, 0));
}

/** [plan4:BL-4] Adults on a room's crew (children in a nursery or school hold places of their own and are not counted). */
export function crewCount(state: GameState, b: BuildingInstance): number {
  let n = 0;
  for (const id of b.assignedSurvivorIds) if (!state.survivors.find(s => s.id === id)?.child) n++;
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
    .filter((s): s is NonNullable<typeof s> => !!s && !s.isOnMission && !s.child); // [plan4:BL-4] children in a nursery/school are not a crew

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

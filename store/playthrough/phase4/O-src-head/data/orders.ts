import type { BuildingType, DailyOrder, GameState } from '../core/GameState';
import { BUILDABLE_TYPES, getDef, specLevel } from './buildingDefs';
import { lateActTwoSystems } from './acts';
import { openPartners } from './trade';
import { PROJECTS, projectDone } from './projects';
import { lawSlots } from './laws';
import { wingOptions } from './wings';
import { TUNING } from './tuning';
import { isBuildingUnlocked } from '../systems/ResearchSystem';
import { infraUnlocked, troubleOn } from '../systems/InfraSystem';
import { infraOfKind } from '../systems/doors';
import { specsFor } from './specializations';

/**
 * [plan4:GP-1] The daily orders: 22 short goals, three of which are offered each day (one easy, one medium, one "new" that teaches a
 * system the player has not used yet). Progress comes from three places, all of them the game's own events and counters, nothing new
 * in the other systems: `on` (a bus event worth some steps), `counter` (a number in the state, followed since the order was made) and
 * `watch` (a state that has to hold over time). Only dig, research and food count while the player is away (`offline`); everything else
 * needs hands, so an absence never completes it.
 */
export type OrderTier = 'easy' | 'medium' | 'new';

/** What an order may ask the rest of the game. Kept as a parameter so this file needs no system instances. */
export interface OrderEnv {
  /** BuildingSystem.digBlock: null = a floor can be dug now. */
  digBlock: (s: GameState) => 'digging' | 'act' | 'max' | null;
}

export interface OrderDef {
  id: string;
  tier: OrderTier;
  icon: string;
  /** First and last Act it is offered in (inclusive). */
  fromAct: number;
  toAct?: number;
  /** Counts while the player is away. */
  offline?: boolean;
  /** Steps to take today (may depend on the bunker). */
  need: (s: GameState) => number;
  /** What the player sees for `need` and for the progress (seconds shown as hours...). 1 = as is. */
  scale?: number;
  /** The order can be done at all in this bunker now; if not it is not offered. */
  avail: (s: GameState, env: OrderEnv) => boolean;
  /** "new" tier: true while the player never finished this order before (those are offered first). */
  fresh?: (s: GameState) => boolean;
  /** A number in the state; progress is its growth since the order was made. */
  counter?: (s: GameState) => number;
  /** Bus events and what each is worth (0 = nothing). `s` is the state after the event. */
  on?: Record<string, (s: GameState, ...args: unknown[]) => number>;
  /** A state that has to hold over time: returns the new progress given the seconds of play since the last look. */
  watch?: (s: GameState, o: DailyOrder, dtPlay: number) => number;
}

const act = (s: GameState): number => s.longGame?.meta.act ?? 1;
const levels = (s: GameState): number => s.buildings.reduce((n, b) => n + b.level, 0);
const hasRoom = (s: GameState, type: BuildingType): boolean => s.buildings.some(b => b.type === type && !b.isConstructing);
const typesBuilt = (s: GameState): number => new Set(s.buildings.map(b => b.type)).size;
const childrenIn = (s: GameState, type: BuildingType): number => {
  const ids = new Set(s.buildings.filter(b => b.type === type && !b.isConstructing).map(b => b.id));
  return s.survivors.filter(x => x.child && x.assignedBuildingId && ids.has(x.assignedBuildingId)).length;
};

/** A flag set when an order is finished for the first time: the "new" tier offers the ones never done first. */
export const didFlag = (id: string): string => `daily:did:${id}`;
const never = (id: string) => (s: GameState): boolean => !s.storyFlags.includes(didFlag(id));

/** About an hour and a half of the bunker's own food, rounded to a hundred, never under a thousand: "produce 1000 food" that still means something in Act IV. */
export const foodNeed = (s: GameState): number => Math.max(1000, Math.round((s.resources.food.productionRate * 3600 * 1.5) / 100) * 100);

export const ORDERS: OrderDef[] = [
  // ---- easy: a minute or two of play each ----
  {
    id: 'bubbles', tier: 'easy', icon: '[[sparkle]]', fromAct: 1, need: () => 10,
    avail: s => s.buildings.some(b => !b.isConstructing && b.assignedSurvivorIds.length > 0),
    on: { 'bubble:collected': () => 1 },
  },
  {
    id: 'ruin1', tier: 'easy', icon: '[[broom]]', fromAct: 1, toAct: 2, need: () => 1,
    avail: s => s.ruins.length > 0,
    on: { 'ruin:cleared': () => 1 },
  },
  {
    id: 'upgrade1', tier: 'easy', icon: '[[up]]', fromAct: 1, need: () => 1,
    avail: s => s.buildings.some(b => !b.isConstructing && b.level < 3),
    counter: levels,
  },
  {
    id: 'inbox2', tier: 'easy', icon: '[[inbox]]', fromAct: 2, need: () => 2,
    avail: s => lateActTwoSystems(s) || act(s) >= 3,
    on: { 'inbox:resolved': () => 1 },
  },
  {
    id: 'train1', tier: 'easy', icon: '[[books]]', fromAct: 1, need: () => 1,
    avail: s => hasRoom(s, 'trainingRoom') && s.survivors.some(x => !x.child),
    counter: s => s.lateGame?.trained ?? 0,
  },
  {
    id: 'maintain1', tier: 'easy', icon: '[[workshop]]', fromAct: 2, need: () => 1,
    avail: s => s.buildings.some(b => (b.wear ?? 0) >= 10),
    on: { 'maintenance:done': () => 1 },
  },
  {
    id: 'food', tier: 'easy', icon: '[[food]]', fromAct: 1, offline: true, need: foodNeed,
    avail: s => s.resources.food.productionRate > 0,
    counter: s => s.stats.totalFoodProduced,
  },

  // ---- medium: a real errand ----
  {
    id: 'contracts2', tier: 'medium', icon: '[[cart]]', fromAct: 2, need: () => 2,
    avail: s => lateActTwoSystems(s),
    on: { 'inbox:resolved': (_s, item, key) => ((item as { kind?: string } | undefined)?.kind === 'contract' && key === 'accept' ? 1 : 0) },
  },
  {
    id: 'guests3', tier: 'medium', icon: '[[people]]', fromAct: 1, need: () => 3,
    avail: s => s.maxPopulation - s.survivors.length >= 3,
    counter: s => s.stats.totalSurvivorsRecruited,
  },
  {
    id: 'expedition1', tier: 'medium', icon: '[[map]]', fromAct: 1, need: () => 1,
    avail: s => (s.era ?? 0) >= 1 && s.survivors.filter(x => !x.child && !x.isOnMission).length >= 2,
    on: { 'mission:start': () => 1 },
  },
  {
    id: 'power60', tier: 'medium', icon: '[[power]]', fromAct: 1, need: () => 7200, scale: 3600,
    avail: s => s.resources.power.cap > 0 && s.buildings.some(b => !b.isConstructing && (b.type === 'generator' || b.type === 'reactor')),
    // The store, not the ratio: a bunker that makes just enough sits at zero, a careful one keeps a reserve.
    watch: (s, o, dt) => o.p + (s.resources.power.cap > 0 && s.resources.power.amount >= s.resources.power.cap * 0.6 ? dt : 0),
  },
  {
    id: 'projectStep', tier: 'medium', icon: '[[build]]', fromAct: 2, need: () => 1,
    avail: s => !!s.longGame && PROJECTS.some(p => !projectDone(s, p.id)),
    on: { 'project:stage': () => 1 },
  },
  {
    id: 'caravan1', tier: 'medium', icon: '[[cart]]', fromAct: 2, need: () => 1,
    avail: s => openPartners(s).length > 0 && s.survivors.filter(x => !x.child && !x.isOnMission).length >= 2,
    on: { 'caravan:start': () => 1 },
  },
  {
    id: 'specialize1', tier: 'medium', icon: '[[crown]]', fromAct: 2, need: () => 1,
    avail: s => s.buildings.some(b => !b.isConstructing && !b.specialization && getDef(b.type) && b.level >= specLevel(getDef(b.type)!) && specsFor(b.type, s).length > 0),
    on: { 'building:specialized': () => 1 },
  },
  {
    id: 'incident1', tier: 'medium', icon: '[[workshop]]', fromAct: 1, need: () => 1,
    avail: s => s.buildings.length >= 4,
    on: { 'incident:resolved': () => 1 },
  },
  {
    id: 'dig1', tier: 'medium', icon: '[[pick]]', fromAct: 1, offline: true, need: () => 1,
    // A dig already running counts; otherwise a floor or a wing step has to be possible to start.
    avail: (s, env) => env.digBlock(s) === null || env.digBlock(s) === 'digging' || wingOptions(s).some(w => w.block === null || w.block === 'cost'),
    on: { 'dig:done': () => 1 },
  },
  {
    id: 'research1', tier: 'medium', icon: '[[research]]', fromAct: 1, offline: true, need: () => 1,
    avail: s => hasRoom(s, 'laboratory'),
    on: { 'research:complete': () => 1 },
  },

  // ---- new: each one teaches a system the player may not have touched ----
  {
    id: 'newRoom', tier: 'new', icon: '[[build]]', fromAct: 1, need: () => 1,
    avail: s => BUILDABLE_TYPES.some(t => isBuildingUnlocked(s, t) && !s.buildings.some(b => b.type === t)),
    fresh: never('newRoom'),
    counter: typesBuilt,
  },
  {
    id: 'closeDoor', tier: 'new', icon: '[[door]]', fromAct: 2, need: () => 1,
    avail: s => infraUnlocked(s, 'bulkhead') && infraOfKind(s, 'bulkhead').length > 0,
    fresh: never('closeDoor'),
    // Only a shut door counts, and only while something is wrong (a fire, an epidemic, a raid on the way, any malfunction).
    on: { 'door:changed': (s, d) => ((d as { state?: string } | undefined)?.state !== 'open' && (troubleOn(s) || (s.incidents?.length ?? 0) > 0) ? 1 : 0) },
  },
  {
    id: 'wing1', tier: 'new', icon: '[[pick]]', fromAct: 2, need: () => 1,
    avail: s => wingOptions(s).some(w => w.block === null || w.block === 'cost'),
    fresh: never('wing1'),
    on: { 'wing:start': () => 1 },
  },
  {
    id: 'nursery2', tier: 'new', icon: '[[baby]]', fromAct: 2, need: () => 2,
    avail: s => hasRoom(s, 'nursery') && s.survivors.filter(x => x.child).length >= 2,
    fresh: never('nursery2'),
    // The number standing there now (children grow up and leave), the best of the day.
    watch: (s, o) => Math.max(o.p, childrenIn(s, 'nursery')),
  },
  {
    id: 'law1', tier: 'new', icon: '[[books]]', fromAct: 3, need: () => 1,
    avail: s => !!s.longGame && s.longGame.policy.laws.length < lawSlots(s),
    fresh: never('law1'),
    counter: s => s.longGame?.policy.laws.length ?? 0,
  },
];

export function getOrder(id: string): OrderDef | undefined {
  return ORDERS.find(o => o.id === id);
}

// ---- rewards ----------------------------------------------------------------------------------------------------------------

/** Bronze (easy): one rush charge. Silver (medium): credits. Gold (new): credits, or a quarter of a blueprint. */
export const REWARD_RUSH = 1;
export const REWARD_SILVER = 60;
export const REWARD_GOLD = 120;
/** A gold order may pay a piece of a blueprint instead; this many make one. */
export const FRAGS_PER_PLAN = 4;
/** +10% of the credits per day in a row (the first day pays the plain amount), up to +50%. */
export const STREAK_STEP = 0.1;
export const STREAK_MAX_BONUS = 0.5;
/** The day chest holds one hour of the bunker's production, like the supply crate (it does not grow with the streak). */
export const CHEST_HOURS = 1;
/** All of a day's rewards together, in hours of the bunker's own production. */
export const MAX_DAILY_HOURS = 1.5;
/** One rush charge skips 15 minutes of work. */
export const RUSH_HOURS = 0.25;
/**
 * What a credit is worth in hours of production, for the cap above only (nothing in the game converts them). The shop spends credits
 * on boosts that come with daily limits (a research boost 3 a day, a project boost 1), so the credits of one day cannot be turned into
 * more than that; 1/1800 (two seconds) is the working figure that keeps the whole day under the cap: 1 + 0.25 + (60 + 120) x 1.5 / 1800 = 1.4.
 */
export const CREDIT_HOURS = 1 / 1800;

export function orderTier(id: string): OrderTier {
  return getOrder(id)?.tier ?? 'easy';
}

/** The share added to the credits by a streak of `days` days in a row. */
export function streakBonus(days: number): number {
  return Math.min(STREAK_MAX_BONUS, Math.max(0, days - 1) * STREAK_STEP);
}

/** Credits scale with the Act like the shop's prices do, so a reward keeps the same buying power. */
export function actCreditScale(s: GameState): number {
  return 1 + TUNING.shopActRamp * Math.max(0, act(s) - 1);
}

/** The most one day can pay, in hours of production: the chest, every reward at the top streak. */
export function maxDailyHours(): number {
  return CHEST_HOURS + REWARD_RUSH * RUSH_HOURS + (REWARD_SILVER + REWARD_GOLD) * (1 + STREAK_MAX_BONUS) * CREDIT_HOURS;
}

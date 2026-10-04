import type { ResourceType } from '../core/GameState';

/**
 * Every resource in one table. Lists that used to be copied across systems (which resources tick, their base storage,
 * what overflow is worth, what the welcome-back report counts) are derived from here, so a new resource is one entry.
 *
 * tier 1 = the survival basics, made by rooms from the start; tier 2 = refined goods of the long game (made by production
 * chains from later Acts, see the long-game plan); meta = currencies with no storage (prestige, shop, gifts).
 */
export interface ResourceDef {
  id: ResourceType;
  tier: 1 | 2 | 'meta';
  /** Produced and consumed by rooms every tick (has a rate and a cap). */
  ticked: boolean;
  /** Storage before any room or research adds to it. */
  baseCap?: number;
  /** [Economy A1] Trade credits per unit of storage overflow (power is never stored, so it never converts). */
  overflowCredits?: number;
  /** S3: share of output a room keeps in a blackout (farms and pumps 70%, workshops 50%: hand tools). */
  powerFloor?: number;
  /** Counted as "wasted" in the welcome-back report when it overflows full storage. */
  wasteTracked?: boolean;
  /** The Act (long-game chapter) from which the resource matters to the player; earlier it stays hidden. */
  act?: number;
}

export const RESOURCES: readonly ResourceDef[] = [
  // M2: 300 materials so the first dig (180) always fits without a Storage Room.
  { id: 'food', tier: 1, ticked: true, baseCap: 150, overflowCredits: 0.01, powerFloor: 0.7, wasteTracked: true },
  { id: 'water', tier: 1, ticked: true, baseCap: 100, overflowCredits: 0.01, powerFloor: 0.7, wasteTracked: true },
  { id: 'power', tier: 1, ticked: true, baseCap: 50 },
  { id: 'materials', tier: 1, ticked: true, baseCap: 300, overflowCredits: 0.03, powerFloor: 0.5, wasteTracked: true },
  // Medicine is rare so each unit is worth a lot; food and water are plentiful so they are worth little.
  { id: 'medicine', tier: 1, ticked: true, baseCap: 30, overflowCredits: 0.2, wasteTracked: true },
  { id: 'knowledge', tier: 1, ticked: true, baseCap: 100, overflowCredits: 0.05, wasteTracked: true },
  // Scrap has no room rate; treated like materials so late scrap overflow is not lost.
  { id: 'scrap', tier: 1, ticked: true, baseCap: 200, overflowCredits: 0.03, wasteTracked: true },
  // Long game, tier 2: made by workshop and generator roles from their Act on (hidden before). Later tiers have no producer yet.
  { id: 'components', tier: 2, ticked: true, baseCap: 200, overflowCredits: 0.3, wasteTracked: true, act: 3 },
  { id: 'alloys', tier: 2, ticked: true, baseCap: 80, overflowCredits: 0.8, wasteTracked: true, act: 4 },
  { id: 'data', tier: 2, ticked: false, act: 5 },
  { id: 'influence', tier: 2, ticked: false, act: 6 },
  { id: 'seedCores', tier: 2, ticked: false, act: 7 },
  { id: 'isotope7', tier: 'meta', ticked: false },
  { id: 'blueprints', tier: 'meta', ticked: false },
  { id: 'vaultCoins', tier: 'meta', ticked: false },
  // [Economy A1] Trade credits: what storage overflow turns into (no cap); spent in the shop.
  { id: 'credits', tier: 'meta', ticked: false },
];

const BY_ID = new Map(RESOURCES.map(r => [r.id, r]));

export function resourceDef(id: ResourceType): ResourceDef | undefined {
  return BY_ID.get(id);
}

const pick = <K extends keyof ResourceDef>(key: K): Partial<Record<ResourceType, NonNullable<ResourceDef[K]>>> => {
  const out: Partial<Record<ResourceType, NonNullable<ResourceDef[K]>>> = {};
  for (const r of RESOURCES) if (r[key] !== undefined) out[r.id] = r[key] as NonNullable<ResourceDef[K]>;
  return out;
};

export const ALL_RESOURCES: ResourceType[] = RESOURCES.map(r => r.id);
export const TICKED_RESOURCES: ResourceType[] = RESOURCES.filter(r => r.ticked).map(r => r.id);
export const WASTE_TRACKED: ResourceType[] = RESOURCES.filter(r => r.wasteTracked).map(r => r.id);
export const TIER2_RESOURCES: ResourceType[] = RESOURCES.filter(r => r.tier === 2).map(r => r.id);
export const BASE_CAPS = pick('baseCap');
export const OVERFLOW_CREDITS = pick('overflowCredits');
export const POWER_FLOOR = pick('powerFloor');

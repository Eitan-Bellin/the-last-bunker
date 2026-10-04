import type { GameState, ResourceType } from '../core/GameState';
import { TUNING } from './tuning';

/**
 * [Long game] Prices in time (long-game plan, section 5). Every Act has a currency (materials in Acts I-II, then the
 * tier-2 good it introduces) and a reference income of that currency per hour. A price is "so many hours of the Act's
 * reference income", so each Act's purchases keep the same weight no matter how big the numbers grow, and storage holds
 * a set number of those hours (capHours), so a single payment always fits.
 * Act I keeps its hand-tuned prices: the first half hour is not touched.
 */
export const ACT_CURRENCY: readonly ResourceType[] = ['materials', 'materials', 'materials', 'components', 'alloys', 'data', 'influence', 'seedCores'];

/** Reference income of an Act's currency, per hour. */
export function refIncome(act: number): number {
  return TUNING.refIncome[Math.min(TUNING.refIncome.length - 1, Math.max(1, act))];
}

/**
 * The price of `hours` of Act `act`'s income. From Act III on, part of the price is still asked in the earlier
 * currencies (materials, then components), so the older goods keep a use.
 */
export function actPrice(act: number, hours: number): Record<string, number> {
  const a = Math.max(1, act);
  if (a >= 2) hours *= TUNING.priceScale;
  const out: Record<string, number> = {};
  const add = (r: ResourceType, v: number) => { if (v >= 1) out[r] = (out[r] ?? 0) + Math.round(v); };
  add(ACT_CURRENCY[a], hours * refIncome(a));
  if (a >= 3) add('materials', hours * refIncome(2) * TUNING.olderCurrencyShare);
  if (a >= 4) add('components', hours * refIncome(3) * TUNING.olderCurrencyShare);
  if (a >= 5) add('alloys', hours * refIncome(4) * TUNING.olderCurrencyShare);
  if (a >= 6) add('data', hours * refIncome(5) * TUNING.olderCurrencyShare);
  if (a >= 7) add('influence', hours * refIncome(6) * TUNING.olderCurrencyShare);
  return out;
}

/**
 * [P4] A bundle of `hours` of the Act's income in the same mix prices ask for (the newest currency plus the share of
 * the older ones), without the price scale: what contracts pay, so they relieve every currency a price needs.
 */
export function actBundle(act: number, hours: number): Partial<Record<ResourceType, number>> {
  const a = Math.max(1, act);
  const out: Partial<Record<ResourceType, number>> = {};
  const add = (r: ResourceType, v: number) => { if (v >= 1) out[r] = (out[r] ?? 0) + Math.round(v); };
  add(ACT_CURRENCY[a], hours * refIncome(a));
  if (a >= 3) add('materials', hours * refIncome(2) * TUNING.olderCurrencyShare);
  if (a >= 4) add('components', hours * refIncome(3) * TUNING.olderCurrencyShare);
  if (a >= 5) add('alloys', hours * refIncome(4) * TUNING.olderCurrencyShare);
  if (a >= 6) add('data', hours * refIncome(5) * TUNING.olderCurrencyShare);
  if (a >= 7) add('influence', hours * refIncome(6) * TUNING.olderCurrencyShare);
  return out;
}

/** The Act a room level belongs to (Mk2-3 Act I, Mk4-5 Act II, Mk6-7 Act III, Mk8-9 Act IV, Mk10 Act V). */
export function levelAct(level: number): number {
  return level <= 3 ? 1 : Math.min(5, Math.floor((level - 4) / 2) + 2);
}

/** Hours of income for an upgrade to `level` (the plan's 3 minutes x 1.74 per level). */
export function upgradeHours(level: number): number {
  return (TUNING.priceMinutes / 60) * Math.pow(TUNING.priceGrowth, level - 1);
}

/** The Act a floor belongs to (B6-B8 Act II, B9-B11 Act III, B12-B14 Act IV, deeper Act V). */
export function floorAct(floorCount: number): number {
  return floorCount <= 5 ? 1 : Math.min(7, Math.floor((floorCount - 6) / 3) + 2);
}

/** Hours of income to dig to `floorCount` floors (from B7; the first digs keep their old prices). */
export function digHours(floorCount: number): number {
  return TUNING.digHours * Math.pow(TUNING.digHoursGrowth, floorCount - 7);
}

/**
 * [L2] Storage that each currency gets from the Act: capHours of the current Act times the currency's reference income.
 * Added on top of what rooms and research give.
 */
export function actCapBonus(state: GameState): Partial<Record<ResourceType, number>> {
  const act = state.longGame?.meta.act ?? 1;
  const hours = TUNING.capHours[Math.min(TUNING.capHours.length - 1, act)] * (act >= 2 ? TUNING.priceScale : 1);
  const out: Partial<Record<ResourceType, number>> = {};
  for (let a = 2; a <= act; a++) {
    const c = ACT_CURRENCY[a];
    out[c] = Math.max(out[c] ?? 0, Math.round(hours * refIncome(a)));
  }
  return out;
}

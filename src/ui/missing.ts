import type { GameState, ResourceType } from '../core/GameState';
import { i18n } from '../i18n/I18nManager';
import { RESOURCE_ICONS } from './dom';

/**
 * [ux-wp3 A1] What a failed purchase is short of: which resources, how many of each, and about how long at the current rates.
 * One line for the generic "not enough" toast ("Need 120 more [[materials]] Materials · ~4 min"), so the player learns what to do
 * instead of being told no. Pure: reads the state only (the net rate per second is already kept on each resource).
 *
 * Public API (also for the build menu): `describeMissing(state, cost, engine?)`, `missingList(state, cost)`, `etaSeconds(...)`.
 */

export interface Shortfall {
  resource: ResourceType;
  /** How many more are needed. */
  need: number;
  /** Net change per second right now (production minus use). */
  net: number;
  /** Seconds until there is enough at that rate; null when it never gets there (nothing is made, or the store is too small). */
  eta: number | null;
  /** The cost is more than the store can ever hold. */
  overCap: boolean;
}

/** Each resource the cost asks for and the state does not have, in the cost's own order. */
export function missingList(state: GameState, cost: Partial<Record<string, number>>): Shortfall[] {
  const out: Shortfall[] = [];
  for (const [key, amount] of Object.entries(cost)) {
    if (!amount || amount <= 0) continue;
    const res = state.resources[key as ResourceType];
    if (!res) continue;
    const need = amount - res.amount;
    if (need <= 1e-6) continue;
    const net = (res.productionRate ?? 0) - (res.consumptionRate ?? 0);
    const overCap = isFinite(res.cap) && res.cap > 0 && amount > res.cap;
    out.push({ resource: key as ResourceType, need, net, overCap, eta: overCap || net <= 0.0005 ? null : need / net });
  }
  return out;
}

/** About how long until every missing resource is there (null = not at the current rates). */
export function etaSeconds(list: Shortfall[]): number | null {
  let worst = 0;
  for (const s of list) {
    if (s.eta === null) return null;
    worst = Math.max(worst, s.eta);
  }
  return worst;
}

const amountText = (n: number): string => i18n.formatCompact(Math.ceil(n));

/**
 * One readable line: "Need 120 more [[materials]] Materials · ~4 min", "Need 40 [[materials]] and 12 [[scrap]] · ~3 min",
 * "Need 12 more [[scrap]] Scrap · nothing makes it right now", "… · the store holds only 200: build more storage".
 * Falls back to the old generic text when nothing is actually missing (the action failed for another reason).
 * `engine` is accepted for callers that have one (future: rates that the state does not carry); today the state is enough.
 */
export function describeMissing(state: GameState, cost: Partial<Record<string, number>>, _engine?: unknown): string {
  const list = missingList(state, cost);
  if (!list.length) return i18n.t('toast.notEnough');
  const parts = list.map(s => `${amountText(s.need)} ${RESOURCE_ICONS[s.resource] ?? ''}`.trim());
  const what = list.length === 1
    ? i18n.t('wp3.missing.one', { n: amountText(list[0].need), icon: RESOURCE_ICONS[list[0].resource] ?? '', name: i18n.t(`resources.${list[0].resource}`) })
    : i18n.t('wp3.missing.many', { list: parts.join(i18n.t('wp3.missing.and')) });
  const cap = list.find(s => s.overCap);
  if (cap) {
    const c = state.resources[cap.resource].cap;
    return `${what} · ${i18n.t('wp3.missing.overCap', { cap: amountText(c), icon: RESOURCE_ICONS[cap.resource] ?? '' })}`;
  }
  const stalled = list.find(s => s.eta === null);
  if (stalled) return `${what} · ${i18n.t('wp3.missing.noRate', { icon: RESOURCE_ICONS[stalled.resource] ?? '', name: i18n.t(`resources.${stalled.resource}`) })}`;
  const eta = etaSeconds(list) ?? 0;
  return `${what} · ${i18n.t('wp3.missing.eta', { t: i18n.formatDuration(Math.max(1, eta)) })}`;
}

/** The toast text for a failed purchase: the shortfall when something is missing, the given fallback (or the generic line) otherwise. */
export function missingOr(state: GameState, cost: Partial<Record<string, number>> | null | undefined, fallback?: string): string {
  if (cost && missingList(state, cost).length) return `[[warning]] ${describeMissing(state, cost)}`;
  return fallback ?? i18n.t('toast.notEnough');
}

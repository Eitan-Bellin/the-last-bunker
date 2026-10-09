import type { GameState, ResourceType } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { ResourceSystem } from './ResourceSystem';
import { RUSH_PER_CRATE, RUSH_WEEK_BONUS } from './RushSystem';
import { actGoods } from '../data/pricing';

/** Resources the crate holds, worth hours of the bunker's own production. */
const CRATE_RESOURCES: ResourceType[] = ['food', 'water', 'materials', 'knowledge'];
/** [ux-wp2] Hours of the Act currency's reference income in a crate (x1..2 with the streak), from Act III. */
export const CRATE_ACT_HOURS = 0.5;
/** The streak stops growing the crate after a week. */
const STREAK_MAX = 7;

/** Local calendar day, e.g. "2026-10-3": the drop resets at the player's midnight. */
export function localDay(ms = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Noon yesterday by the calendar (not "now minus 24 hours", which lands on the wrong date on a day the clocks change). */
function yesterdayMs(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12).getTime();
}

export interface SupplyClaim {
  streak: number;
  gains: Partial<Record<ResourceType, number>>;
  /** Rush charges the crate held. */
  rush: number;
}

/**
 * The daily supply drop (NICE3): once a day a crate lands by the hatch. It holds 1 hour of production on the
 * first day, growing to 2 hours after a week in a row, plus salvage; every 7th day in a row adds a blueprint.
 */
export class SupplySystem {
  private sm: StateManager;
  private resources: ResourceSystem;

  constructor(sm: StateManager, resources: ResourceSystem) {
    this.sm = sm;
    this.resources = resources;
  }

  isReady(state: GameState): boolean {
    return state.storyFlags.includes('intro:done') && state.survivors.length > 0 && state.supplyDrop?.day !== localDay();
  }

  /** The streak the next crate counts as: one more if yesterday's was opened, else back to 1. */
  nextStreak(state: GameState): number {
    const last = state.supplyDrop?.day;
    return last && last === localDay(yesterdayMs()) ? (state.supplyDrop.streak ?? 0) + 1 : 1;
  }

  /** What the crate holds before storage limits. */
  contents(state: GameState, streak: number): Partial<Record<ResourceType, number>> {
    const hours = 1 + (Math.min(STREAK_MAX, streak) - 1) / (STREAK_MAX - 1);
    const out: Partial<Record<ResourceType, number>> = {};
    for (const r of CRATE_RESOURCES) {
      const res = state.resources[r];
      // Never less than a tenth of the store, so a brand-new bunker still gets a real crate.
      out[r] = Math.round(Math.max(res.productionRate * hours * 3600, res.cap * 0.1));
    }
    out.scrap = Math.round(Math.max(10, state.resources.scrap.cap * 0.05 * hours));
    if (streak % STREAK_MAX === 0) out.blueprints = 1;
    // [ux-wp2 R1/R5] From Act III the basics are always full: the crate also carries the Act's own currency (half an hour of its
    // reference income, an hour after a week in a row), the good the player is actually saving for.
    for (const [r, v] of Object.entries(actGoods(state, CRATE_ACT_HOURS * hours)) as [ResourceType, number][]) out[r] = (out[r] ?? 0) + v;
    return out;
  }

  /** Opens today's crate; returns what actually fit in storage. */
  claim(): SupplyClaim | null {
    const state = this.sm.state;
    if (!this.isReady(state)) return null;
    const streak = this.nextStreak(state);
    const contents = this.contents(state, streak);
    const before: Partial<Record<ResourceType, number>> = {};
    for (const r of Object.keys(contents) as ResourceType[]) before[r] = state.resources[r].amount;
    this.resources.gain(this.sm, contents, { overfill: true }); // [ux-wp2 R1] a full store never eats the crate
    const gains: Partial<Record<ResourceType, number>> = {};
    for (const r of Object.keys(contents) as ResourceType[]) {
      const got = Math.round(this.sm.state.resources[r].amount - (before[r] ?? 0));
      if (got > 0) gains[r] = got;
    }
    this.sm.applyDelta({ path: 'supplyDrop', value: { day: localDay(), streak } });
    // Rush charges: the crate's scarce, strategic part.
    const rush = RUSH_PER_CRATE + (streak % STREAK_MAX === 0 ? RUSH_WEEK_BONUS : 0);
    this.sm.applyDelta({ path: 'rush', value: (this.sm.state.rush ?? 0) + rush });
    return { streak, gains, rush };
  }
}

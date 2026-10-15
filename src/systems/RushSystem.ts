import type { GameState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { ResearchSystem } from './ResearchSystem';

/** One rush charge skips this much work: 15 minutes of building, research or travel. */
export const RUSH_SECONDS = 900;
/** Charges a brand-new bunker starts with, so the player meets the idea early. */
export const RUSH_START = 3;
/** The daily crate brings this many; a full week in a row adds the bonus on top. */
export const RUSH_PER_CRATE = 2;
export const RUSH_WEEK_BONUS = 3;

/**
 * [phase4] Favours: the credits shop sells rush too. When the bunker holds no charge, a rush is paid in credits through the shop (the
 * ShopSystem registers itself here when it is made; one game engine per page, and one per simulator worker).
 */
export interface FavourBuyer {
  price(state: GameState): number;
  /** Buys one charge with credits (false when the credits are short). */
  buy(): boolean;
}
let favour: FavourBuyer | null = null;
export function setFavourBuyer(b: FavourBuyer | null): void {
  favour = b;
}

/**
 * Rush charges ("accelerators"): a scarce gift the player spends where it matters most, on a room still
 * being built or upgraded, the research in progress, or a team out on the surface. Few by design, so the
 * choice of where to spend them is the strategy.
 */
export class RushSystem {
  private sm: StateManager;
  private research: ResearchSystem;

  constructor(sm: StateManager, research: ResearchSystem) {
    this.sm = sm;
    this.research = research;
  }

  count(state: GameState): number {
    return state.rush ?? 0;
  }

  grant(n: number): void {
    if (n > 0) this.sm.applyDelta({ path: 'rush', value: this.count(this.sm.state) + n });
  }

  /** [phase4] A rush can be paid: a charge in hand, or enough credits for the favour. */
  canPay(state: GameState): boolean {
    return this.count(state) > 0 || this.creditPrice(state) !== null;
  }

  /** [phase4] The credits a rush costs right now when no charge is left (null: a charge is held, or the credits are short). */
  creditPrice(state: GameState): number | null {
    if (this.count(state) > 0 || !favour) return null;
    const p = favour.price(state);
    return (state.resources.credits?.amount ?? 0) >= p ? p : null;
  }

  private spend(): boolean {
    let n = this.count(this.sm.state);
    if (n <= 0 && favour?.buy()) n = this.count(this.sm.state); // [phase4] no charge: buy the favour with credits
    if (n <= 0) return false;
    this.sm.applyDelta({ path: 'rush', value: n - 1 });
    return true;
  }

  canRushBuilding(state: GameState, id: string): boolean {
    const b = state.buildings.find(x => x.id === id);
    return !!b?.isConstructing && this.canPay(state);
  }

  /** Skips 15 minutes of a room's construction or upgrade; the building system finishes it on its next tick. */
  rushBuilding(id: string): boolean {
    const state = this.sm.state;
    const i = state.buildings.findIndex(x => x.id === id);
    const b = state.buildings[i];
    if (i < 0 || !b.isConstructing || !this.spend()) return false;
    this.sm.applyDelta({ path: `buildings.${i}.constructionProgress`, value: Math.min(b.constructionTotal, b.constructionProgress + RUSH_SECONDS) });
    return true;
  }

  canRushResearch(state: GameState): boolean {
    return !!this.research.activeId(state) && this.canPay(state);
  }

  /** Skips 15 minutes of the active research (points run at the lab speed). */
  rushResearch(): boolean {
    const state = this.sm.state;
    const rid = this.research.activeId(state);
    if (!rid || !this.spend()) return false;
    const node = this.sm.state.research[rid];
    this.sm.applyDelta({ path: `research.${rid}.progress`, value: Math.min(node.total, node.progress + RUSH_SECONDS * this.research.speed(state)) });
    return true;
  }

  canRushMission(state: GameState, id: string): boolean {
    const m = state.activeMissions.find(x => x.id === id);
    return !!m && !m.waiting && this.canPay(state);
  }

  /**
   * Skips 15 minutes of an expedition. A pending radio call is never jumped over: the trip stops at the call,
   * so the player still makes that choice.
   */
  rushMission(id: string): boolean {
    const state = this.sm.state;
    const m = state.activeMissions.find(x => x.id === id);
    if (!m || m.waiting || !this.spend()) return false;
    const stop = m.event && !m.event.choice && m.progress < m.total * m.event.at ? m.total * m.event.at : m.total;
    const progress = Math.min(stop, m.progress + RUSH_SECONDS);
    this.sm.applyDelta({ path: 'activeMissions', value: this.sm.state.activeMissions.map(x => (x.id === id ? { ...x, progress } : x)) });
    return true;
  }
}

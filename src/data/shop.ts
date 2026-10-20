/** [Economy A2] The Trade-credits shop. [phase3] Credits come from daily orders and contracts (no longer from storage overflow). */

export type ShopItemId = 'blueprint' | 'scrap20' | 'researchBoost' | 'projectBoost' | 'isotope' | 'crate' | 'actGoods' | 'rush';

export interface ShopItem {
  id: ShopItemId;
  /** Icon token shown next to the name. */
  icon: string;
  /** Base price in credits. */
  price: number;
  /**
   * [phase4b] Favours have no daily or weekly cap: each purchase of the same favour makes the next this many times dearer (default
   * SHOP_PRICE_RAMP), until the price resets: at local midnight, or on Sunday for the favours marked `per: 'week'`.
   */
  ramp?: number;
  /** [phase4b] When the ramp resets: 'day' (default) or 'week' (the old weekly-capped and weekly-ramped items). */
  per?: 'day' | 'week';
  /** [ux-wp2] Shown from this Act on. */
  fromAct?: number;
}

/** [phase4b] Each purchase makes the same favour this much dearer (until the reset), unless the favour has its own ramp. */
export const SHOP_PRICE_RAMP = 1.15;
/** Research boost: this many research-seconds are added at once (10 minutes). */
export const RESEARCH_BOOST_SECONDS = 600;
/** Project boost: this share of the current stage is completed. */
export const PROJECT_BOOST_SHARE = 0.25;
export const SCRAP_BUNDLE = 20;
/** [ux-wp2 S11] Act goods: one purchase is this many hours of the Act currency's reference income. */
export const ACT_GOODS_HOURS = 1;
/**
 * [phase3] Credits for each finished contract (before the Act scale every credit reward has, orders.actCreditScale). With the daily
 * orders this is now the only source: the basics' storage overflow no longer turns into credits.
 */
export const CONTRACT_CREDITS = 40;

/**
 * [phase4b] Favours: the credits shop and the rush charges are one sink. No daily caps any more; the price of each favour climbs with
 * every purchase of it this week (the old caps became steep ramps: a plan was 1 a day, isotope 5 a week). A rush (15 minutes off a
 * build, a research or a team) is a favour too: bought here as a charge, or paid in credits straight from a rush button when no charge
 * is left (RushSystem). Credits come from the Today card, finished partner requests and Act I overflow (phase 3).
 */
export const SHOP_ITEMS: ShopItem[] = [
  // Was 1 a day: about 25 plans are needed in the whole game, so the ramp is the steepest (150, 450, 1350...): one a day stays the deal.
  { id: 'blueprint', icon: '[[blueprints]]', price: 150, ramp: 3 },
  { id: 'rush', icon: '[[hourglass]]', price: 25, ramp: 1.15 },
  { id: 'scrap20', icon: '[[scrap]]', price: 30, ramp: 1.1 },
  { id: 'researchBoost', icon: '[[research]]', price: 40, ramp: 1.12 },
  { id: 'projectBoost', icon: '[[materials]]', price: 80, ramp: 1.3 },
  // Was 5 a week.
  { id: 'isotope', icon: '[[isotope7]]', price: 400, ramp: 1.35, per: 'week' },
  { id: 'crate', icon: '[[gift]]', price: 160, ramp: 1.6 },
  // [ux-wp2 S11] An hour of the Act currency, 25% dearer with every purchase in a week.
  { id: 'actGoods', icon: '[[credits]]', price: 200, ramp: 1.25, per: 'week', fromAct: 3 },
];

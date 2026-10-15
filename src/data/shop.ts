/** [Economy A2] The Trade-credits shop: what overflowing storage can buy. */

export type ShopItemId = 'blueprint' | 'scrap20' | 'researchBoost' | 'projectBoost' | 'isotope' | 'crate' | 'actGoods';

export interface ShopItem {
  id: ShopItemId;
  /** Icon token shown next to the name. */
  icon: string;
  /** Base price in credits (rises x1.1 per purchase of the same item on the same day). */
  price: number;
  /** Purchases allowed per local day / per week (undefined = unlimited). */
  dailyLimit?: number;
  weeklyLimit?: number;
  /** [ux-wp2 S11] No limit, but each purchase this week makes the next this many times dearer (instead of the daily ramp). */
  weeklyRamp?: number;
  /** [ux-wp2] Shown from this Act on. */
  fromAct?: number;
}

/** Each purchase on a day makes the same item 10% dearer until local midnight. */
export const SHOP_PRICE_RAMP = 1.1;
/** Research boost: this many research-seconds are added at once (10 minutes). */
export const RESEARCH_BOOST_SECONDS = 600;
/** Project boost: this share of the current stage is completed. */
export const PROJECT_BOOST_SHARE = 0.25;
export const SCRAP_BUNDLE = 20;
/** [ux-wp2 S11] Act goods: one purchase is this many hours of the Act currency's reference income. */
export const ACT_GOODS_HOURS = 1;

export const SHOP_ITEMS: ShopItem[] = [
  // [Q10] A few a day: the shop's two unlimited items let credits buy any amount of progress.
  { id: 'blueprint', icon: '[[blueprints]]', price: 150, dailyLimit: 3 },
  { id: 'scrap20', icon: '[[scrap]]', price: 40, dailyLimit: 5 },
  // [Long game] Boosts are a treat, not a way around the game: a few a day.
  { id: 'researchBoost', icon: '[[research]]', price: 60, dailyLimit: 3 },
  { id: 'projectBoost', icon: '[[materials]]', price: 120, dailyLimit: 1 },
  { id: 'isotope', icon: '[[isotope7]]', price: 400, weeklyLimit: 5 },
  { id: 'crate', icon: '[[gift]]', price: 250, dailyLimit: 1 },
  // [ux-wp2 S11] The one item without a limit: an hour of the Act currency, 25% dearer with every purchase in a week. Credits buy
  // what the Act is waiting for, at a price that climbs fast enough to stay a treat.
  { id: 'actGoods', icon: '[[credits]]', price: 300, weeklyRamp: 1.25, fromAct: 3 },
];

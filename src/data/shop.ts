/** [Economy A2] The Trade-credits shop: what overflowing storage can buy. */

export type ShopItemId = 'blueprint' | 'scrap20' | 'researchBoost' | 'projectBoost' | 'isotope' | 'crate';

export interface ShopItem {
  id: ShopItemId;
  /** Icon token shown next to the name. */
  icon: string;
  /** Base price in credits (rises x1.1 per purchase of the same item on the same day). */
  price: number;
  /** Purchases allowed per local day / per week (undefined = unlimited). */
  dailyLimit?: number;
  weeklyLimit?: number;
}

/** Each purchase on a day makes the same item 10% dearer until local midnight. */
export const SHOP_PRICE_RAMP = 1.1;
/** Research boost: this many research-seconds are added at once (10 minutes). */
export const RESEARCH_BOOST_SECONDS = 600;
/** Project boost: this share of the current stage is completed. */
export const PROJECT_BOOST_SHARE = 0.25;
export const SCRAP_BUNDLE = 20;

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'blueprint', icon: '[[blueprints]]', price: 150 },
  { id: 'scrap20', icon: '[[scrap]]', price: 40 },
  // [Long game] Boosts are a treat, not a way around the game: a few a day.
  { id: 'researchBoost', icon: '[[research]]', price: 60, dailyLimit: 3 },
  { id: 'projectBoost', icon: '[[materials]]', price: 120, dailyLimit: 1 },
  { id: 'isotope', icon: '[[isotope7]]', price: 400, weeklyLimit: 5 },
  { id: 'crate', icon: '[[gift]]', price: 250, dailyLimit: 1 },
];

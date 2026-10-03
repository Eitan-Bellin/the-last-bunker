import type { GameState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { ResourceSystem } from './ResourceSystem';
import type { ResearchSystem } from './ResearchSystem';
import type { SupplySystem } from './SupplySystem';
import { localDay } from './SupplySystem';
import { PROJECT_BOOST_SHARE, RESEARCH_BOOST_SECONDS, SCRAP_BUNDLE, SHOP_ITEMS, SHOP_PRICE_RAMP, type ShopItem, type ShopItemId } from '../data/shop';

/** What the Projects system offers the shop (feature-detected: absent until that system exists). */
export interface ProjectBooster { boostStage?(state: GameState, share: number): boolean }

export type ShopBlock = 'credits' | 'limit' | 'noResearch' | 'noProject' | 'full' | null;

export interface ShopOffer { item: ShopItem; price: number; block: ShopBlock; left?: number; visible: boolean }

/** Local date of the most recent Sunday: the weekly limit resets there (same day the weekly challenge starts). */
export function localWeek(ms = Date.now()): string {
  const d = new Date(ms);
  d.setDate(d.getDate() - d.getDay());
  return localDay(d.getTime());
}

export class ShopSystem {
  /** Resolves the Projects system lazily; set by GameEngine. */
  getProjects: (() => ProjectBooster | null | undefined) | null = null;

  private sm: StateManager;
  private resources: ResourceSystem;
  private research: ResearchSystem;
  private supply: SupplySystem;

  constructor(sm: StateManager, resources: ResourceSystem, research: ResearchSystem, supply: SupplySystem) {
    this.sm = sm;
    this.resources = resources;
    this.research = research;
    this.supply = supply;
  }

  /** Counters for today / this week; stale ones read as zero (the reset is applied on the next purchase). */
  private counts(state: GameState): { day: Record<string, number>; week: Record<string, number> } {
    const s = state.shop;
    return { day: s?.day === localDay() ? s.bought : {}, week: s?.week === localWeek() ? s.weekBought : {} };
  }

  price(state: GameState, item: ShopItem): number {
    const n = this.counts(state).day[item.id] ?? 0;
    return Math.round(item.price * Math.pow(SHOP_PRICE_RAMP, n));
  }

  offers(state: GameState): ShopOffer[] {
    const c = this.counts(state);
    return SHOP_ITEMS.map(item => {
      const price = this.price(state, item);
      const visible = item.id !== 'projectBoost' || !!this.getProjects?.()?.boostStage;
      let left: number | undefined;
      if (item.weeklyLimit) left = item.weeklyLimit - (c.week[item.id] ?? 0);
      if (item.dailyLimit) left = item.dailyLimit - (c.day[item.id] ?? 0);
      let block: ShopBlock = null;
      if (left !== undefined && left <= 0) block = 'limit';
      else if (item.id === 'researchBoost' && !this.research.activeId(state)) block = 'noResearch';
      else if (item.id === 'projectBoost' && !state.activeProjectId) block = 'noProject';
      else if (item.id === 'scrap20' && state.resources.scrap.amount >= state.resources.scrap.cap) block = 'full';
      else if ((state.resources.credits?.amount ?? 0) < price) block = 'credits';
      return { item, price, block, left, visible };
    });
  }

  /** Buys one of an item; returns false (and charges nothing) if it is not allowed right now. */
  buy(id: ShopItemId): boolean {
    const state = this.sm.state;
    const offer = this.offers(state).find(o => o.item.id === id);
    if (!offer || !offer.visible || offer.block) return false;
    if (!this.apply(id)) return false;
    const c = this.counts(state);
    const shop = {
      day: localDay(), bought: { ...c.day, [id]: (c.day[id] ?? 0) + 1 },
      week: localWeek(), weekBought: { ...c.week, [id]: (c.week[id] ?? 0) + 1 },
    };
    this.sm.applyDeltas([
      { path: 'resources.credits.amount', value: state.resources.credits.amount - offer.price },
      { path: 'shop', value: shop },
    ]);
    return true;
  }

  private apply(id: ShopItemId): boolean {
    const sm = this.sm;
    const state = sm.state;
    const add = (r: 'blueprints' | 'isotope7' | 'scrap', n: number) => sm.applyDelta({ path: `resources.${r}.amount`, value: state.resources[r].amount + n });
    switch (id) {
      case 'blueprint': add('blueprints', 1); return true;
      case 'isotope': add('isotope7', 1); return true;
      case 'scrap20': add('scrap', SCRAP_BUNDLE); return true;
      case 'researchBoost': {
        const rid = this.research.activeId(state);
        if (!rid) return false;
        const node = state.research[rid];
        // Research points run at the lab speed, so 10 minutes of work is 600 x speed points.
        sm.applyDelta({ path: `research.${rid}.progress`, value: Math.min(node.total, node.progress + RESEARCH_BOOST_SECONDS * this.research.speed(state)) });
        return true;
      }
      case 'projectBoost': return this.getProjects?.()?.boostStage?.(state, PROJECT_BOOST_SHARE) ?? false;
      case 'crate': {
        // An extra crate on top of the daily one: the day-one size, no streak and no flag touched.
        this.resources.gain(sm, this.supply.contents(state, 1));
        return true;
      }
    }
  }
}

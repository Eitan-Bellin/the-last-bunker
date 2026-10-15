import type { GameState } from '../../core/GameState';
import type { ShopSystem, ShopOffer } from '../../systems/ShopSystem';
import { ACT_GOODS_HOURS, SCRAP_BUNDLE, SHOP_PRICE_RAMP, type ShopItemId } from '../../data/shop';
import { actGoods } from '../../data/pricing';
import { i18n } from '../../i18n/I18nManager';
import { fmtCost, fmtNum } from '../format';
import { RESOURCE_ICONS, el } from '../dom';
import { kButton, kEmpty } from '../kit';
import { Sheet } from './Sheet';
import '../../styles/shop.css';
import '../../styles/p4-o.css'; // [phase4]

/** [phase4] The i18n key of an item's name (the rush favour is new in phase 4; its texts live under p4o.). */
const itemKey = (id: ShopItemId): string => (id === 'rush' ? 'p4o.favours.rushName' : `shop.item.${id}`);

/** The one shop sheet (the Journal owns it and hands it the shop system); `openShop` opens it from anywhere. */
let current: ShopPanel | null = null;

/**
 * [ux-redesign W2d #23] Opens the credits shop as its own sheet. Same as `JournalPanel.showShop` (which the app and the welcome-back
 * card already call): a HUD credits chip or a menu tile can call either.
 */
export function openShop(state: GameState): void {
  current?.show(state);
}

/**
 * [Economy A2] The credits shop. [ux-redesign W2d #23] Its own sheet now (it was a tab of the Journal; that tab is a link here).
 * It only renders; buying goes through `onBuy` so the app can save and play a sound.
 */
export class ShopPanel {
  onBuy: ((id: ShopItemId) => void) | null = null;
  /** Set by the Journal (which the app gives the shop system). */
  shop: ShopSystem | null = null;
  private sheet = new Sheet('shop-sheet', 'credits');
  private sig = '';

  constructor() {
    current = this;
  }

  show(state: GameState): void {
    this.sig = '';
    this.refresh(state);
    this.sheet.show();
  }

  hide(): void {
    this.sheet.hide();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  refresh(state: GameState): void {
    if (!this.shop) return;
    const sig = this.signature(state);
    if (sig === this.sig) return;
    this.sig = sig;
    this.sheet.setTitle(`[[credits]] ${i18n.t('p4o.favours.title')}`); // [phase4] Favours: the shop and the rush charges in one
    this.sheet.body.replaceChildren(this.render(state, this.shop));
  }

  /** Changes whenever what the sheet shows would change (balance, today's purchases, language). */
  signature(state: GameState): string {
    const s = state.shop;
    return `${Math.floor(state.resources.credits?.amount ?? 0)}|${state.rush ?? 0}|${JSON.stringify(s?.bought ?? {})}|${JSON.stringify(s?.weekBought ?? {})}|${state.activeProjectId ?? ''}|${state.longGame?.meta.act ?? 1}|${i18n.currentLocale}`;
  }

  /**
   * [ux-redesign W2d #24] An item shows once the system it feeds is open: Isotope-7 with Genesis in sight (the Genesis research tab:
   * Act III, or a later run), the project boost once a project was begun. On top of the shop's own rules (`offer.visible`).
   */
  private open(state: GameState, o: ShopOffer): boolean {
    if (!o.visible) return false;
    if (o.item.id === 'isotope') {
      const veteran = (state.prestige?.rebirthCount ?? 0) > 0 || (state.longGame?.meta.runIndex ?? 0) > 0;
      return veteran || (state.longGame?.meta.act ?? 1) >= 3 || (state.resources.isotope7?.amount ?? 0) > 0;
    }
    if (o.item.id === 'projectBoost') return !!state.activeProjectId || Object.keys(state.lateGame?.projects ?? {}).length > 0;
    return true;
  }

  /** Exactly what one purchase adds, when it is a resource ("+20 [[scrap]]"); empty for the boosts and the crate (their line says it). */
  private gets(state: GameState, id: ShopItemId): string {
    const one = (r: string, n: number) => `+${fmtNum(n)} ${RESOURCE_ICONS[r] ?? ''} ${i18n.t(`resources.${r}`)}`;
    switch (id) {
      case 'blueprint': return one('blueprints', 1);
      case 'isotope': return one('isotope7', 1);
      case 'scrap20': return one('scrap', SCRAP_BUNDLE);
      case 'rush': return `+1 [[hourglass]] ${i18n.t('p4o.favours.rushUnit')}`; // [phase4]
      case 'actGoods': return Object.entries(actGoods(state, ACT_GOODS_HOURS)).map(([r, n]) => one(r, Math.floor(n ?? 0))).join(' · ');
      default: return '';
    }
  }

  render(state: GameState, shop: ShopSystem): HTMLElement {
    const root = el('div', 'shop');
    const credits = Math.floor(state.resources.credits?.amount ?? 0);
    root.appendChild(el('p', 'shop-balance', `[[credits]] ${i18n.t('shop.balance', { n: fmtNum(credits) })}`));
    root.appendChild(el('p', 'p4o-favours-rush', `[[hourglass]] ${i18n.t('p4o.favours.charges', { n: state.rush ?? 0 })}`)); // [phase4]
    root.appendChild(el('p', 'bp-hint', i18n.t('p4o.favours.intro')));
    const offers = shop.offers(state).filter(o => this.open(state, o));
    if (offers.length === 0) root.appendChild(kEmpty('credits', i18n.t('ux2d.shop.empty')));
    for (const o of offers) {
      const row = el('div', 'shop-item');
      const text = el('div', 'shop-text');
      text.append(
        el('div', 'shop-name', `${o.item.icon} ${i18n.t(itemKey(o.item.id))}`),
        el('div', 'bp-hint', i18n.t(`${itemKey(o.item.id)}.desc`)),
      );
      const gets = this.gets(state, o.item.id);
      if (gets) text.appendChild(el('div', 'shop-gets', i18n.t('ux2d.shop.gets', { list: gets })));
      // [phase4] No caps: how many this week and how much dearer the next one gets.
      const n = shop.boughtThisWeek(state, o.item.id);
      const pct = Math.round(((o.item.weeklyRamp ?? SHOP_PRICE_RAMP) - 1) * 100);
      text.appendChild(el('div', 'bp-hint', n > 0 ? i18n.t('p4o.favours.bought', { n, pct }) : i18n.t('p4o.favours.ramp', { pct })));
      const why = !o.block ? null
        : o.block === 'credits' ? i18n.t('ux2d.shop.needCredits', { n: fmtCost(o.price - credits) })
        : i18n.t(`shop.block.${o.block}`);
      if (why && o.block !== 'credits') text.appendChild(el('div', 'bp-hint negative-text', why));
      const buy = kButton({
        variant: 'purchase',
        className: 'btn-primary shop-buy',
        label: `[[credits]] ${fmtCost(o.price)}`,
        ariaLabel: i18n.t('ux2d.shop.buyAria', { name: i18n.t(itemKey(o.item.id)), n: fmtCost(o.price) }),
        disabledReason: why,
        onPress: () => this.onBuy?.(o.item.id),
      });
      row.append(text, buy);
      root.appendChild(row);
    }
    root.appendChild(el('p', 'bp-hint', i18n.t('p4o.favours.week')));
    return root;
  }
}

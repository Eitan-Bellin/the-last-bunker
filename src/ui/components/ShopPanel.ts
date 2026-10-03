import type { GameState } from '../../core/GameState';
import type { ShopSystem } from '../../systems/ShopSystem';
import type { ShopItemId } from '../../data/shop';
import { i18n } from '../../i18n/I18nManager';
import { button, el } from '../dom';

/**
 * [Economy A2] The credits shop, drawn as a tab of the Journal sheet.
 * It only renders; buying goes through `onBuy` so the app can save and play a sound.
 */
export class ShopPanel {
  onBuy: ((id: ShopItemId) => void) | null = null;

  /** Changes whenever what the tab shows would change (balance, today's purchases, language). */
  signature(state: GameState): string {
    const s = state.shop;
    return `${Math.floor(state.resources.credits?.amount ?? 0)}|${JSON.stringify(s?.bought ?? {})}|${JSON.stringify(s?.weekBought ?? {})}|${state.activeProjectId ?? ''}|${i18n.currentLocale}`;
  }

  render(state: GameState, shop: ShopSystem): HTMLElement {
    const root = el('div', 'shop');
    root.appendChild(el('p', 'modal-sub', `[[credits]] ${i18n.t('shop.balance', { n: Math.floor(state.resources.credits?.amount ?? 0) })}`));
    root.appendChild(el('p', 'bp-hint', i18n.t('shop.intro')));
    for (const o of shop.offers(state)) {
      if (!o.visible) continue;
      const row = el('div', 'shop-item');
      const text = el('div', 'shop-text');
      text.append(
        el('div', 'shop-name', `${o.item.icon} ${i18n.t(`shop.item.${o.item.id}`)}`),
        el('div', 'bp-hint', i18n.t(`shop.item.${o.item.id}.desc`)),
      );
      if (o.item.weeklyLimit) text.appendChild(el('div', 'bp-hint', i18n.t('shop.weekLeft', { n: Math.max(0, o.left ?? 0) })));
      if (o.item.dailyLimit) text.appendChild(el('div', 'bp-hint', i18n.t('shop.dayLeft', { n: Math.max(0, o.left ?? 0) })));
      const why = o.block && o.block !== 'credits' ? i18n.t(`shop.block.${o.block}`) : '';
      if (why) text.appendChild(el('div', 'bp-hint negative-text', why));
      const buy = button(`[[credits]] ${o.price}`, 'btn-primary', () => this.onBuy?.(o.item.id), !!o.block);
      row.style.cssText = 'display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)';
      row.append(text, buy);
      root.appendChild(row);
    }
    root.appendChild(el('p', 'bp-hint', i18n.t('shop.ramp')));
    return root;
  }
}

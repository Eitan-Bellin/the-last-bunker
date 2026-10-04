import type { BuildingType, GameState, ResourceType } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { getDef } from '../../data/buildingDefs';
import { BUILDING_ICONS, RESOURCE_ICONS, el } from '../dom';
import { Sheet } from './Sheet';

/**
 * [Long game UX] The resource drawer (long-game plan, UX 4): tap a resource in the HUD to see the stock, the net rate,
 * how long until it is full or empty, who makes it, who uses it, and why its biggest producer makes what it makes.
 */
export class ResourceSheet {
  private sheet = new Sheet('resource-sheet');
  private engine: GameEngine;
  private resource: ResourceType | null = null;
  private sig = '';

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  hide(): void {
    this.sheet.hide();
  }

  show(r: ResourceType, state: GameState): void {
    this.resource = r;
    this.sig = '';
    this.refresh(state);
    this.sheet.show();
  }

  refresh(state: GameState): void {
    const r = this.resource;
    if (!r) return;
    const res = state.resources[r];
    if (!res) return;
    const bd = this.engine.resourceSystem.breakdown(state, r);
    const net = res.productionRate - res.consumptionRate;
    // Rebuild a few times a second at most, and only when the numbers moved.
    const sig = [Math.floor(res.amount), Math.round(net * 100), bd.sources.length, bd.sinks.length, i18n.currentLocale].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    const locale = i18n.currentLocale;
    const name = (key: string) => (key === 'people' ? `[[people]] ${i18n.t('res.people')}` : `${BUILDING_ICONS[key as BuildingType] ?? ''} ${getDef(key as BuildingType)?.name[locale] ?? key}`);
    this.sheet.setTitle(`${RESOURCE_ICONS[r] ?? ''} ${i18n.t(`resources.${r}`)}`);
    const root = el('div', 'res-drawer');

    const head = el('div', 'bp-card');
    head.append(
      this.row(i18n.t('res.stock'), `${i18n.formatCompact(res.amount)} / ${isFinite(res.cap) && res.cap > 0 ? i18n.formatCompact(res.cap) : '∞'}`),
      this.row(i18n.t('res.net'), `${i18n.formatRate(net)} ${i18n.t('resources.perSecond')}`, net > 0.005 ? 'positive' : net < -0.005 ? 'negative' : ''),
    );
    if (net > 0.005 && isFinite(res.cap) && res.cap > res.amount) head.appendChild(this.row(i18n.t('res.full'), i18n.formatDuration((res.cap - res.amount) / net)));
    if (net < -0.005 && res.amount > 0) head.appendChild(this.row(i18n.t('res.empty'), i18n.formatDuration(res.amount / -net), 'negative'));
    if (res.amount >= res.cap - 0.5 && net > 0.005) head.appendChild(el('div', 'bp-hint', `[[storage]] ${i18n.t('res.atCap')}`));
    root.appendChild(head);

    const list = (title: string, items: { key: string; value: number; count: number }[], sign: string) => {
      const card = el('div', 'bp-card');
      card.appendChild(el('div', 'bp-section-title', title));
      if (!items.length) card.appendChild(el('div', 'bp-hint', i18n.t('res.none')));
      for (const it of items.slice(0, 8)) {
        card.appendChild(this.row(`${name(it.key)}${it.count > 1 && it.key !== 'people' ? ` ×${it.count}` : ''}`, `${sign}${i18n.formatRate(it.value).replace(/^\+/, '')}`));
      }
      return card;
    };
    root.append(list(i18n.t('res.sources'), bd.sources, '+'), list(i18n.t('res.sinks'), bd.sinks, '−'));

    if (bd.modifiers.length) {
      const card = el('div', 'bp-card');
      card.appendChild(el('div', 'bp-section-title', i18n.t('res.why')));
      for (const m of bd.modifiers) {
        const pct = Math.round((m.mult - 1) * 100);
        card.appendChild(this.row(i18n.t(`mod.${m.id}`), `${pct > 0 ? '+' : ''}${pct}%`, pct > 0 ? 'positive' : 'negative'));
      }
      root.appendChild(card);
    }
    this.sheet.body.replaceChildren(root);
  }

  private row(label: string, value: string, cls = ''): HTMLElement {
    const r = el('div', 'bp-row');
    r.append(el('span', '', label), el('span', `bp-value ${cls}`, value));
    return r;
  }
}

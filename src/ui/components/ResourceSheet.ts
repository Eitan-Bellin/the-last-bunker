import type { BuildingType, GameState, ResourceType } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { fmtDuration, fmtNum } from '../format';
import { getDef } from '../../data/buildingDefs';
import { resourceDef } from '../../data/resources';
import { BUILDING_ICONS, RESOURCE_ICONS, el } from '../dom';
import { Sheet } from './Sheet';
import { bindPress } from '../kit';
import { lifeSupportOk } from '../HUD'; // [phase3]

/** [phase2] The stores the switcher row offers (the HUD's four tiles and its overflow), in the HUD's order; an Act opens the later ones. */
const SWITCH: ResourceType[] = ['food', 'water', 'power', 'materials', 'medicine', 'knowledge', 'scrap', 'components', 'alloys', 'data', 'influence', 'seedCores'];

/**
 * [Long game UX] The resource drawer (long-game plan, UX 4): tap a resource in the HUD to see the stock, the net rate,
 * how long until it is full or empty, who makes it, who uses it, and why its biggest producer makes what it makes.
 */
export class ResourceSheet {
  private sheet = new Sheet('resource-sheet', 'resources');
  private engine: GameEngine;
  private resource: ResourceType | null = null;
  private sig = '';
  /** [phase2] The switcher row lives beside the rebuilt body (a tap on it is never cut by a rebuild); its amounts update in place. */
  private switchEl: HTMLElement | null = null;
  private switchSig = '';
  private switchAmounts = new Map<ResourceType, HTMLElement>();
  private bodyRoot: HTMLElement | null = null;
  private scrollSwitch = false;

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
    this.scrollSwitch = true;
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
    const sig = [r, Math.floor(res.amount), Math.round(net * 100), bd.sources.length, bd.sinks.length, i18n.currentLocale, state.longGame?.meta.act ?? 0].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    const locale = i18n.currentLocale;
    const name = (key: string) => (key === 'people' ? `[[people]] ${i18n.t('res.people')}` : `${BUILDING_ICONS[key as BuildingType] ?? ''} ${getDef(key as BuildingType)?.name[locale] ?? key}`);
    this.sheet.setTitle(`${RESOURCE_ICONS[r] ?? ''} ${i18n.t(`resources.${r}`)}`);
    const sw = this.switcher(state, r);
    const root = el('div', 'res-drawer');

    const head = el('div', 'bp-card');
    head.append(
      this.row(i18n.t('res.stock'), `${fmtNum(res.amount)} / ${isFinite(res.cap) && res.cap > 0 ? fmtNum(res.cap) : '∞'}`),
      this.row(i18n.t('res.net'), `${i18n.formatRate(net)} ${i18n.t('resources.perSecond')}`, net > 0.005 ? 'positive' : net < -0.005 ? 'negative' : ''),
    );
    if (net > 0.005 && isFinite(res.cap) && res.cap > res.amount) head.appendChild(this.row(i18n.t('res.full'), fmtDuration((res.cap - res.amount) / net)));
    if (net < -0.005 && res.amount > 0) head.appendChild(this.row(i18n.t('res.empty'), fmtDuration(res.amount / -net), 'negative'));
    if (res.amount >= res.cap - 0.5 && net > 0.005) head.appendChild(el('div', 'bp-hint', `[[storage]] ${i18n.t('res.atCap')}`));
    // [phase3] Why the HUD folds this store into the life-support tile (it makes twice what is used and holds 30 minutes of it).
    if ((r === 'food' || r === 'water' || r === 'power') && lifeSupportOk(state, r)) head.appendChild(el('div', 'bp-hint', `[[heart]] ${i18n.t('p3p.life.sheet')}`));
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
    // [phase2] Only the drawer is rebuilt; the switcher row above it stays (see switchEl).
    if (this.bodyRoot && this.bodyRoot.parentNode === this.sheet.body && sw.parentNode === this.sheet.body) this.bodyRoot.replaceWith(root);
    else this.sheet.body.replaceChildren(sw, root);
    this.bodyRoot = root;
    if (this.scrollSwitch) {
      this.scrollSwitch = false;
      // The open store in view when the row scrolls sideways (the sheet has just opened or switched: it is at its top).
      sw.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /**
   * [phase2] One row of the stores in play (the HUD shows four tiles; on a phone under 360 px this row is the way to the others): the
   * open one marked, a tap switches the sheet. Scrolls sideways when it does not fit.
   */
  private switcher(state: GameState, current: ResourceType): HTMLElement {
    const act = state.longGame?.meta.act ?? 1;
    const list = SWITCH.filter(rt => {
      const opens = resourceDef(rt)?.act ?? 0;
      return !!state.resources[rt] && (opens === 0 || act >= opens);
    });
    const sig = `${current}|${list.join(',')}|${i18n.currentLocale}`;
    if (!this.switchEl || sig !== this.switchSig) {
      this.switchSig = sig;
      this.switchAmounts.clear();
      const row = el('div', 'res-switch');
      row.setAttribute('role', 'tablist');
      row.setAttribute('aria-label', i18n.t('p2h.resSwitch'));
      row.setAttribute('data-no-pulldown', ''); // a sideways swipe must not pull the sheet down
      for (const rt of list) {
        const b = el('button', 'res-switch__btn');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(rt === current));
        b.title = i18n.t(`resources.${rt}`);
        const amount = el('span', 'res-switch__amount');
        amount.dir = 'ltr';
        b.append(el('span', 'res-switch__icon', RESOURCE_ICONS[rt] ?? ''), amount);
        if (rt !== current) {
          bindPress(b, () => {
            this.resource = rt;
            this.sig = '';
            this.scrollSwitch = true;
            this.refresh(this.engine.stateManager.state);
          });
        }
        row.appendChild(b);
        this.switchAmounts.set(rt, amount);
      }
      this.switchEl?.remove();
      this.switchEl = row;
    }
    for (const [rt, node] of this.switchAmounts) {
      const text = fmtNum(state.resources[rt]?.amount ?? 0);
      if (node.textContent !== text) {
        node.textContent = text;
        node.parentElement?.setAttribute('aria-label', `${i18n.t(`resources.${rt}`)}: ${text}`);
      }
    }
    return this.switchEl;
  }

  private row(label: string, value: string, cls = ''): HTMLElement {
    const r = el('div', 'bp-row');
    r.append(el('span', '', label), el('span', `bp-value ${cls}`, value));
    return r;
  }
}

import { i18n } from '../../i18n/I18nManager';
import { bus } from '../../core/EventBus';
import { RESOURCE_ICONS, bar, button, el, setBar } from '../dom';
import { Sheet } from '../components/Sheet';
import { haptic } from '../../utils/haptics';
import { getOrder, orderTier, REWARD_GOLD, REWARD_SILVER, actCreditScale, FRAGS_PER_PLAN, type OrderTier } from '../../data/orders';
import { nextResetAt } from '../../systems/DailySystem';
import type { ChestClaim, DailyClaim } from '../../systems/DailySystem';
import type { DailyOrder, GameState } from '../../core/GameState';
import type { GameApp } from '../../app';

/**
 * [plan4:GP-1] Daily orders in the interface: the HUD chip, the sheet with the three orders, the day chest and the streak, and a
 * card in the Decision Inbox (see inbox.ts) and in the check-in (welcome.ts). The rules and the payout are DailySystem's; this only
 * shows them and forwards taps.
 */
export class DailyController {
  private app: GameApp;
  private sheet: Sheet | null = null;
  private renderedKey = '';
  /** The last day number a "new orders" toast was shown for, so it is said once. */
  private toldDay = -2;

  constructor(app: GameApp) {
    this.app = app;
  }

  private get sys() {
    return this.app.engine.dailySystem;
  }

  install(): void {
    this.app.hud.onDaily = () => {
      this.app.audio.play('click');
      const wasOpen = this.isVisible;
      this.app.closeSheets();
      if (!wasOpen) this.show();
    };
    bus.on('daily:done', (_i: unknown, id: unknown) => {
      const def = getOrder(id as string);
      if (!def) return;
      this.app.audio.play('collect');
      haptic('success');
      // With the sheet open the card itself turns into a Claim button: no toast over its title.
      if (!this.isVisible) this.app.toasts.show(`[[check]] ${i18n.t('daily.toast.done', { name: this.orderText(id as string, this.needOf(id as string)) })}`, 'good');
      this.app.engine.requestSave();
    });
    bus.on('daily:new', (info: unknown) => {
      const { day, auto } = info as { day: number; auto: number };
      if (auto > 0) this.app.toasts.show(`[[gift]] ${i18n.t('daily.toast.auto', { n: auto })}`, 'info');
      if (this.toldDay !== day) {
        this.toldDay = day;
        this.app.toasts.show(`[[target]] ${i18n.t('daily.toast.new')}`, 'info');
      }
      this.app.engine.requestSave();
    });
    bus.on('daily:claimed', (c: unknown, auto: unknown) => {
      if (auto) return; // said once by 'daily:new'
      const claim = c as DailyClaim;
      this.app.audio.play(claim.rush > 0 ? 'unlock' : 'coin');
      haptic('success');
      const what = claim.rush > 0 ? i18n.t('daily.gotRush')
        : claim.frag > 0 ? (claim.blueprints > 0 ? i18n.t('daily.gotPlan') : i18n.t('daily.goldFrag'))
          : `[[credits]] ${i18n.formatNumber(claim.credits)}${goodsText(claim.gains)}`; // [ux-wp2 R5] + the Act goods of a silver order
      this.app.toasts.show(`[[gift]] ${i18n.t('daily.got', { what })}`, 'good');
      this.app.engine.requestSave();
    });
    bus.on('daily:chest', (c: unknown, auto: unknown) => {
      if (auto) return;
      this.openChestResult(c as ChestClaim);
      this.app.engine.requestSave();
    });
  }

  get isVisible(): boolean {
    return !!this.sheet?.isVisible;
  }

  hide(): void {
    this.sheet?.hide();
  }

  // ---- text ---------------------------------------------------------------------------------------------------------------------

  private needOf(id: string): number {
    return this.app.state.daily.orders.find(o => o.id === id)?.need ?? 1;
  }

  private shown(v: number, scale: number): string {
    const x = v / scale;
    return scale > 1 ? String(Math.round(x * 10) / 10) : i18n.formatCompact(Math.round(x));
  }

  /** "Collect 10 production bubbles" with the day's number in it. */
  orderText(id: string, need: number): string {
    const def = getOrder(id);
    return i18n.t(`orders.${id}`, { n: this.shown(need, def?.scale ?? 1) });
  }

  private progressText(o: DailyOrder): string {
    const scale = getOrder(o.id)?.scale ?? 1;
    return i18n.t(scale > 1 ? 'daily.progressH' : 'daily.progress', { p: this.shown(o.p, scale), n: this.shown(o.need, scale) });
  }

  private creditsFor(tier: OrderTier): number {
    return Math.round((tier === 'medium' ? REWARD_SILVER : REWARD_GOLD) * actCreditScale(this.app.state) * (1 + this.sys.currentBonus()));
  }

  private rewardText(tier: OrderTier): string {
    if (tier === 'easy') return i18n.t('daily.reward.easy');
    return i18n.t(tier === 'medium' ? 'daily.reward.medium' : 'daily.reward.new', { n: i18n.formatNumber(this.creditsFor(tier)) })
      + (tier === 'medium' ? goodsText(this.sys.silverGoods()) : ''); // [ux-wp2 R5]
  }

  // ---- the HUD chip and the cards elsewhere ---------------------------------------------------------------------------------

  /** Called a few times a second: the HUD chip, and the sheet if it is open. */
  refresh(state: GameState): void {
    const d = state.daily;
    const sum = this.sys.summary(state);
    // [ux-wp4] D3: once the Decision inbox holds the orders card, the chip shows only while a reward waits (the inbox has the rest).
    const show = d.orders.length > 0 && this.sys.active(state) && (sum.claimable > 0 || !this.app.inbox.defers(state));
    this.app.hud.setDaily(show, sum.done, sum.n, sum.claimable, i18n.t('daily.chip', { done: sum.done, n: sum.n }));
    if (this.sheet?.isVisible) this.render();
  }

  /** The Decision Inbox card (inbox.ts adds it above the others). null while there are no orders. */
  inboxEntry(state: GameState): { title: string; detail: string; claimable: number } | null {
    if (state.daily.orders.length === 0 || !this.sys.active(state)) return null;
    const s = this.sys.summary(state);
    return { title: i18n.t('daily.chip', { done: s.done, n: s.n }), detail: this.streakText(), claimable: s.claimable };
  }

  private streakText(): string {
    const d = this.app.state.daily;
    const live = this.sys.liveStreak(d.day);
    const days = d.lastClaim === d.day ? d.streak : live;
    return days > 0 ? i18n.t('daily.streak', { n: days, pct: Math.round(this.sys.currentBonus() * 100) }) : i18n.t('daily.streak0');
  }

  // ---- the sheet ----------------------------------------------------------------------------------------------------------------

  show(): void {
    this.sheet ??= new Sheet('daily-sheet');
    this.sheet.setTitle(`[[target]] ${i18n.t('daily.title')}`);
    this.renderedKey = '';
    this.render();
    this.sheet.show();
  }

  private render(): void {
    if (!this.sheet) return;
    const state = this.app.state;
    const d = state.daily;
    const key = JSON.stringify([d.orders.map(o => [o.id, o.done, o.claimed, Math.floor(o.p / Math.max(1, o.need / 20))]), d.chest, d.swapped, d.spare.length, d.streak, d.frag, i18n.currentLocale]);
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      this.build(state);
    }
    const left = this.sheet.body.querySelector<HTMLElement>('.daily-reset');
    if (left) {
      const text = i18n.t('daily.resetIn', { t: i18n.formatDuration((nextResetAt() - Date.now()) / 1000) });
      if (left.textContent !== text) left.textContent = text;
    }
  }

  private build(state: GameState): void {
    const body = this.sheet!.body;
    body.replaceChildren();
    const d = state.daily;
    if (d.orders.length === 0) {
      body.appendChild(el('p', 'daily-empty', i18n.t('daily.empty')));
      return;
    }
    const head = el('div', 'daily-head');
    head.append(el('span', 'daily-sub', i18n.t('daily.sub')), el('span', 'daily-reset'));
    body.appendChild(head);

    d.orders.forEach((o, i) => body.appendChild(this.card(o, i)));

    const sum = this.sys.summary(state);
    const ready = d.orders.filter(o => o.done && !o.claimed).length;
    if (ready >= 2) {
      body.appendChild(button(i18n.t('daily.claimAll'), 'btn-primary daily-all', () => { this.sys.claimAll(); this.render(); }));
    }

    // The day chest: all three orders done.
    const chest = el('div', `daily-chest${sum.chestReady ? ' ready' : ''}${d.chest ? ' taken' : ''}`);
    const main = el('div', 'daily-main');
    main.append(
      el('span', 'daily-name', `[[gift]] ${i18n.t('daily.chest')}`),
      el('span', 'daily-hint', d.chest ? i18n.t('daily.chestTaken') : sum.chestReady ? i18n.t('daily.chestHint') : i18n.t('daily.chestLocked')),
    );
    chest.appendChild(main);
    if (!d.chest) chest.appendChild(button(i18n.t('daily.chestOpen'), sum.chestReady ? 'btn-primary' : 'btn-secondary', () => { this.sys.claimChest(); this.render(); }, !sum.chestReady));
    body.appendChild(chest);

    // The streak and the blueprint pieces.
    const foot = el('div', 'daily-foot');
    foot.appendChild(el('p', 'daily-streak', `[[flag]] ${this.streakText()}`));
    foot.appendChild(el('p', 'daily-hint', i18n.t('daily.grace')));
    if (d.frag > 0) foot.appendChild(el('p', 'daily-hint', `[[blueprints]] ${i18n.t('daily.frags', { n: `${d.frag}/${FRAGS_PER_PLAN}` })}`));
    body.appendChild(foot);
  }

  private card(o: DailyOrder, i: number): HTMLElement {
    const def = getOrder(o.id);
    const tier = orderTier(o.id);
    const c = el('div', `daily-card tier-${tier}${o.done ? ' done' : ''}${o.claimed ? ' claimed' : ''}`);
    c.dataset.order = o.id;
    const top = el('div', 'daily-top');
    const main = el('div', 'daily-main');
    main.append(el('span', 'daily-name', `${def?.icon ?? '[[target]]'} ${this.orderText(o.id, o.need)}`));
    const meta = el('span', 'daily-meta');
    meta.append(el('span', `daily-tier tier-${tier}`, i18n.t(`daily.tier.${tier}`)), el('span', 'daily-reward', this.rewardText(tier)));
    main.appendChild(meta);
    top.appendChild(main);
    // The swap sits in the top row (an own row for it made every card 50 px taller).
    if (!o.done && this.sys.canSwap(i)) {
      const swap = button(i18n.t('daily.swap'), 'btn-ghost btn-small daily-swap', () => { this.sys.swap(i); this.renderedKey = ''; this.render(); });
      swap.title = i18n.t('daily.swapHint');
      swap.setAttribute('aria-label', `${i18n.t('daily.swap')}: ${i18n.t('daily.swapHint')}`);
      top.appendChild(swap);
    }
    c.appendChild(top);

    const prog = el('div', 'daily-prog');
    prog.append(bar(o.done ? 100 : (o.p / o.need) * 100, 'daily-bar'), el('span', 'daily-progtext', o.done ? '✓' : this.progressText(o)));
    c.appendChild(prog);
    if (tier === 'new' && !o.done && i18n.has(`orders.${o.id}.hint`)) c.appendChild(el('p', 'daily-hint', i18n.t(`orders.${o.id}.hint`)));

    const row = el('div', 'daily-actions');
    if (o.done && !o.claimed) {
      if (tier === 'new') {
        // Gold: the player picks credits or a quarter of a blueprint.
        row.append(
          button(i18n.t('daily.goldCredits', { n: i18n.formatNumber(this.creditsFor('new')) }), 'btn-primary daily-claim', () => { this.sys.claim(i, 'credits'); this.render(); }),
          button(i18n.t('daily.goldFrag'), 'btn-secondary daily-claim', () => { this.sys.claim(i, 'frag'); this.render(); }),
        );
      } else {
        row.appendChild(button(i18n.t('daily.claim'), 'btn-primary daily-claim', () => { this.sys.claim(i, 'credits'); this.render(); }));
      }
    } else if (o.claimed) {
      row.appendChild(el('span', 'daily-taken', `[[check]] ${i18n.t('daily.claimed')}`));
    }
    if (row.childElementCount > 0) c.appendChild(row);
    // Keeps the bar honest on later refreshes without a rebuild.
    setBar(c.querySelector('.daily-bar'), o.done ? 100 : (o.p / o.need) * 100);
    return c;
  }

  /** What the chest held, in a dialog like the supply crate's. */
  private openChestResult(c: ChestClaim): void {
    this.app.audio.play('achievement');
    haptic('success');
    const body = el('div', 'modal-result');
    body.appendChild(el('p', 'modal-body', i18n.t('daily.chestHint')));
    body.appendChild(this.app.welcome.gainsList(c.gains));
    this.app.modal.show({ icon: '[[gift]]', title: i18n.t('daily.chest'), body, actions: [{ label: i18n.t('event.ok'), onClick: () => this.app.modal.hide() }] });
  }
}

/** [ux-wp2 R5] " + [[components]] 200" for goods paid besides credits (empty when there are none). */
function goodsText(gains: Partial<Record<string, number>> | undefined): string {
  const parts = Object.entries(gains ?? {}).filter(([, v]) => (v ?? 0) > 0).map(([r, v]) => `${RESOURCE_ICONS[r as keyof typeof RESOURCE_ICONS] ?? ''} ${i18n.formatCompact(Math.round(v ?? 0))}`);
  return parts.length ? ` + ${parts.join(' ')}` : '';
}

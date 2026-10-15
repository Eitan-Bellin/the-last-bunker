import { i18n } from '../../i18n/I18nManager';
import { fmtNum, plural } from '../format';
import { bus } from '../../core/EventBus';
import { RESOURCE_ICONS, bar, button, el, setBar } from '../dom';
import { Sheet } from '../components/Sheet';
import { haptic } from '../../utils/haptics';
import { getOrder, orderTier, REWARD_GOLD, REWARD_SILVER, actCreditScale, FRAGS_PER_PLAN, type OrderTier } from '../../data/orders';
import { nextResetAt } from '../../systems/DailySystem';
import { localDay } from '../../systems/SupplySystem'; // [phase4]
import type { ChestClaim, DailyClaim } from '../../systems/DailySystem';
import type { DailyOrder, GameState, ResourceType } from '../../core/GameState';
import { WEEKLY_CREDITS } from '../../data/challenges'; // [phase4] the weekly challenge is a row of the Today card
import { kButton } from '../kit';
import '../../styles/p4-o.css'; // [phase4]
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
    return scale > 1 ? String(Math.round(x * 10) / 10) : fmtNum(Math.round(x));
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
    // [phase4] The Today card: the supply crate counts as one more thing to take, and the card shows even before the orders start.
    const ready = this.todayClaimable(state);
    const show = (d.orders.length > 0 && this.sys.active(state) && (ready > 0 || !this.app.inbox.defers(state))) || this.crateReady(state);
    this.app.hud.setDaily(show, sum.done, sum.n, ready, sum.n > 0 ? i18n.t('daily.chip', { done: sum.done, n: sum.n }) : i18n.t('p4o.today.title'));
    if (this.sheet?.isVisible) this.render();
  }

  /** The Decision Inbox card (inbox.ts adds it above the others). null while there are no orders. */
  inboxEntry(state: GameState): { title: string; detail: string; claimable: number } | null {
    const crate = this.crateReady(state);
    if ((state.daily.orders.length === 0 || !this.sys.active(state)) && !crate) return null;
    const s = this.sys.summary(state);
    const title = s.n > 0 ? i18n.t('daily.chip', { done: s.done, n: s.n }) : i18n.t('supply.title');
    return { title, detail: crate ? `[[gift]] ${i18n.t('supply.title')} · ${this.streakText()}` : this.streakText(), claimable: this.todayClaimable(state) };
  }

  /** [phase4] The supply crate waits (it is part of the Today card now, not a HUD chip of its own). */
  crateReady(state: GameState): boolean {
    return this.app.engine.supplySystem.isReady(state);
  }

  /** [phase4] Everything the one Today claim would take: finished orders, the day chest, the supply crate. */
  todayClaimable(state: GameState): number {
    return this.sys.summary(state).claimable + (this.crateReady(state) ? 1 : 0);
  }

  /**
   * [phase4] The single claim of the Today card: every finished order (gold as credits, or as a piece of a blueprint when `gold` says
   * so), the day chest when all three are done, and the supply crate. One result dialog says what came in.
   */
  claimToday(gold: 'credits' | 'frag' = 'credits'): void {
    const state = this.app.state;
    const gains: Partial<Record<ResourceType, number>> = {};
    const add = (g: Partial<Record<string, number>> | undefined) => {
      for (const [r, v] of Object.entries(g ?? {})) if ((v ?? 0) > 0) gains[r as ResourceType] = (gains[r as ResourceType] ?? 0) + (v ?? 0);
    };
    let rush = 0, frag = 0, plans = 0, crateStreak = 0, n = 0;
    state.daily.orders.forEach((o, i) => {
      if (!o.done || o.claimed) return;
      const c = this.sys.claim(i, orderTier(o.id) === 'new' ? gold : 'credits', true);
      if (!c) return;
      n++;
      rush += c.rush; frag += c.frag; plans += c.blueprints;
      add({ credits: c.credits }); add(c.gains);
    });
    if (this.sys.chestReady()) { const c = this.sys.claimChest(true); if (c) { n++; add(c.gains); } }
    const crate = this.app.engine.supplySystem.claim();
    if (crate) { n++; rush += crate.rush; crateStreak = crate.streak; add(crate.gains); }
    if (n === 0) return;
    this.app.engine.requestSave();
    this.app.audio.play('achievement');
    haptic('success');
    const body = el('div', 'modal-result');
    body.appendChild(this.app.welcome.gainsList(gains));
    const extras: string[] = [];
    if (rush > 0) extras.push(`[[hourglass]] ${plural('rush.gift', rush)}`);
    if (plans > 0) extras.push(`[[blueprints]] ${i18n.t('daily.gotPlan')}`);
    else if (frag > 0) extras.push(`[[blueprints]] ${i18n.t('daily.frags', { n: `${this.app.state.daily.frag}/${FRAGS_PER_PLAN}` })}`);
    if (crateStreak > 0) extras.push(`[[fire]] ${i18n.t('supply.streak', { n: crateStreak })}`);
    for (const x of extras) body.appendChild(el('p', 'modal-sub', x));
    this.app.modal.show({ icon: '[[gift]]', title: i18n.t('p4o.today.got'), body, actions: [{ label: i18n.t('event.ok'), onClick: () => this.app.modal.hide() }] });
    this.renderedKey = '';
    this.render();
  }

  private streakText(): string {
    const d = this.app.state.daily;
    const live = this.sys.liveStreak(d.day);
    const days = d.lastClaim === d.day ? d.streak : live;
    return days > 0 ? plural('daily.streak', days, { pct: Math.round(this.sys.currentBonus() * 100) }) : i18n.t('daily.streak0');
  }

  // ---- the sheet ----------------------------------------------------------------------------------------------------------------

  show(): void {
    this.sheet ??= new Sheet('daily-sheet');
    this.sheet.setTitle(`[[target]] ${i18n.t('p4o.today.title')}`); // [phase4] one Today card
    this.renderedKey = '';
    this.render();
    this.sheet.show();
  }

  private render(): void {
    if (!this.sheet) return;
    const state = this.app.state;
    const d = state.daily;
    const wk = this.app.engine.objectiveSystem.weekly(state); // [phase4] the weekly row and the crate are part of the card
    const key = JSON.stringify([d.orders.map(o => [o.id, o.done, o.claimed, Math.floor(o.p / Math.max(1, o.need / 20))]), d.chest, d.swapped, d.spare.length, d.streak, d.frag, i18n.currentLocale,
      this.crateReady(state), wk ? [wk.def.id, wk.cur, wk.done] : null]);
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

  /**
   * [phase4] The Today card: the supply crate, the three orders, the weekly challenge and the day chest in one list, with ONE claim
   * for everything that is ready (orders no longer have a claim button each).
   */
  private build(state: GameState): void {
    const body = this.sheet!.body;
    body.replaceChildren();
    const d = state.daily;
    const head = el('div', 'daily-head');
    head.append(el('span', 'daily-sub', i18n.t('p4o.today.sub')), el('span', 'daily-reset'));
    body.appendChild(head);

    // The one claim, on top: what it takes, and (with a gold order ready) where the gold goes.
    const ready = this.todayClaimable(state);
    const goldReady = d.orders.some(o => o.done && !o.claimed && orderTier(o.id) === 'new');
    const claim = el('div', 'p4o-today-claim');
    claim.appendChild(kButton({
      label: ready > 0 ? `[[gift]] ${plural('p4o.today.claim', ready)}` : i18n.t('p4o.today.nothing'),
      className: 'btn-primary daily-all',
      disabledReason: ready > 0 ? null : i18n.t('p4o.today.nothing'),
      onPress: () => this.claimToday('credits'),
    }));
    if (goldReady) {
      claim.appendChild(kButton({
        variant: 'secondary',
        label: `[[blueprints]] ${i18n.t('p4o.today.goldFrag')}`,
        onPress: () => this.claimToday('frag'),
      }));
    }
    body.appendChild(claim);

    // The supply crate (it was a HUD chip of its own).
    const crate = this.crateReady(state);
    const crateRow = el('div', `daily-chest p4o-crate${crate ? ' ready' : ' taken'}`);
    const cm = el('div', 'daily-main');
    cm.append(el('span', 'daily-name', `[[gift]] ${i18n.t('supply.title')}`), el('span', 'daily-hint', crate ? i18n.t('p4o.today.crateReady') : i18n.t('p4o.today.crateTaken')));
    crateRow.appendChild(cm);
    if (crate || state.supplyDrop?.day === localDay()) body.appendChild(crateRow); // not before the first crate can land

    if (d.orders.length === 0) body.appendChild(el('p', 'daily-empty', i18n.t('daily.empty')));
    d.orders.forEach((o, i) => body.appendChild(this.card(o, i)));

    // The weekly challenge: a row of the same card (its prize is paid by itself when it is done).
    const wk = this.app.engine.objectiveSystem.weekly(state);
    if (wk) {
      const row = el('div', `daily-card p4o-weekly${wk.done ? ' claimed' : ''}`);
      const main = el('div', 'daily-main');
      main.append(
        el('span', 'daily-name', `[[trophy]] ${i18n.t('weekly.title')}: ${wk.def.text[i18n.currentLocale as 'he' | 'en'] ?? wk.def.text.en}`),
        el('span', 'daily-hint', wk.done ? `[[check]] ${i18n.t('weekly.done')}` : i18n.t('weekly.prize', { n: WEEKLY_CREDITS, cur: wk.cur, target: wk.target })),
      );
      row.append(main, bar(wk.done ? 100 : (wk.cur / Math.max(1, wk.target)) * 100, 'daily-bar'));
      body.appendChild(row);
    }

    // The day chest: all three orders done (taken by the claim above).
    if (d.orders.length > 0) {
      const sum = this.sys.summary(state);
      const chest = el('div', `daily-chest${sum.chestReady ? ' ready' : ''}${d.chest ? ' taken' : ''}`);
      const main = el('div', 'daily-main');
      main.append(
        el('span', 'daily-name', `[[gift]] ${i18n.t('daily.chest')}`),
        el('span', 'daily-hint', d.chest ? i18n.t('daily.chestTaken') : sum.chestReady ? i18n.t('daily.chestHint') : i18n.t('daily.chestLocked')),
      );
      chest.appendChild(main);
      body.appendChild(chest);
    }

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

    // [phase4] No claim button per order: the Today card's one claim takes them all. A finished order says it is ready.
    if (o.done) c.appendChild(el('span', 'daily-taken', o.claimed ? `[[check]] ${i18n.t('daily.claimed')}` : `[[gift]] ${i18n.t('p4o.today.orderReady')}`));
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
  const parts = Object.entries(gains ?? {}).filter(([, v]) => (v ?? 0) > 0).map(([r, v]) => `${RESOURCE_ICONS[r as keyof typeof RESOURCE_ICONS] ?? ''} ${fmtNum(Math.round(v ?? 0))}`);
  return parts.length ? ` + ${parts.join(' ')}` : '';
}

import type { DailyOrder, GameState, ResourceType } from '../../core/GameState';
import type { GameApp } from '../../app';
import { i18n } from '../../i18n/I18nManager';
import { fmtNum, plural } from '../format';
import { RESOURCE_ICONS, bar, el, setBar } from '../dom';
import { kButton } from '../kit';
import { haptic } from '../../utils/haptics';
import { getOrder, orderTier, REWARD_GOLD, REWARD_SILVER, actCreditScale, FRAGS_PER_PLAN, type OrderTier } from '../../data/orders';
import { WEEKLY_CREDITS } from '../../data/challenges';
import { nextResetAt } from '../../systems/DailySystem';
import '../../styles/p4b-o.css';

/**
 * [phase4b] The one "Today" card (C6): the supply crate, the three daily orders, the day chest and the week's challenge on one sheet, with
 * ONE claim button that takes everything ready at once and shows it in one result. Per-order claim buttons are gone; the only choices
 * left on the card are real ones: which order to swap (once a day) and what the gold order pays (credits or a piece of a plan).
 * The rules and the payouts stay in DailySystem / SupplySystem / ObjectiveSystem (weekly); this only shows them and forwards the claim.
 */
export class TodayCard {
  private app: GameApp;
  /** What the gold order pays when the claim takes it (the player's pick on the card; this session). */
  goldFrag = false;
  /** True while the one claim runs: the per-order and chest listeners in daily.ts stay quiet (one result instead of four toasts). */
  batching = false;

  constructor(app: GameApp) {
    this.app = app;
  }

  private get daily() {
    return this.app.engine.dailySystem;
  }

  private get supply() {
    return this.app.engine.supplySystem;
  }

  /** Everything the one claim would take now: finished orders, the day chest, today's crate. */
  claimable(state: GameState): number {
    const d = this.daily;
    if (!d.active(state)) return this.supply.isReady(state) ? 1 : 0;
    return d.summary(state).claimable + (this.supply.isReady(state) ? 1 : 0);
  }

  /** Changes whenever the card's content would change (the progress bars are kept current without a rebuild). */
  signature(state: GameState): string {
    const d = state.daily;
    const w = this.app.engine.objectiveSystem.weekly(state);
    return JSON.stringify([d.orders.map(o => [o.id, o.done, o.claimed]), d.chest, d.swapped, d.spare.length, d.streak, d.frag, this.goldFrag,
      this.supply.isReady(state), w ? [w.def.id, w.done, w.cur] : null, i18n.currentLocale]);
  }

  // ---- text ---------------------------------------------------------------------------------------------------------------------

  private shown(v: number, scale: number): string {
    const x = v / scale;
    return scale > 1 ? String(Math.round(x * 10) / 10) : fmtNum(Math.round(x));
  }

  orderText(id: string, need: number): string {
    return i18n.t(`orders.${id}`, { n: this.shown(need, getOrder(id)?.scale ?? 1) });
  }

  private progressText(o: DailyOrder): string {
    const scale = getOrder(o.id)?.scale ?? 1;
    return i18n.t(scale > 1 ? 'daily.progressH' : 'daily.progress', { p: this.shown(o.p, scale), n: this.shown(o.need, scale) });
  }

  private creditsFor(tier: OrderTier): number {
    return Math.round((tier === 'medium' ? REWARD_SILVER : REWARD_GOLD) * actCreditScale(this.app.state) * (1 + this.daily.currentBonus()));
  }

  private rewardText(tier: OrderTier): string {
    if (tier === 'easy') return i18n.t('daily.reward.easy');
    if (tier === 'new') return this.goldFrag ? i18n.t('p4bO.today.goldFragShort') : i18n.t('daily.goldCredits', { n: i18n.formatNumber(this.creditsFor(tier)) });
    return i18n.t('daily.reward.medium', { n: i18n.formatNumber(this.creditsFor(tier)) }) + goodsText(this.daily.silverGoods());
  }

  streakText(): string {
    const d = this.app.state.daily;
    const days = d.lastClaim === d.day ? d.streak : this.daily.liveStreak(d.day);
    return days > 0 ? plural('daily.streak', days, { pct: Math.round(this.daily.currentBonus() * 100) }) : i18n.t('daily.streak0');
  }

  // ---- the card -----------------------------------------------------------------------------------------------------------------

  /** The sheet's content. `changed` rebuilds it (after a swap, the gold pick or the claim). */
  build(state: GameState, changed: () => void): HTMLElement {
    const root = el('div', 'p4bo-today');
    const d = state.daily;
    const active = this.daily.active(state);
    const head = el('div', 'daily-head');
    head.append(el('span', 'daily-sub', i18n.t('p4bO.today.sub')), el('span', 'daily-reset'));
    root.appendChild(head);
    // The one claim, first thing on the card (everything ready below it goes with it).
    const n = this.claimable(state);
    const claim = kButton({
      label: n > 0 ? `[[gift]] ${plural('p4bO.today.claim', n)}` : i18n.t('p4bO.today.nothing'),
      className: 'btn-primary p4bo-today__claim',
      disabledReason: n > 0 ? null : i18n.t('p4bO.today.nothingWhy'),
      sound: null,
      onPress: () => { this.claimAll(); changed(); },
    });
    root.appendChild(claim);


    // The crate by the hatch: opened by the same claim.
    const crateReady = this.supply.isReady(state);
    const crate = el('div', `p4bo-today__row${crateReady ? ' is-ready' : ' is-taken'}`);
    crate.append(
      el('span', 'p4bo-today__icon', '[[gift]]'),
      el('span', 'p4bo-today__text', `${i18n.t('supply.title')} · ${i18n.t(crateReady ? 'p4bO.today.crateReady' : 'p4bO.today.crateTaken')}`),
    );
    root.appendChild(crate);

    if (active && d.orders.length) {
      d.orders.forEach((o, i) => root.appendChild(this.card(o, i, changed)));
      // The day chest: all three orders done.
      const sum = this.daily.summary(state);
      const chest = el('div', `p4bo-today__row${sum.chestReady ? ' is-ready' : d.chest ? ' is-taken' : ''}`);
      chest.append(
        el('span', 'p4bo-today__icon', '[[gift]]'),
        el('span', 'p4bo-today__text', `${i18n.t('daily.chest')} · ${d.chest ? i18n.t('daily.chestTaken') : sum.chestReady ? i18n.t('p4bO.today.chestReady') : i18n.t('p4bO.today.chestLocked', { n: sum.done, all: sum.n })}`),
      );
      root.appendChild(chest);
    } else if (!active) {
      root.appendChild(el('p', 'daily-hint', i18n.t('p4bO.today.ordersLater')));
    }

    // The week's challenge: counts by itself, pays its credits the moment it is met.
    const w = this.app.engine.objectiveSystem.weekly(state);
    if (w) {
      const week = el('div', `p4bo-today__week${w.done ? ' is-taken' : ''}`);
      const top = el('div', 'p4bo-today__row-in');
      top.append(el('span', 'p4bo-today__icon', '[[trophy]]'), el('span', 'p4bo-today__text', `${i18n.t('weekly.title')} · ${w.def.icon} ${w.def.text[i18n.currentLocale]}`));
      week.append(top, bar(Math.min(100, (w.cur / w.target) * 100), 'accent'),
        el('span', 'daily-hint', w.done ? `[[check]] ${i18n.t('weekly.done')}` : i18n.t('p4bO.today.weekPrize', { n: fmtNum(WEEKLY_CREDITS), cur: fmtNum(Math.min(w.cur, w.target)), target: fmtNum(w.target) })));
      root.appendChild(week);
    }

    const foot = el('div', 'daily-foot');
    if (active) {
      foot.appendChild(el('p', 'daily-streak', `[[flag]] ${this.streakText()}`));
      foot.appendChild(el('p', 'daily-hint', i18n.t('daily.grace')));
      if (d.frag > 0) foot.appendChild(el('p', 'daily-hint', `[[blueprints]] ${i18n.t('daily.frags', { n: `${d.frag}/${FRAGS_PER_PLAN}` })}`));
    }
    root.appendChild(foot);
    return root;
  }

  /** Keeps the clock and the bars honest between rebuilds. */
  tick(root: HTMLElement, state: GameState): void {
    const left = root.querySelector<HTMLElement>('.daily-reset');
    if (left) {
      const text = i18n.t('daily.resetIn', { t: i18n.formatDuration((nextResetAt() - Date.now()) / 1000) });
      if (left.textContent !== text) left.textContent = text;
    }
    state.daily.orders.forEach(o => {
      const card = root.querySelector<HTMLElement>(`.daily-card[data-order="${o.id}"]`);
      if (!card) return;
      setBar(card.querySelector('.daily-bar'), o.done ? 100 : (o.p / o.need) * 100);
      const t = card.querySelector<HTMLElement>('.daily-progtext');
      const text = o.done ? '✓' : this.progressText(o);
      if (t && t.textContent !== text) t.textContent = text;
    });
  }

  private card(o: DailyOrder, i: number, changed: () => void): HTMLElement {
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
    if (!o.done && this.daily.canSwap(i)) {
      top.appendChild(kButton({
        variant: 'tertiary',
        className: 'btn-ghost btn-small daily-swap',
        label: i18n.t('daily.swap'),
        ariaLabel: `${i18n.t('daily.swap')}: ${i18n.t('daily.swapHint')}`,
        onPress: () => { this.daily.swap(i); changed(); },
      }));
    }
    c.appendChild(top);
    const prog = el('div', 'daily-prog');
    prog.append(bar(o.done ? 100 : (o.p / o.need) * 100, 'daily-bar'), el('span', 'daily-progtext', o.claimed ? '✓' : o.done ? i18n.t('p4bO.today.ready') : this.progressText(o)));
    c.appendChild(prog);
    if (tier === 'new' && !o.done && i18n.has(`orders.${o.id}.hint`)) c.appendChild(el('p', 'daily-hint', i18n.t(`orders.${o.id}.hint`)));
    // The gold order's one real choice: what it pays when the claim takes it.
    if (tier === 'new' && !o.claimed) {
      const pick = el('div', 'p4bo-today__pick');
      pick.setAttribute('role', 'group');
      pick.setAttribute('aria-label', i18n.t('p4bO.today.goldPays'));
      for (const frag of [false, true]) {
        const b = kButton({
          variant: 'secondary',
          className: `btn-secondary btn-small p4bo-today__opt${this.goldFrag === frag ? ' is-on' : ''}`,
          label: frag ? `[[blueprints]] ${i18n.t('p4bO.today.goldFragShort')}` : `[[credits]] ${i18n.formatNumber(this.creditsFor('new'))}`,
          onPress: () => { this.goldFrag = frag; changed(); },
        });
        b.setAttribute('aria-pressed', String(this.goldFrag === frag));
        pick.appendChild(b);
      }
      c.appendChild(pick);
    }
    return c;
  }

  // ---- the one claim ------------------------------------------------------------------------------------------------------------

  /** Takes everything ready (orders, chest, crate) and shows what came in, once. Returns how many things were taken. */
  claimAll(): number {
    const app = this.app;
    const gains: Partial<Record<ResourceType, number>> = {};
    const add = (g: Partial<Record<string, number>> | undefined) => {
      for (const [r, v] of Object.entries(g ?? {})) if (v) gains[r as ResourceType] = (gains[r as ResourceType] ?? 0) + v;
    };
    let rush = 0;
    let taken = 0;
    let plan = false;
    let frag = false;
    let streak = 0;
    this.batching = true;
    try {
      const state = app.state;
      if (this.daily.active(state)) {
        state.daily.orders.forEach((o, i) => {
          if (!o.done || o.claimed) return;
          const c = this.daily.claim(i, orderTier(o.id) === 'new' && this.goldFrag ? 'frag' : 'credits');
          if (!c) return;
          taken++;
          rush += c.rush;
          if (c.credits) add({ credits: c.credits });
          add(c.gains);
          if (c.frag) frag = true;
          if (c.blueprints) { plan = true; add({ blueprints: c.blueprints }); }
        });
        const chest = this.daily.claimChest();
        if (chest) { taken++; add(chest.gains); }
      }
      const crate = this.supply.claim();
      if (crate) { taken++; add(crate.gains); rush += crate.rush; streak = crate.streak; }
    } finally {
      this.batching = false;
    }
    if (taken === 0) return 0;
    app.engine.requestSave();
    app.audio.play('achievement');
    haptic('success');
    const body = el('div', 'modal-result');
    body.appendChild(app.welcome.gainsList(gains));
    if (rush > 0) body.appendChild(el('p', 'modal-sub', `[[hourglass]] ${plural('rush.gift', rush)}`));
    if (plan) body.appendChild(el('p', 'modal-sub', i18n.t('daily.gotPlan')));
    else if (frag) body.appendChild(el('p', 'modal-sub', `[[blueprints]] ${i18n.t('daily.frags', { n: `${app.state.daily.frag}/${FRAGS_PER_PLAN}` })}`));
    if (streak > 1) body.appendChild(el('p', 'modal-sub', `[[fire]] ${i18n.t('supply.streak', { n: streak })}`));
    app.modal.show({ icon: '[[gift]]', title: i18n.t('p4bO.today.got'), body, actions: [{ label: i18n.t('event.ok'), onClick: () => app.modal.hide() }] });
    return taken;
  }
}

/** " + [[components]] 200" for goods paid besides credits (empty when there are none). */
function goodsText(gains: Partial<Record<string, number>> | undefined): string {
  const parts = Object.entries(gains ?? {}).filter(([, v]) => (v ?? 0) > 0).map(([r, v]) => `${RESOURCE_ICONS[r as keyof typeof RESOURCE_ICONS] ?? ''} ${fmtNum(Math.round(v ?? 0))}`);
  return parts.length ? ` + ${parts.join(' ')}` : '';
}

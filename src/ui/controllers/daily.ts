import { i18n } from '../../i18n/I18nManager';
import { bus } from '../../core/EventBus';
import { Sheet } from '../components/Sheet';
import { TodayCard } from '../components/TodayCard'; // [phase4b]
import { haptic } from '../../utils/haptics';
import { getOrder } from '../../data/orders';
import { RESOURCE_ICONS } from '../dom';
import { fmtNum } from '../format';
import type { ChestClaim, DailyClaim } from '../../systems/DailySystem';
import type { GameState } from '../../core/GameState';
import type { GameApp } from '../../app';

/**
 * [plan4:GP-1] Daily orders in the interface: the HUD chip, the sheet and a card in the Messages bell (see inbox.ts).
 * [phase4b] The sheet is the one "Today" card (TodayCard): the supply crate, the three orders, the day chest and the week's challenge,
 * with a single claim. The rules and the payout are DailySystem's / SupplySystem's; this only shows them and forwards taps.
 */
export class DailyController {
  private app: GameApp;
  private sheet: Sheet | null = null;
  private renderedKey = '';
  /** The last day number a "new orders" toast was shown for, so it is said once. */
  private toldDay = -2;
  /** [phase4b] The Today card (built with the controller; the sheet is made on first open). */
  readonly today: TodayCard;

  constructor(app: GameApp) {
    this.app = app;
    this.today = new TodayCard(app);
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
      // With the card open its own line turns to "Ready": no toast over it.
      if (!this.isVisible) this.app.toasts.show(`[[check]] ${i18n.t('daily.toast.done', { name: this.today.orderText(id as string, this.needOf(id as string)) })}`, 'good');
      this.app.engine.requestSave();
    });
    bus.on('daily:new', (info: unknown) => {
      const { day, auto } = info as { day: number; auto: number };
      if (auto > 0) this.app.toasts.show(`[[gift]] ${i18n.t('daily.toast.auto', { n: auto })}`, 'info');
      if (this.toldDay !== day) {
        this.toldDay = day;
        this.app.toasts.show(`[[target]] ${i18n.t('p4bO.today.toastNew')}`, 'info');
      }
      this.app.engine.requestSave();
    });
    // A claim made elsewhere (the welcome-back card) still says what it paid; the Today card's own claim shows one result instead.
    bus.on('daily:claimed', (c: unknown, auto: unknown) => {
      if (auto || this.today.batching) return;
      const claim = c as DailyClaim;
      this.app.audio.play(claim.rush > 0 ? 'unlock' : 'coin');
      const what = claim.rush > 0 ? i18n.t('daily.gotRush')
        : claim.frag > 0 ? (claim.blueprints > 0 ? i18n.t('daily.gotPlan') : i18n.t('daily.goldFrag'))
          : `[[credits]] ${i18n.formatNumber(claim.credits)}${goodsText(claim.gains)}`;
      this.app.toasts.show(`[[gift]] ${i18n.t('daily.got', { what })}`, 'good');
      this.app.engine.requestSave();
    });
    bus.on('daily:chest', (c: unknown, auto: unknown) => {
      if (auto || this.today.batching) return;
      const gains = (c as ChestClaim).gains;
      this.app.toasts.show(`[[gift]] ${i18n.t('daily.chest')}${goodsText(gains)}`, 'good');
      this.app.engine.requestSave();
    });
  }

  get isVisible(): boolean {
    return !!this.sheet?.isVisible;
  }

  hide(): void {
    this.sheet?.hide();
  }

  private needOf(id: string): number {
    return this.app.state.daily.orders.find(o => o.id === id)?.need ?? 1;
  }

  /** "Collect 10 production bubbles" with the day's number in it. */
  orderText(id: string, need: number): string {
    return this.today.orderText(id, need);
  }

  // ---- the HUD chip and the cards elsewhere ---------------------------------------------------------------------------------

  /** Called a few times a second: the HUD chip, and the sheet if it is open. */
  refresh(state: GameState): void {
    const d = state.daily;
    const sum = this.sys.summary(state);
    // [ux-wp4] D3 / [phase4b] The chip shows only while something waits for the one claim (the bell has the card the rest of the time).
    const ready = this.today.claimable(state);
    const show = d.orders.length > 0 && this.sys.active(state) && (ready > 0 || !this.app.inbox.defers(state));
    this.app.hud.setDaily(show, sum.done, sum.n, ready, i18n.t('p4bO.today.chip', { done: sum.done, n: sum.n }));
    if (this.sheet?.isVisible) this.render();
  }

  /** The Messages bell card (inbox.ts adds it above the others). null while there is nothing to show. */
  inboxEntry(state: GameState): { title: string; detail: string; claimable: number } | null {
    const ready = this.today.claimable(state);
    if ((state.daily.orders.length === 0 || !this.sys.active(state)) && ready === 0) return null;
    const s = this.sys.summary(state);
    return { title: i18n.t('p4bO.today.chip', { done: s.done, n: s.n }), detail: this.today.streakText(), claimable: ready };
  }

  // ---- the sheet ----------------------------------------------------------------------------------------------------------------

  show(): void {
    this.sheet ??= new Sheet('daily-sheet');
    this.sheet.setTitle(`[[target]] ${i18n.t('p4bO.today.title')}`);
    this.renderedKey = '';
    this.render();
    this.sheet.show();
  }

  private render(): void {
    if (!this.sheet) return;
    const state = this.app.state;
    const key = this.today.signature(state);
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      this.sheet.body.replaceChildren(this.today.build(state, () => { this.renderedKey = ''; this.render(); }));
    }
    this.today.tick(this.sheet.body, state);
  }
}

/** [ux-wp2 R5] " + [[components]] 200" for goods paid besides credits (empty when there are none). */
function goodsText(gains: Partial<Record<string, number>> | undefined): string {
  const parts = Object.entries(gains ?? {}).filter(([, v]) => (v ?? 0) > 0).map(([r, v]) => `${RESOURCE_ICONS[r as keyof typeof RESOURCE_ICONS] ?? ''} ${fmtNum(Math.round(v ?? 0))}`);
  return parts.length ? ` + ${parts.join(' ')}` : '';
}

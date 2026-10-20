import { el } from '../dom';
import { i18n } from '../../i18n/I18nManager';
import { getHudInsets } from '../../utils/hudInsets';
import { announce } from '../a11yDom';
import { kButton, setKButtonDisabled, setKButtonLabel } from '../kit';
import { costChips } from './BuildMenu';
import type { GameState } from '../../core/GameState';

// [plan4:ST-19] The placement console: effect / reason chips that follow the ghost room, and the confirm bar above the bottom nav
// ("Best spot", "Cancel" and "Build (cost)": 48px tall, 56px wide at least; the thumb side follows the one-hand setting, styles/placement.css).
// Nothing here touches the game: the controller (ui/controllers/world.ts) feeds it and handles the three buttons.
// [ux-redesign w2c #2] The three are kit buttons. Build is disabled with its reason (no spot chosen, the spot is refused, what the price lacks):
// pressing it anyway shakes it and shows the reason; "Best spot" is disabled when the room has no valid spot at all.

export type ChipKind = 'good' | 'warn' | 'bad' | 'info';
export interface Chip { kind: ChipKind; text: string }

/** A rectangle in canvas px (the ghost room on screen). */
type ScreenRect = { x: number; y: number; w: number; h: number };

export class PlacementBar {
  onConfirm: (() => void) | null = null;
  onCancel: (() => void) | null = null;
  onRecommend: (() => void) | null = null;

  private readonly bar = el('div', 'placement-bar');
  private readonly chips = el('div', 'placement-chips');
  private readonly hint = el('div', 'placement-hint');
  private readonly build: HTMLButtonElement;
  private readonly rec: HTMLButtonElement;
  private readonly buildCost = el('span', 'pl-cost-slot');
  private follow: (() => ScreenRect | null) | null = null;
  private raf = 0;
  private hintTimer = 0;
  private lastChips = '';
  private chipW = 0;
  private lastPos = '';
  private lastCost = '';

  constructor(parent: HTMLElement = document.body) {
    this.bar.setAttribute('role', 'group');
    this.bar.setAttribute('aria-label', i18n.t('placement.title'));
    const cancel = kButton({
      variant: 'secondary',
      className: 'pl-btn pl-cancel',
      icon: 'close',
      ariaLabel: i18n.t('placement.cancelAria'),
      onPress: () => this.onCancel?.(),
    });
    cancel.title = i18n.t('placement.cancel');
    this.rec = kButton({
      variant: 'secondary',
      className: 'pl-btn pl-rec',
      icon: 'target',
      label: i18n.t('placement.recommend'),
      ariaLabel: i18n.t('placement.recommendAria'),
      onPress: () => this.onRecommend?.(),
    });
    this.build = kButton({
      variant: 'primary',
      className: 'pl-btn pl-build',
      icon: 'check',
      label: i18n.t('placement.build'),
      detail: this.buildCost,
      disabledReason: i18n.t('placement.noGhost'),
      onPress: () => this.onConfirm?.(),
    });
    this.bar.append(cancel, this.rec, this.build);
    this.chips.setAttribute('aria-hidden', 'true'); // the same words are announced politely when they change
    this.hint.setAttribute('role', 'status');
    for (const n of [this.chips, this.hint, this.bar]) { n.style.display = 'none'; parent.appendChild(n); }
  }

  get isVisible(): boolean { return this.bar.style.display !== 'none'; }

  /** Opens the bar for a room: its name for the Build button's label and its price (chips go red for what is missing). `move` = relocating a room. */
  show(name: string, state: GameState, cost: Record<string, number>, move = false): void {
    setKButtonLabel(this.build, i18n.t(move ? 'relocate.confirm' : 'placement.build'));
    this.build.setAttribute('aria-label', i18n.t(move ? 'relocate.confirmAria' : 'placement.buildAria', { name }));
    this.lastCost = '';
    this.setCost(state, cost);
    this.setReady(i18n.t('placement.noGhost'));
    this.setRecommendable(null);
    this.bar.style.display = '';
    document.body.classList.add('placement-bar-on');
    this.syncHeight();
  }

  /** The price on Build: chips with a check or a cross, and how much is short (redrawn only when the picture changes). */
  setCost(state: GameState, cost: Record<string, number>): void {
    const short = (r: string, v: number) => Math.max(0, Math.ceil(v - (state.resources[r as keyof GameState['resources']]?.amount ?? 0)));
    const sig = Object.entries(cost).map(([r, v]) => `${r}:${v}:${short(r, v)}`).join('|');
    if (sig === this.lastCost) return;
    this.lastCost = sig;
    this.buildCost.replaceChildren(costChips(state, cost, 'pl-cost'));
  }

  /** null = a ghost on a valid spot the bunker can pay for (Build is ready); otherwise the reason Build is disabled. */
  setReady(reason: string | null): void {
    setKButtonDisabled(this.build, reason);
  }

  /** null = "Best spot" works; otherwise why it cannot (the room has no valid spot at all). */
  setRecommendable(reason: string | null): void {
    setKButtonDisabled(this.rec, reason);
  }

  /** The chips over the ghost (effects when valid, the reason when not). An empty list hides them. */
  setChips(chips: Chip[], announceText = ''): void {
    const sig = chips.map(c => `${c.kind}:${c.text}`).join('|');
    if (sig === this.lastChips) return;
    this.lastChips = sig;
    this.chips.replaceChildren(...chips.map(c => {
      const chip = el('span', `pl-chip ${c.kind}`, c.text);
      return chip;
    }));
    this.chipW = 0;
    this.lastPos = '';
    this.chips.style.display = chips.length && this.follow ? '' : 'none';
    if (announceText) announce(announceText, chips.some(c => c.kind === 'bad') ? 'assertive' : 'polite');
    this.place();
  }

  /** A short message just above the bar ("Choose a spot first"). */
  flash(text: string, kind: 'warn' | 'bad' = 'warn'): void {
    this.hint.className = `placement-hint ${kind}`;
    this.hint.textContent = text;
    this.hint.style.display = '';
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => { this.hint.style.display = 'none'; }, 2200);
    announce(text, 'polite');
  }

  /** Starts following the ghost: `rect` gives its canvas rectangle each picture (null = none). */
  followGhost(rect: (() => ScreenRect | null) | null): void {
    this.follow = rect;
    if (rect && !this.raf) {
      const loop = (): void => {
        this.place();
        this.raf = this.isVisible ? requestAnimationFrame(loop) : 0;
      };
      this.raf = requestAnimationFrame(loop);
    }
    if (!rect) this.chips.style.display = 'none';
  }

  /** Px at the bottom of the screen the bar covers on top of the nav (the camera keeps the ghost above it). */
  coverPx(): number {
    if (!this.isVisible) return 0;
    const r = this.bar.getBoundingClientRect();
    return Math.max(0, window.innerHeight - r.top - getHudInsets().bottom);
  }

  private syncHeight(): void {
    document.documentElement.style.setProperty('--pl-h', `${Math.round(this.bar.getBoundingClientRect().height)}px`);
  }

  /** Puts the chips above the ghost (below it when there is no room above), centred and kept inside the screen. */
  private place(): void {
    const r = this.follow?.();
    if (!r || this.chips.style.display === 'none') return;
    if (!this.chipW) this.chipW = this.chips.offsetWidth;
    const w = this.chipW || 160;
    const vw = window.innerWidth;
    const cx = Math.max(8 + w / 2, Math.min(vw - 8 - w / 2, r.x + r.w / 2));
    const top = getHudInsets().top + 4;
    const above = r.y - 6;
    const h = this.chips.offsetHeight || 28;
    const below = above - h < top;
    const y = below ? Math.min(window.innerHeight - 120, r.y + r.h + 6) : above;
    const key = `${Math.round(cx)}|${Math.round(y)}|${below}`;
    if (key === this.lastPos) return;
    this.lastPos = key;
    this.chips.style.left = `${cx}px`;
    this.chips.style.top = `${y}px`;
    this.chips.style.transform = below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
  }

  hide(): void {
    this.bar.style.display = 'none';
    this.chips.style.display = 'none';
    this.hint.style.display = 'none';
    this.follow = null;
    this.lastChips = '';
    this.chips.replaceChildren();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.body.classList.remove('placement-bar-on');
  }
}

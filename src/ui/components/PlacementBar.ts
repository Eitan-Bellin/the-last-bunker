import { el, costRow } from '../dom';
import { i18n } from '../../i18n/I18nManager';
import { haptic } from '../../utils/haptics';
import { getHudInsets } from '../../utils/hudInsets';
import { announce } from '../a11yDom';
import type { GameState } from '../../core/GameState';

// [plan4:ST-19] The placement console: effect / reason chips that follow the ghost room, and the confirm bar above the bottom nav
// ("Best spot", "Cancel" and "Build (cost)": 48px tall, 56px wide at least; the thumb side follows the one-hand setting, styles/placement.css).
// Nothing here touches the game: the controller (ui/controllers/world.ts) feeds it and handles the three buttons.

export type ChipKind = 'good' | 'warn' | 'bad' | 'info';
export interface Chip { kind: ChipKind; text: string }

/** A rectangle in canvas px (the ghost room on screen). */
type ScreenRect = { x: number; y: number; w: number; h: number };

export class PlacementBar {
  onConfirm: (() => void) | null = null;
  onCancel: (() => void) | null = null;
  onRecommend: (() => void) | null = null;
  /** The Build button was pressed while it cannot build (no ghost yet, or an invalid spot): the controller says why. */
  onIdleBuild: (() => void) | null = null;

  private readonly bar = el('div', 'placement-bar');
  private readonly chips = el('div', 'placement-chips');
  private readonly hint = el('div', 'placement-hint');
  private readonly build: HTMLButtonElement;
  private readonly buildCost = el('span', 'pl-cost-slot');
  private readonly buildLabel = el('span', 'pl-build-label');
  private follow: (() => ScreenRect | null) | null = null;
  private raf = 0;
  private hintTimer = 0;
  private lastChips = '';
  private chipW = 0;
  private lastPos = '';
  private ready = false;

  constructor(parent: HTMLElement = document.body) {
    this.bar.setAttribute('role', 'group');
    this.bar.setAttribute('aria-label', i18n.t('placement.title'));
    const cancel = el('button', 'pl-btn pl-cancel', '[[close]]');
    cancel.type = 'button';
    cancel.setAttribute('aria-label', i18n.t('placement.cancelAria'));
    cancel.title = i18n.t('placement.cancel');
    cancel.addEventListener('click', () => { haptic('tap'); this.onCancel?.(); });
    const rec = el('button', 'pl-btn pl-rec') as HTMLButtonElement;
    rec.type = 'button';
    rec.setAttribute('aria-label', i18n.t('placement.recommendAria'));
    rec.append(el('span', 'pl-ico', '[[target]]'), el('span', 'pl-lbl', i18n.t('placement.recommend')));
    rec.addEventListener('click', () => { haptic('tap'); this.onRecommend?.(); });
    this.build = el('button', 'pl-btn pl-build idle') as HTMLButtonElement;
    this.build.type = 'button';
    this.build.append(el('span', 'pl-ico', '[[check]]'), this.buildLabel, this.buildCost);
    this.build.addEventListener('click', () => {
      if (!this.ready) { this.onIdleBuild?.(); return; }
      this.onConfirm?.();
    });
    this.bar.append(cancel, rec, this.build);
    this.chips.setAttribute('aria-hidden', 'true'); // the same words are announced politely when they change
    this.hint.setAttribute('role', 'status');
    for (const n of [this.chips, this.hint, this.bar]) { n.style.display = 'none'; parent.appendChild(n); }
  }

  get isVisible(): boolean { return this.bar.style.display !== 'none'; }

  /** Opens the bar for a room: its name for the Build button's label and its price (chips go red for what is missing). `move` = relocating a room. */
  show(name: string, state: GameState, cost: Record<string, number>, move = false): void {
    this.buildLabel.textContent = i18n.t(move ? 'relocate.confirm' : 'placement.build');
    this.build.setAttribute('aria-label', i18n.t(move ? 'relocate.confirmAria' : 'placement.buildAria', { name }));
    this.setCost(state, cost);
    this.setReady(false);
    this.bar.style.display = '';
    document.body.classList.add('placement-bar-on');
    this.syncHeight();
  }

  setCost(state: GameState, cost: Record<string, number>): void {
    this.buildCost.replaceChildren(costRow(state, cost));
  }

  /** Is there a ghost on a valid spot (the Build button looks and acts ready)? */
  setReady(ready: boolean): void {
    this.ready = ready;
    this.build.classList.toggle('idle', !ready);
    this.build.setAttribute('aria-disabled', ready ? 'false' : 'true');
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

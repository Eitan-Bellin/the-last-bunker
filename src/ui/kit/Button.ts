import { el, setRich } from '../dom';
import { haptic } from '../../utils/haptics';
import { uiSound } from '../../audio/uiSound';
import { i18n } from '../../i18n/I18nManager';
import type { Sfx } from '../../audio/sfx';
import { MS } from './tokens';
import { showTip } from './Tooltip';

/**
 * [ux-redesign W1] The kit button. One function for every button of the game (DESIGN-SYSTEM.md, "kButton").
 *
 *  - Pressed: scales to --press-scale (0.93) and darkens 10 % in --dur-press (60 ms), springs back in --dur-release (150 ms, out-back).
 *  - The action fires on release INSIDE the button (keyboard Enter / Space too); dragging out cancels it.
 *  - A second press within --debounce (350 ms) is ignored.
 *  - Disabled (`disabledReason`): a press shakes it sideways (--dur-shake), buzzes ('error' haptic + sound) and shows the reason
 *    in a tooltip. It stays focusable (aria-disabled), so a keyboard or screen-reader player can learn why too.
 *  - Loading: ignores presses and shows a spinner (aria-busy). Highlighted: breathes 1.0 <-> 1.04 every 1.8 s (still under reduced motion).
 *  - The hit area is at least --hit-min (48 px) even when the button looks smaller.
 */

export type KButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'icon' | 'close' | 'purchase';

export interface KButtonOptions {
  variant?: KButtonVariant;
  /** Visible text; may hold [[icon]] tokens. Icon-only variants need `ariaLabel` instead. */
  label?: string;
  /** An icon name from icons.ts, drawn before the label. */
  icon?: string;
  onPress: () => void;
  /** Disabled, with the reason the player sees when pressing it anyway. An empty string uses a generic "not available". */
  disabledReason?: string | null;
  /** Accessible name (required for icon / close buttons without a label). */
  ariaLabel?: string;
  /** Extra content after the label (a cost row, a detail line). */
  detail?: HTMLElement;
  /**
   * The skin class(es). Default: the game's classes for the variant (btn-primary, btn-secondary, btn-ghost). Passing one replaces
   * that default (e.g. 'btn-danger', or a dialog's own 'btn-secondary btn-small').
   */
  className?: string;
  /** Haptic 'tap' on press (default true). */
  haptics?: boolean;
  /** A sound on press (default none). */
  sound?: Sfx | null;
  /** Stop the click from reaching the sheet behind (default true, like dom.ts `button`). */
  stopPropagation?: boolean;
}

interface KState {
  onPress: () => void;
  reason: string | null;
  loading: boolean;
  lastFire: number;
}

const STATE = new WeakMap<HTMLButtonElement, KState>();

const SKIN: Record<KButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  tertiary: 'btn-ghost',
  icon: 'btn-ghost',
  close: 'btn-ghost',
  purchase: 'btn-primary',
};

/** True when the pointer that ended this click was released outside the button's hit area (a press dragged out). */
function releasedOutside(b: HTMLButtonElement, e: MouseEvent): boolean {
  if (e.detail === 0) return false; // keyboard or script click: no pointer
  const hit = b.querySelector<HTMLElement>(':scope > .k-hit') ?? b;
  const r = hit.getBoundingClientRect();
  const o = b.getBoundingClientRect();
  const left = Math.min(r.left, o.left), right = Math.max(r.right, o.right);
  const top = Math.min(r.top, o.top), bottom = Math.max(r.bottom, o.bottom);
  return e.clientX < left || e.clientX > right || e.clientY < top || e.clientY > bottom;
}

function deny(b: HTMLButtonElement, reason: string): void {
  b.classList.remove('is-shaking');
  void b.offsetWidth; // restart the shake when pressed again mid-shake
  b.classList.add('is-shaking');
  window.setTimeout(() => b.classList.remove('is-shaking'), MS['dur-shake']);
  haptic('error');
  uiSound('error', 0.5, MS['dur-shake']);
  showTip(b, reason || i18n.t('kit.unavailable'));
}

export function kButton(opts: KButtonOptions): HTMLButtonElement {
  const variant = opts.variant ?? 'primary';
  const b = el('button', `btn k-btn k-btn--${variant} ${opts.className ?? SKIN[variant]}`);
  b.type = 'button';
  const hit = el('span', 'k-hit');
  hit.setAttribute('aria-hidden', 'true');
  b.appendChild(hit);
  if (opts.icon) b.appendChild(el('span', 'k-btn__icon', `[[${opts.icon}]]`));
  if (opts.label !== undefined) b.appendChild(el('span', 'k-btn__label', opts.label));
  if (opts.detail) b.appendChild(opts.detail);
  const spinner = el('span', 'k-btn__spinner');
  spinner.setAttribute('aria-hidden', 'true');
  b.appendChild(spinner);
  if (opts.ariaLabel) b.setAttribute('aria-label', opts.ariaLabel);

  const st: KState = { onPress: opts.onPress, reason: null, loading: false, lastFire: -Infinity };
  STATE.set(b, st);
  setKButtonDisabled(b, opts.disabledReason ?? null);

  // Pressed look follows the pointer: on while it is down and over the button, off when it leaves (that also cancels the action).
  const release = (): void => b.classList.remove('is-pressed');
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || st.loading) return;
    // Touch captures the pointer to the button implicitly: release it so leaving the button is noticed.
    try { if (b.hasPointerCapture(e.pointerId)) b.releasePointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    if (st.reason === null) b.classList.add('is-pressed');
  });
  b.addEventListener('pointerenter', (e) => { if (e.buttons === 1 && st.reason === null && !st.loading) b.classList.add('is-pressed'); });
  b.addEventListener('pointerleave', release);
  b.addEventListener('pointerup', release);
  b.addEventListener('pointercancel', release);

  b.addEventListener('click', (e) => {
    if (opts.stopPropagation !== false) e.stopPropagation();
    if (releasedOutside(b, e) || st.loading) return;
    if (st.reason !== null) {
      deny(b, st.reason);
      return;
    }
    const now = performance.now();
    if (now - st.lastFire < MS.debounce) return;
    st.lastFire = now;
    if (opts.haptics !== false) haptic('tap');
    if (opts.sound) uiSound(opts.sound);
    st.onPress();
  });
  return b;
}

/** Disables the button with a reason (`null` enables it). An empty reason shows the generic "not available". */
export function setKButtonDisabled(b: HTMLButtonElement, reason: string | null): void {
  const st = STATE.get(b);
  if (!st) return;
  st.reason = reason;
  const off = reason !== null;
  b.classList.toggle('is-disabled', off);
  if (off) b.setAttribute('aria-disabled', 'true');
  else b.removeAttribute('aria-disabled');
  if (off) b.classList.remove('is-pressed');
}

/** Shows a spinner and ignores presses until turned off. */
export function setKButtonLoading(b: HTMLButtonElement, on: boolean): void {
  const st = STATE.get(b);
  if (!st) return;
  st.loading = on;
  b.classList.toggle('is-loading', on);
  if (on) b.setAttribute('aria-busy', 'true');
  else b.removeAttribute('aria-busy');
}

/** The "do this next" glow: a slow breathing scale (a static ring under reduced motion). */
export function setKButtonHighlighted(b: HTMLButtonElement, on: boolean): void {
  b.classList.toggle('is-highlighted', on);
}

/** Replaces the label text (keeps icon, detail and state). */
export function setKButtonLabel(b: HTMLButtonElement, label: string): void {
  const node = b.querySelector<HTMLElement>(':scope > .k-btn__label');
  if (node) setRich(node, label);
}

/** True when the button is disabled (by reason). */
export function isKButtonDisabled(b: HTMLButtonElement): boolean {
  return (STATE.get(b)?.reason ?? null) !== null;
}

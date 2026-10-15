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
 *  - A second press within --debounce (350 ms, `debounceMs` to change, 0 to turn off) is ignored.
 *  - Disabled (`disabledReason`): a press shakes it sideways (--dur-shake), buzzes ('error' haptic + sound) and shows the reason
 *    in a tooltip. It stays focusable (aria-disabled), so a keyboard or screen-reader player can learn why too.
 *  - Loading: ignores presses and shows a spinner (aria-busy). Highlighted: breathes 1.0 <-> 1.04 every 1.8 s.
 *  - Reduced motion: the press, shake, spinner and breathing have no movement (tokens at 0 / scale 1); a highlighted button shows a
 *    static amber ring instead, and a disabled press still buzzes and shows its reason.
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
  /** Ignore a second press this soon after the last (ms; default --debounce, 350; 0 turns it off). */
  debounceMs?: number;
}

interface KState {
  reason: string | null;
  loading: boolean;
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
function releasedOutside(b: HTMLElement, e: MouseEvent): boolean {
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

  const st: KState = { reason: null, loading: false };
  STATE.set(b, st);
  setKButtonDisabled(b, opts.disabledReason ?? null);
  bindPress(b, opts.onPress, {
    ...opts,
    state: () => (st.loading ? 'ignore' : st.reason !== null ? 'deny' : 'ok'),
    onDeny: () => deny(b, st.reason ?? ''),
  });
  return b;
}

export interface PressOptions {
  haptics?: boolean;
  sound?: Sfx | null;
  stopPropagation?: boolean;
  debounceMs?: number;
  /** 'ok' fires, 'deny' calls onDeny, 'ignore' does nothing (default always 'ok'). */
  state?: () => 'ok' | 'deny' | 'ignore';
  onDeny?: () => void;
}

/**
 * The press behaviour of every kit control (kButton, pressable kCard / kRow): the `is-pressed` look follows the pointer, the action
 * fires on release inside the hit area (keyboard and script clicks too), a press dragged out is cancelled, and a repeat inside the
 * debounce is ignored.
 */
export function bindPress(target: HTMLElement, onPress: () => void, o: PressOptions = {}): void {
  const state = o.state ?? ((): 'ok' => 'ok');
  const debounce = o.debounceMs ?? MS.debounce;
  let lastFire = -Infinity;
  const release = (): void => target.classList.remove('is-pressed');
  target.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // Touch captures the pointer to the element implicitly: release it so leaving the element is noticed.
    try { if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    if (state() === 'ok') target.classList.add('is-pressed');
  });
  target.addEventListener('pointerenter', (e) => { if (e.buttons === 1 && state() === 'ok') target.classList.add('is-pressed'); });
  target.addEventListener('pointerleave', release);
  target.addEventListener('pointerup', release);
  target.addEventListener('pointercancel', release);
  target.addEventListener('click', (e) => {
    if (o.stopPropagation !== false) e.stopPropagation();
    const s = state();
    if (releasedOutside(target, e) || s === 'ignore') return;
    if (s === 'deny') {
      o.onDeny?.();
      return;
    }
    const now = performance.now();
    if (debounce > 0 && now - lastFire < debounce) return;
    lastFire = now;
    if (o.haptics !== false) haptic('tap');
    if (o.sound) uiSound(o.sound);
    onPress();
  });
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

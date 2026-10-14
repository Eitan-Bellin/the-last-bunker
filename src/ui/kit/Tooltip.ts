import { setRich } from '../dom';
import { MS, LONG_PRESS_SLOP } from './tokens';

/**
 * [ux-redesign W1] Tooltips: one shared bubble (role="tooltip") placed over its anchor.
 *  - `showTip(anchor, text)` shows it now (a disabled kit button explains itself this way) and hides it after --toast-hold
 *    or on the next press anywhere.
 *  - `kTooltip(anchor, text)` binds it: a long press (--long-press, 450 ms) on touch, hover or keyboard focus with a mouse.
 *    The click that ends a long press is swallowed, so holding a button to read it does not also press it.
 */

let bubble: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;
let hideTimer = 0;
let seq = 0;

function ensureBubble(): HTMLDivElement {
  if (bubble?.isConnected) return bubble;
  bubble = document.createElement('div');
  bubble.className = 'k-tooltip';
  bubble.setAttribute('role', 'tooltip');
  bubble.id = `k-tooltip-${++seq}`;
  document.body.appendChild(bubble);
  // Any press elsewhere closes it (capture: before the press does anything else).
  document.addEventListener('pointerdown', (e) => {
    if (owner && !owner.contains(e.target as Node)) hideTip();
  }, true);
  return bubble;
}

/** Puts the bubble above the anchor (below it when there is no room), kept inside the screen. */
function place(anchor: HTMLElement, tip: HTMLElement): void {
  const a = anchor.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(tip).getPropertyValue('--k-tip-gap')) || 0;
  const vw = document.documentElement.clientWidth;
  let top = a.top - t.height - gap;
  if (top < gap) top = a.bottom + gap;
  const left = Math.min(Math.max(gap, a.left + a.width / 2 - t.width / 2), Math.max(gap, vw - t.width - gap));
  tip.style.setProperty('--k-tip-x', `${left}px`);
  tip.style.setProperty('--k-tip-y', `${top}px`);
}

export function showTip(anchor: HTMLElement, text: string, holdMs: number = MS['toast-hold']): void {
  if (!text) return;
  const tip = ensureBubble();
  owner?.removeAttribute('aria-describedby');
  owner = anchor;
  setRich(tip, text);
  anchor.setAttribute('aria-describedby', tip.id);
  tip.classList.add('open');
  place(anchor, tip);
  window.clearTimeout(hideTimer);
  if (holdMs > 0) hideTimer = window.setTimeout(hideTip, holdMs);
}

export function hideTip(): void {
  window.clearTimeout(hideTimer);
  bubble?.classList.remove('open');
  owner?.removeAttribute('aria-describedby');
  owner = null;
}

/** Binds a tooltip to `anchor`. `text` may be a function (read when shown). Returns an unbind function. */
export function kTooltip(anchor: HTMLElement, text: string | (() => string)): () => void {
  const read = (): string => (typeof text === 'function' ? text() : text);
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let fired = false;

  const cancel = (): void => { window.clearTimeout(timer); timer = 0; };
  const onDown = (e: PointerEvent): void => {
    fired = false;
    if (e.pointerType === 'mouse') return; // a mouse has hover
    startX = e.clientX;
    startY = e.clientY;
    cancel();
    timer = window.setTimeout(() => {
      timer = 0;
      fired = true;
      showTip(anchor, read());
    }, MS['long-press']);
  };
  const onMove = (e: PointerEvent): void => {
    if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > LONG_PRESS_SLOP) cancel();
  };
  const onClick = (e: MouseEvent): void => {
    if (!fired) return;
    fired = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  const onEnter = (e: PointerEvent): void => { if (e.pointerType === 'mouse') showTip(anchor, read(), 0); };
  const onLeave = (e: PointerEvent): void => { if (e.pointerType === 'mouse' && owner === anchor) hideTip(); };
  const onFocus = (): void => { if (anchor.matches(':focus-visible')) showTip(anchor, read(), 0); };
  const onBlur = (): void => { if (owner === anchor) hideTip(); };
  const onContext = (e: Event): void => { if (fired || timer) e.preventDefault(); }; // no long-press menu over the bubble

  anchor.addEventListener('pointerdown', onDown);
  anchor.addEventListener('pointermove', onMove);
  anchor.addEventListener('pointerup', cancel);
  anchor.addEventListener('pointercancel', cancel);
  anchor.addEventListener('click', onClick, true);
  anchor.addEventListener('pointerenter', onEnter);
  anchor.addEventListener('pointerleave', onLeave);
  anchor.addEventListener('focus', onFocus);
  anchor.addEventListener('blur', onBlur);
  anchor.addEventListener('contextmenu', onContext);
  return () => {
    cancel();
    anchor.removeEventListener('pointerdown', onDown);
    anchor.removeEventListener('pointermove', onMove);
    anchor.removeEventListener('pointerup', cancel);
    anchor.removeEventListener('pointercancel', cancel);
    anchor.removeEventListener('click', onClick, true);
    anchor.removeEventListener('pointerenter', onEnter);
    anchor.removeEventListener('pointerleave', onLeave);
    anchor.removeEventListener('focus', onFocus);
    anchor.removeEventListener('blur', onBlur);
    anchor.removeEventListener('contextmenu', onContext);
    if (owner === anchor) hideTip();
  };
}

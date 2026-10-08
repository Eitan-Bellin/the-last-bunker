/**
 * [plan4:AC-8/AC-10/AC-11] DOM helpers for keyboard and screen-reader use: focus trapping, `inert`, ARIA tab rows and the live region.
 * Plain DOM, no state of its own besides the live region; every function degrades quietly where a feature is missing.
 */
import { getA11y } from '../utils/a11y';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focusable, visible elements under `root`, in DOM order. */
export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(e => !e.closest('[inert]') && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
}

/**
 * Keeps Tab inside the given scopes (the dialog, and for a sheet also the always-visible navigation): from the last element it goes to
 * the first and back. Call from a keydown listener; does nothing for other keys.
 */
export function trapTab(e: KeyboardEvent, scopes: ParentNode[]): void {
  if (e.key !== 'Tab') return;
  const list = scopes.flatMap(s => focusables(s));
  if (!list.length) { e.preventDefault(); return; }
  const first = list[0], last = list[list.length - 1];
  const at = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (at === first || !at || !list.includes(at))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (at === last || !at || !list.includes(at))) { e.preventDefault(); first.focus(); }
}

/** `inert` where the browser has it (Safari 15.5+, Chrome 102+), `aria-hidden` otherwise: the content behind a dialog leaves the tab order and the screen reader. */
export function setInert(node: Element | null, on: boolean): void {
  if (!node) return;
  if ('inert' in node) (node as HTMLElement).inert = on;
  else node.toggleAttribute('aria-hidden', on);
}

/**
 * Turns a row of buttons (the `.tab-row` of a panel) into an ARIA tab list: roles, `aria-selected` from the `active` class, a roving
 * tabindex and the arrow / Home / End keys (the arrows follow the reading direction, so in Hebrew the left arrow is "next").
 * Choosing a tab re-draws the panel, so the focus is put back on the selected tab of the new row.
 */
export function enhanceTabs(row: HTMLElement, label?: string, panel?: HTMLElement): void {
  row.setAttribute('role', 'tablist');
  if (label) row.setAttribute('aria-label', label);
  const tabs = [...row.querySelectorAll<HTMLElement>('button')];
  let active = tabs.findIndex(t => t.classList.contains('active'));
  if (active < 0) active = 0;
  const stamp = Math.random().toString(36).slice(2, 7);
  tabs.forEach((t, i) => {
    t.setAttribute('role', 'tab');
    t.id = `tab-${stamp}-${i}`;
    t.setAttribute('aria-selected', String(i === active));
    t.tabIndex = i === active ? 0 : -1;
    if (panel) t.setAttribute('aria-controls', panel.id);
  });
  if (panel) {
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabs[active]?.id ?? '');
  }
  row.addEventListener('keydown', e => {
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) return;
    const rtl = getComputedStyle(row).direction === 'rtl';
    let to = tabs.indexOf(document.activeElement as HTMLElement);
    if (to < 0) to = active;
    if (k === 'Home') to = 0;
    else if (k === 'End') to = tabs.length - 1;
    else to = (to + tabs.length + (k === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1)) % tabs.length;
    e.preventDefault();
    const host = row.closest('.sheet-body') ?? document.body;
    tabs[to].click();
    // The click drew a new row (panels re-render): find the selected tab of the new one and focus it.
    (host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? tabs[to]).focus();
  });
}

// ---- Captions (AC-9) ------------------------------------------------------------------------------------------------------------------

let captionEl: HTMLElement | null = null;
let captionTimer = 0;

/** A short line at the bottom of the screen for a sound (an alarm, a warning, a knock), for two seconds. Silent unless the player turned captions on. */
export function showCaption(text: string): void {
  if (!text || !getA11y().captions) return;
  if (!captionEl?.isConnected) {
    captionEl = document.createElement('div');
    captionEl.className = 'a11y-caption';
    captionEl.setAttribute('aria-hidden', 'true'); // the sound's meaning reaches a screen reader through the toast / announcement
    captionEl.appendChild(document.createElement('span'));
    document.body.appendChild(captionEl);
  }
  captionEl.firstElementChild!.textContent = text;
  // (a frame between removing and adding the class lets a repeated caption fade in again)
  captionEl.classList.add('on');
  window.clearTimeout(captionTimer);
  captionTimer = window.setTimeout(() => captionEl?.classList.remove('on'), 2000);
}

// ---- Live region ----------------------------------------------------------------------------------------------------------------------

let polite: HTMLElement | null = null;
let assertive: HTMLElement | null = null;
let flip = false;

function region(kind: 'polite' | 'assertive'): HTMLElement {
  const cur = kind === 'polite' ? polite : assertive;
  if (cur?.isConnected) return cur;
  const n = document.createElement('div');
  n.className = 'sr-only';
  n.id = `a11y-live-${kind}`;
  n.setAttribute('role', kind === 'polite' ? 'status' : 'alert');
  n.setAttribute('aria-live', kind);
  n.setAttribute('aria-atomic', 'true');
  document.body.appendChild(n);
  if (kind === 'polite') polite = n; else assertive = n;
  return n;
}

/**
 * Says something to a screen reader (only when the player turned announcements on: `settings.a11y.announce`). It is for the important
 * things that otherwise only the picture shows: a fire starting, a raid warning, a room finished. The same sentence twice in a row still
 * speaks (a trailing no-break space flips the text).
 */
export function announce(text: string, kind: 'polite' | 'assertive' = 'polite'): void {
  if (!text || !getA11y().announce) return;
  const n = region(kind);
  flip = !flip;
  n.textContent = flip ? text : `${text} `;
}

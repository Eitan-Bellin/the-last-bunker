/**
 * [plan4:UX-6, UX-7] Two small viewport behaviours for phones, started once by the HUD:
 *
 *  1. The on-screen keyboard. iOS Safari does not resize the layout viewport when the keyboard opens (it only shrinks the *visual*
 *     viewport), so a bottom sheet with a text field keeps its field under the keys. `--kb-inset` is how many px the keyboard
 *     covers (the CSS lifts the sheet by it) and the focused field is scrolled into view. When the keyboard closes iOS can leave
 *     the page scrolled; the page itself never scrolls (html/body are overflow:hidden), so it is put back at 0,0.
 *  2. Landscape on a phone. The game is designed for portrait. On a touch device whose height is under 500 px in landscape a card
 *     asks to turn the phone upright, with a "continue anyway" button that remembers the choice for this session; the compact
 *     landscape layout itself is plain CSS (touch.css: the resources in a column on the left, the nav in a column on the right).
 *     The card is shown by CSS only while the media query matches and the player has not dismissed it, so rotating needs no JS.
 */
import { i18n } from '../i18n/I18nManager';
import { el } from './dom';
import { haptic } from '../utils/haptics';

let started = false;

/** True for the text-entry elements the keyboard belongs to (a button or slider does not open it). */
function isTextField(t: EventTarget | null): t is HTMLElement {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement) return true;
  if (!(t instanceof HTMLInputElement)) return false;
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image'].includes(t.type);
}

function initKeyboardInset(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let kb = 0;
  const update = (): void => {
    // The part of the layout viewport the visual viewport no longer covers at the bottom = the keyboard (a pinch-zoom shrinks it
    // too, but then offsetTop/scale are not 1 and the inset is meaningless, so it is ignored while zoomed).
    const zoomed = Math.abs(vv.scale - 1) > 0.01;
    const next = zoomed ? 0 : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    // Under ~80 px it is a browser toolbar sliding, not a keyboard.
    const v = next > 80 ? next : 0;
    if (v === kb) return;
    const closed = kb > 0 && v === 0;
    kb = v;
    root.style.setProperty('--kb-inset', `${v}px`);
    if (closed) window.scrollTo(0, 0);
    else if (v > 0) scrollFocusedIntoView();
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  document.addEventListener('focusin', (e) => {
    // The keyboard animates in after focus: look again once it is up.
    if (isTextField(e.target)) window.setTimeout(() => { update(); scrollFocusedIntoView(); }, 300);
  });
  root.style.setProperty('--kb-inset', '0px');
}

function scrollFocusedIntoView(): void {
  const a = document.activeElement;
  if (!isTextField(a)) return;
  try { a.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }); } catch { /* old engines: no options */ }
}

/** The "turn your phone upright" card. Built once, shown/hidden by CSS (see touch.css `.rotate-card`). */
function initRotateCard(): void {
  const card = el('div', 'rotate-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  const fill = (): void => {
    card.textContent = '';
    const keep = el('button', 'btn btn-primary', i18n.t('orient.continue'));
    keep.addEventListener('click', () => {
      haptic('tap');
      document.documentElement.dataset.rotateOk = '1';
    });
    card.append(el('div', 'rotate-icon', '⟳'), el('div', 'rotate-title', i18n.t('orient.title')), el('div', 'rotate-text', i18n.t('orient.hint')), keep);
    card.setAttribute('aria-label', i18n.t('orient.title'));
  };
  fill();
  document.body.appendChild(card);
  // The text is read when it is needed, so a language change is picked up the next time the card appears.
  try {
    window.matchMedia('(pointer: coarse) and (orientation: landscape) and (max-height: 499px)').addEventListener('change', (e) => { if (e.matches) fill(); });
  } catch { /* no matchMedia events: the card keeps the text it was built with */ }
}

export function initViewportUi(): void {
  if (started) return;
  started = true;
  initKeyboardInset();
  initRotateCard();
}

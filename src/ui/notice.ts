import { i18n } from '../i18n/I18nManager';
import { el, setRich } from './dom';
import { relaxedMs } from '../utils/a11y';

/** One notice: something new to know about, never something that has to be decided now. */
export interface Notice {
  icon: string;
  title: string;
  /** One or two lines; longer text is clipped (the action opens the full version). */
  body?: string;
  /** The main action ("Read", "Show me"); the card always has a close plate too. */
  action?: { label: string; onClick: () => void };
}

const SHOW_MS = 12_000;

/**
 * [plan5:UX-B] A card above the navigation console for news that used to take over the screen as a dialog: a new system, a find, a
 * district that broke through, the "what's new" card. The game keeps running, taps go through everywhere else, and the card leaves
 * by itself after a while. One at a time: the dialog queue holds the next one back while a card is up (see `isShowing`).
 */
export class NoticeCards {
  private card: HTMLElement | null = null;
  private timer = 0;
  /** Played when a card comes up (set by the app). */
  onShow: (() => void) | null = null;

  get isShowing(): boolean {
    return !!this.card;
  }

  show(n: Notice): void {
    this.hide(true);
    const card = el('div', 'notice-card');
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    const icon = el('span', 'notice-icon');
    setRich(icon, n.icon);
    const text = el('div', 'notice-text');
    const title = el('div', 'notice-title');
    setRich(title, n.title);
    text.appendChild(title);
    if (n.body) {
      const body = el('div', 'notice-body');
      setRich(body, n.body);
      text.appendChild(body);
    }
    card.append(icon, text);
    if (n.action) {
      const act = el('button', 'btn btn-primary notice-btn');
      setRich(act, n.action.label);
      const go = n.action.onClick;
      act.addEventListener('click', () => { this.hide(); go(); });
      card.appendChild(act);
    }
    const close = el('button', 'notice-close', '[[close]]');
    close.setAttribute('aria-label', i18n.t('journal.close'));
    close.addEventListener('click', () => this.hide());
    card.appendChild(close);
    document.body.appendChild(card);
    this.card = card;
    requestAnimationFrame(() => card.classList.add('in'));
    this.onShow?.();
    this.timer = window.setTimeout(() => this.hide(), relaxedMs(SHOW_MS));
  }

  hide(now = false): void {
    window.clearTimeout(this.timer);
    const card = this.card;
    this.card = null;
    if (!card) return;
    if (now) { card.remove(); return; }
    card.classList.remove('in');
    window.setTimeout(() => card.remove(), 300);
  }
}

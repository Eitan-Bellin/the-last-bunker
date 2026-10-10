import { i18n } from '../../i18n/I18nManager';
import { button, el, setRich } from '../dom';
import { Sheet } from './Sheet';
import type { ActivityLog } from '../activity';

/** One shortcut tile at the top of the sheet: a place in the game that has something for the player. */
export interface ActivityShortcut {
  icon: string;
  label: string;
  /** Short status ("2/3", "3 days"); a badge when `alert` is set. */
  meta?: string;
  alert?: boolean;
  onClick: () => void;
}

/**
 * [plan5:UX-F] "What happened": the activity feed (newest first, repeats folded into "×n") under a row of shortcuts to the places
 * that used to live as separate chips in the status row (daily orders, the supply crate, the inbox, the journal, the season).
 * Opening it marks the feed as seen.
 */
export class ActivitySheet {
  private sheet = new Sheet('activity-sheet');
  private unsub: (() => void) | null = null;
  private since = 0;
  /** What was drawn last: the sheet is rebuilt only when this changes (a rebuild would reset the scroll under the player's finger). */
  private signature = '';
  /** Set by the app each time the sheet opens or the feed changes. */
  shortcuts: () => ActivityShortcut[] = () => [];

  private log: ActivityLog;

  constructor(log: ActivityLog) {
    this.log = log;
    this.sheet.onClose = () => {
      this.unsub?.();
      this.unsub = null;
      this.log.markSeen();
    };
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  show(): void {
    this.since = this.log.lastSeen;
    this.signature = '';
    this.render();
    this.sheet.show();
    this.unsub?.();
    this.unsub = this.log.subscribe(() => this.render());
    this.log.markSeen();
  }

  hide(): void {
    this.sheet.hide();
  }

  /** Re-draws the shortcuts (their counts change while the sheet is open). */
  refresh(): void {
    if (this.isVisible) this.render();
  }

  private render(): void {
    const tiles = this.shortcuts();
    const top = this.log.entries[0];
    const sig = `${i18n.currentLocale}|${tiles.map(t => `${t.label}:${t.meta ?? ''}:${t.alert ? 1 : 0}`).join(',')}|${this.log.entries.length}|${top ? `${top.key}:${top.count}:${top.last}` : ''}|${Math.floor(Date.now() / 60_000)}`;
    if (sig === this.signature) return;
    this.signature = sig;
    this.sheet.setTitle(`[[bell]] ${i18n.t('activity.title')}`);
    const root = el('div', 'activity');
    if (tiles.length) {
      const row = el('div', 'activity-shortcuts');
      for (const t of tiles) {
        const b = button('', `activity-tile ${t.alert ? 'alert' : ''}`, () => { this.hide(); t.onClick(); });
        b.append(el('span', 'activity-tile-icon', t.icon), el('span', 'activity-tile-label', t.label));
        if (t.meta) {
          const meta = el('span', 'activity-tile-meta', t.meta);
          meta.dir = 'auto';
          b.appendChild(meta);
        }
        row.appendChild(b);
      }
      root.appendChild(row);
    }
    const list = el('ul', 'activity-list');
    const now = Date.now();
    for (const e of this.log.entries) {
      const li = el('li', `activity-item ${e.kind} ${e.last > this.since ? 'new' : ''}`);
      const text = el('span', 'activity-text');
      setRich(text, e.text);
      li.appendChild(text);
      if (e.count > 1 && !e.digest) li.appendChild(el('span', 'activity-count', `×${e.count}`));
      li.appendChild(el('span', 'activity-time', this.ago(now - e.last)));
      list.appendChild(li);
    }
    if (!this.log.entries.length) root.appendChild(el('p', 'activity-empty', i18n.t('activity.empty')));
    else root.appendChild(list);
    this.sheet.body.replaceChildren(root);
  }

  private ago(ms: number): string {
    const min = Math.floor(ms / 60_000);
    if (min < 1) return i18n.t('activity.now');
    return i18n.t('activity.ago', { t: i18n.formatDuration(min * 60) });
  }
}

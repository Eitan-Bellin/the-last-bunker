import type { GameState } from '../../core/GameState';
import type { ChronicleEntry } from '../../core/state/longGame';
import { i18n } from '../../i18n/I18nManager';
import { ACTS } from '../../data/acts';
import { ERAS } from '../../data/eras';
import { ENDINGS } from '../../data/endings';
import { getProject } from '../../data/projects';
import { RESEARCH } from '../../data/research';
import { LAWS } from '../../data/laws';
import { getChapter } from '../../data/story';
import { Sheet } from './Sheet';
import { el } from '../dom';

/**
 * [Q14] The Chronicle: the run's milestones in order, newest first, grouped by run (Genesis starts a new one). A look back at what
 * the bunker went through, and the place where earlier timelines stay readable.
 */
export class ChroniclePanel {
  private sheet = new Sheet('chronicle-sheet');
  private sig = '';

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  hide(): void {
    this.sheet.hide();
  }

  show(state: GameState): void {
    this.sig = '';
    this.refresh(state);
    this.sheet.show();
  }

  refresh(state: GameState): void {
    const list = state.longGame?.chronicle ?? [];
    const sig = `${list.length}|${i18n.currentLocale}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.render(state, list);
  }

  /** The icon and sentence for one entry. */
  private describe(e: ChronicleEntry): { icon: string; text: string } {
    const locale = i18n.currentLocale;
    switch (e.k) {
      case 'act': return { icon: '[[flag]]', text: i18n.t('chronicle.act', { name: ACTS[(e.n ?? 1) - 1]?.name[locale] ?? String(e.n) }) };
      case 'era': return { icon: '[[sun]]', text: i18n.t('chronicle.era', { name: ERAS[e.n ?? 0]?.name[locale] ?? String(e.n) }) };
      case 'project': return { icon: '[[build]]', text: i18n.t('chronicle.project', { name: getProject(e.id)?.name[locale] ?? e.id ?? '' }) };
      case 'chapter': return { icon: '[[journal]]', text: i18n.t('chronicle.chapter', { name: getChapter(e.id ?? '')?.title[locale] ?? e.id ?? '' }) };
      case 'doctrine': return { icon: '[[books]]', text: i18n.t('chronicle.doctrine', { name: RESEARCH.find(r => r.id === e.id)?.name[locale] ?? e.id ?? '' }) };
      case 'law': return { icon: '[[books]]', text: i18n.t('chronicle.law', { name: LAWS.find(l => l.id === e.id)?.name[locale] ?? e.id ?? '' }) };
      case 'ending': return { icon: '[[trophy]]', text: i18n.t('chronicle.ending', { name: ENDINGS.find(x => x.id === e.id)?.name[locale] ?? e.id ?? '' }) };
      case 'floor': return { icon: '[[pick]]', text: i18n.t('chronicle.floor', { n: (e.n ?? 0) + 1 }) };
      case 'outpost': return { icon: '[[surface]]', text: i18n.t('chronicle.outpost', { n: e.n ?? 1 }) };
      case 'raidLost': return { icon: '[[skull]]', text: i18n.t('chronicle.raidLost') };
      case 'death': return { icon: '[[skull]]', text: i18n.t('chronicle.death', { name: e.id ?? '' }) };
      case 'genesis': return { icon: '[[isotope7]]', text: i18n.t('chronicle.genesis', { n: e.n ?? 0 }) };
      default: return { icon: '[[star]]', text: e.k };
    }
  }

  private render(state: GameState, list: ChronicleEntry[]): void {
    this.sheet.setTitle(`[[journal]] ${i18n.t('chronicle.title')}`);
    const root = el('div', 'chronicle');
    const now = state.longGame?.meta.worldT ?? 0;
    root.appendChild(el('p', 'bp-hint', i18n.t('chronicle.intro', { days: Math.floor(now / 86400) + 1, n: list.length })));
    if (list.length === 0) {
      root.appendChild(el('p', 'inbox-empty', i18n.t('chronicle.empty')));
    }
    // Newest first, with a heading where a run begins.
    const runs = [...new Set(list.map(e => e.run))].sort((a, b) => b - a);
    for (const run of runs) {
      const card = el('div', 'bp-card');
      if (runs.length > 1) card.appendChild(el('div', 'bp-section-title', i18n.t('chronicle.run', { n: run + 1 })));
      for (const e of list.filter(x => x.run === run).reverse()) {
        const d = this.describe(e);
        const row = el('div', 'chronicle-row');
        row.append(el('span', 'chronicle-day', i18n.t('chronicle.day', { n: Math.floor(e.t / 86400) + 1 })), el('span', 'chronicle-icon', d.icon), el('span', 'chronicle-text', d.text));
        card.appendChild(row);
      }
      root.appendChild(card);
    }
    this.sheet.body.replaceChildren(root);
  }
}

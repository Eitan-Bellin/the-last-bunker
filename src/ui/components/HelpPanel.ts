import { i18n } from '../../i18n/I18nManager';
import { lazyChunk } from '../../utils/lazy';
import type { GameState } from '../../core/GameState';
import { BUILDING_DEFS, isInfra } from '../../data/buildingDefs';
import { ENDINGS } from '../../data/endings';
import { SCENARIOS, scenarioUnlocked } from '../../data/scenarios';
import { Sheet } from './Sheet';
import { BUILDING_ICONS, el } from '../dom';

/** Plan 4 wave 3 (perf): the book's text is its own chunk (about 10 KB gzipped), fetched when the book is first opened (or when the page is idle after start). */
const loadBook = lazyChunk(() => import('../../data/book'));
type Book = typeof import('../../data/book');
type Entry = Book['BOOK'][number];

/** [ux-wp6] Per-viewer memory of the highest Act the book was read in, for the "new" marks (a convenience: losing it changes nothing). */
const SEEN_KEY = 'lastbunker_book_act';
const readSeen = (): number => {
  try { return Number(localStorage.getItem(SEEN_KEY)) || 1; } catch { return 1; }
};
const writeSeen = (act: number): void => {
  try { localStorage.setItem(SEEN_KEY, String(act)); } catch { /* storage unavailable: no "new" marks next time */ }
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/**
 * [Q6] The Bunker Book: the game's own words in two or three sentences each, grouped, searchable. Opened from the Menu, from
 * the "?" plate on any sheet (at that sheet's topic), and from the new-system card at the start of an Act.
 * [ux-wp6] It opens with the game: entries of a later Act are a locked line (late-game names are not shown at all), entries
 * opened since the last read are marked new, the ending entry counts the endings reached, and "Your rooms" explains every
 * room type the bunker already has.
 */
export class HelpPanel {
  private sheet = new Sheet('help-sheet');
  private entries = new Map<string, HTMLDetailsElement>();
  private book: Book | null = null;
  private getState: () => GameState | null;

  constructor(getState: () => GameState | null = () => null) {
    this.getState = getState;
    this.sheet.onClose = () => undefined;
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  hide(): void {
    this.sheet.hide();
  }

  /** Opens the book; `topic` is an entry id or a panel name (see HELP_TOPICS). */
  show(topic?: string): void {
    if (this.book) { this.open(this.book, topic); return; }
    // First use: the chunk is normally already there (fetched when the page went idle); otherwise this waits for it.
    loadBook().then(book => { this.book = book; this.open(book, topic); }).catch(() => undefined);
  }

  private open(book: Book, topic?: string): void {
    const id = topic ? (book.getBookEntry(topic) ? topic : book.HELP_TOPICS[topic]) : undefined;
    this.render(book, id);
    this.sheet.show();
    const target = id ? this.entries.get(id) : undefined;
    if (target) {
      target.open = true;
      requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  }

  private render(book: Book, focus?: string): void {
    const { BOOK, BOOK_GROUPS, bookEntryOpen } = book;
    const locale = i18n.currentLocale;
    const state = this.getState();
    const act = state?.longGame?.meta.act ?? 1;
    // Someone on a second run (or later) has seen the whole game once: nothing is held back.
    const veteran = !state || (state.prestige?.rebirthCount ?? 0) > 0 || (state.longGame?.meta.runIndex ?? 0) > 0;
    const seen = readSeen();
    this.sheet.setTitle(`[[question]] ${i18n.t('book.title')}`);
    this.entries.clear();
    const root = el('div', 'book');
    const search = el('input', 'book-search');
    search.type = 'search';
    search.placeholder = i18n.t('book.search');
    search.setAttribute('aria-label', i18n.t('book.search'));
    root.appendChild(search);
    // [ux-wp6: mid/late M8] The endings this player has reached, over every run.
    const reached = state ? endingsReached(state) : new Set<string>();
    root.appendChild(el('div', 'bp-hint', `[[trophy]] ${i18n.t('wp6.book.endings', { n: reached.size, total: ENDINGS.length })}`));

    const groups: { box: HTMLElement; items: { node: HTMLElement; hay: string }[]; locked: HTMLElement[] }[] = [];
    for (const g of BOOK_GROUPS) {
      const box = el('div', 'book-group');
      box.appendChild(el('div', 'bp-section-title', `${g.icon} ${g.name[locale]}`));
      const items: { node: HTMLElement; hay: string }[] = [];
      const locked: HTMLElement[] = [];
      let hidden = 0;
      const list: Entry[] = g.id === 'rooms' ? (state ? roomEntries(state) : []) : BOOK.filter(x => x.group === g.id);
      if (g.id === 'rooms') {
        if (!list.length) continue;
        box.appendChild(el('p', 'bp-hint', i18n.t('wp6.book.roomsHint')));
      }
      for (const e of list) {
        const open = bookEntryOpen(e, act, veteran) || e.id === focus;
        if (!open) {
          if (e.spoiler) { hidden++; continue; }
          const line = el('div', 'book-entry book-locked', `[[lock]] ${e.title[locale]} · ${i18n.t('wp6.book.locked', { n: ROMAN[(e.act ?? 1) - 1] ?? String(e.act) })}`);
          line.style.opacity = '0.55';
          line.style.padding = '6px 0';
          box.appendChild(line);
          locked.push(line);
          continue;
        }
        const d = el('details', 'book-entry');
        const sum = el('summary', 'book-title', `${e.icon} ${e.title[locale]}`);
        if (!veteran && e.act && e.act > seen && e.act <= act) sum.appendChild(el('span', 'bp-hint', ` [[sparkle]] ${i18n.t('wp6.book.new')}`));
        d.append(sum, el('p', 'book-text', e.text[locale]));
        const extra = state ? this.extraLines(e.id, state, reached) : [];
        for (const line of extra) d.appendChild(el('p', 'bp-hint', line));
        box.appendChild(d);
        this.entries.set(e.id, d);
        items.push({ node: d, hay: `${e.title[locale]} ${e.text[locale]} ${extra.join(' ')}`.toLowerCase() });
      }
      if (hidden > 0) {
        const more = el('div', 'bp-hint book-more', `[[lock]] ${i18n.t('wp6.book.more', { n: hidden })}`);
        box.appendChild(more);
        locked.push(more);
      }
      groups.push({ box, items, locked });
      root.appendChild(box);
    }
    if (act > seen) writeSeen(act);
    const empty = el('p', 'bp-hint book-empty', i18n.t('book.none'));
    empty.style.display = 'none';
    root.appendChild(empty);
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (const g of groups) {
        let any = false;
        for (const it of g.items) {
          const hit = !q || it.hay.includes(q);
          it.node.style.display = hit ? '' : 'none';
          if (hit) { any = true; shown++; }
          if (q && hit) (it.node as HTMLDetailsElement).open = true;
        }
        for (const l of g.locked) l.style.display = q ? 'none' : '';
        g.box.style.display = any || (!q && g.locked.length) ? '' : 'none';
      }
      empty.style.display = shown === 0 ? '' : 'none';
    });
    this.sheet.body.replaceChildren(root);
  }

  /** Lines read from the save under some entries: the endings reached and still open, and the sites for the next run. */
  private extraLines(id: string, state: GameState, reached: Set<string>): string[] {
    const locale = i18n.currentLocale;
    if (id === 'ending') {
      const lines = reached.size ? [] : [i18n.t('wp6.book.endingsNone')];
      for (const e of ENDINGS) {
        lines.push(reached.has(e.id)
          ? i18n.t('wp6.book.endingGot', { name: e.name[locale] })
          : i18n.t('wp6.book.endingOpen', { name: e.name[locale], drivers: e.drivers[locale] }));
      }
      return lines;
    }
    if (id === 'nextWorld') {
      // [ux-wp6: mid/late M8] The sites the next run could start on, with their rules, before the Genesis button is pressed.
      const open = SCENARIOS.filter(s => scenarioUnlocked(state, s.id));
      const lines = [i18n.t('wp6.book.sites'), ...open.map(s => `${s.icon} ${s.name[locale]}: ${s.tagline[locale]} · ${s.rules[locale]}`)];
      if (open.length < SCENARIOS.length) lines.push(i18n.t('wp6.book.sitesLater'));
      return lines;
    }
    return [];
  }
}

/** Every ending this player reached: the bunkers left behind as homes remember theirs, and this run's own once it is told. */
function endingsReached(state: GameState): Set<string> {
  const out = new Set<string>();
  for (const h of state.longGame?.meta.homes ?? []) if (h.ending) out.add(h.ending);
  const now = state.storyFlags.find(f => f.startsWith('ending:'));
  if (now) out.add(now.slice(7));
  return out;
}

/** [ux-wp6] One entry per room type the bunker already has (ruins too), written from the room's own data. */
function roomEntries(state: GameState): Entry[] {
  const wrecked = (state.ruins ?? []).map(r => r.restoresTo).filter((t): t is NonNullable<typeof t> => !!t);
  const types = [...new Set([...state.buildings.map(b => b.type), ...wrecked])].filter(t => BUILDING_DEFS[t] && !isInfra(t));
  const out: Entry[] = [];
  for (const type of types) {
    const def = BUILDING_DEFS[type];
    const locale = i18n.currentLocale;
    const parts: string[] = [def.description[locale] ?? def.description.en ?? ''];
    parts.push(def.maxWorkers > 0 ? i18n.t('wp6.book.room.workers', { n: def.maxWorkers }) : i18n.t('wp6.book.room.noWorkers'));
    if (def.optimalStat && def.maxWorkers > 0) parts.push(i18n.t('wp6.book.room.stat', { stat: `[[${def.optimalStat}]] ${i18n.t(`stats.${def.optimalStat}`)}` }));
    if (def.powerConsumption > 0) parts.push(i18n.t('wp6.book.room.power', { n: def.powerConsumption }));
    parts.push(i18n.t('wp6.book.room.levels', { n: def.maxLevel }));
    const line = parts.filter(Boolean).join(' · ');
    const text = { he: line, en: line };
    out.push({
      id: `room:${type}`, icon: BUILDING_ICONS[type] ?? '[[build]]', group: 'rooms',
      title: { he: def.name.he ?? def.name.en, en: def.name.en ?? def.name.he },
      text,
    });
  }
  const locale = i18n.currentLocale;
  return out.sort((a, b) => a.title[locale].localeCompare(b.title[locale], locale));
}

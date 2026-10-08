import { i18n } from '../../i18n/I18nManager';
import { lazyChunk } from '../../utils/lazy';
import { Sheet } from './Sheet';
import { el } from '../dom';

/** Plan 4 wave 3 (perf): the book's text is its own chunk (about 10 KB gzipped), fetched when the book is first opened (or when the page is idle after start). */
const loadBook = lazyChunk(() => import('../../data/book'));
type Book = typeof import('../../data/book');

/**
 * [Q6] The Bunker Book: the game's own words in two or three sentences each, grouped, searchable. Opened from the Menu, from
 * the "?" plate on any sheet (at that sheet's topic), and from the new-system card at the start of an Act.
 */
export class HelpPanel {
  private sheet = new Sheet('help-sheet');
  private entries = new Map<string, HTMLDetailsElement>();
  private book: Book | null = null;

  constructor() {
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
    this.render(book);
    this.sheet.show();
    const id = topic ? (book.getBookEntry(topic) ? topic : book.HELP_TOPICS[topic]) : undefined;
    const target = id ? this.entries.get(id) : undefined;
    if (target) {
      target.open = true;
      requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  }

  private render({ BOOK, BOOK_GROUPS }: Book): void {
    const locale = i18n.currentLocale;
    this.sheet.setTitle(`[[question]] ${i18n.t('book.title')}`);
    this.entries.clear();
    const root = el('div', 'book');
    const search = el('input', 'book-search');
    search.type = 'search';
    search.placeholder = i18n.t('book.search');
    search.setAttribute('aria-label', i18n.t('book.search'));
    root.appendChild(search);
    const groups: { box: HTMLElement; items: { node: HTMLElement; hay: string }[] }[] = [];
    for (const g of BOOK_GROUPS) {
      const box = el('div', 'book-group');
      box.appendChild(el('div', 'bp-section-title', `${g.icon} ${g.name[locale]}`));
      const items: { node: HTMLElement; hay: string }[] = [];
      for (const e of BOOK.filter(x => x.group === g.id)) {
        const d = el('details', 'book-entry');
        const sum = el('summary', 'book-title', `${e.icon} ${e.title[locale]}`);
        d.append(sum, el('p', 'book-text', e.text[locale]));
        box.appendChild(d);
        this.entries.set(e.id, d);
        items.push({ node: d, hay: `${e.title[locale]} ${e.text[locale]}`.toLowerCase() });
      }
      groups.push({ box, items });
      root.appendChild(box);
    }
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
        g.box.style.display = any ? '' : 'none';
      }
      empty.style.display = shown === 0 ? '' : 'none';
    });
    this.sheet.body.replaceChildren(root);
  }
}

import type { GameState } from '../../core/GameState';
import { i18n } from '../../i18n/I18nManager';
import { LORE, getLore, type LoreEntry, type LoreKind } from '../../data/lore';
import { getDef } from '../../data/buildingDefs';
import { Sheet } from './Sheet';
import { button, el } from '../dom';
import { CHAPTERS, CHARACTERS, type CharacterId } from '../../data/story';
// [Economy A2] credits shop tab
import { ShopPanel } from './ShopPanel';
import type { ShopSystem } from '../../systems/ShopSystem';
import type { ShopItemId } from '../../data/shop';

const KIND_ICON: Record<LoreKind, string> = {
  note: '[[note]]', log: '[[journal]]', tape: '[[tape]]', photo: '[[eye]]', letter: '[[note]]',
};

/** The residents' story collected so far: notes, logs, tapes, photos and letters. */
export class JournalPanel {
  private sheet = new Sheet('journal-sheet');
  private signature = '';

  onRead: ((id: string) => void) | null = null;
  onReplay: ((chapterId: string) => void) | null = null;
  private tab: 'finds' | 'story' | 'shop' = 'finds';
  private shopPanel = new ShopPanel();
  /** Set by the app: lets the shop tab read offers and buy. */
  shop: ShopSystem | null = null;
  onBuy: ((id: ShopItemId) => void) | null = null;

  /** Opens the journal straight on the shop tab (welcome-back "to the shop" button). */
  showShop(state: GameState): void {
    this.tab = 'shop';
    this.show(state);
  }

  show(state: GameState): void {
    this.signature = '';
    this.refresh(state);
    this.sheet.show();
  }

  hide(): void {
    this.sheet.hide();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  refresh(state: GameState): void {
    const sig = `${state.lore.join(',')}|${(state.loreUnread ?? []).join(',')}|${i18n.currentLocale}|${this.tab}|${state.storyFlags.length}|${this.tab === 'shop' ? this.shopPanel.signature(state) : ''}`;
    if (sig === this.signature) return;
    this.signature = sig;
    const locale = i18n.currentLocale;
    this.sheet.setTitle(`[[journal]] ${i18n.t('journal.title')} · ${state.lore.length}/${LORE.length}`);
    const root = el('div', 'journal');
    const tabs = el('div', 'tab-row');
    const told = CHAPTERS.filter(c => state.storyFlags.includes(`story:${c.id}`)).length;
    for (const [key, label] of [['finds', `[[note]] ${i18n.t('journal.finds')}`], ['story', `[[flag]] ${i18n.t('story.tab')} ${told}/${CHAPTERS.length}`], ['shop', `[[credits]] ${i18n.t('shop.tab')}`]] as const) {
      tabs.appendChild(button(label, `tab-btn ${this.tab === key ? 'active' : ''}`, () => {
        this.tab = key;
        this.signature = '';
        this.refresh(state);
      }));
    }
    root.appendChild(tabs);
    if (this.tab === 'shop' && this.shop) {
      this.shopPanel.onBuy = id => this.onBuy?.(id);
      root.appendChild(this.shopPanel.render(state, this.shop));
      this.sheet.body.replaceChildren(root);
      return;
    }
    if (this.tab === 'story') {
      root.appendChild(this.renderStory(state));
      this.sheet.body.replaceChildren(root);
      return;
    }
    root.appendChild(el('p', 'bp-hint', i18n.t('journal.intro')));
    if (state.lore.length === 0) root.appendChild(el('div', 'journal-empty', `[[broom]] ${i18n.t('journal.empty')}`));
    for (const id of state.lore) {
      const e = getLore(id);
      if (!e) continue;
      const unread = state.loreUnread?.includes(id);
      const item = el('button', `journal-item kind-${e.kind} ${unread ? 'unread' : ''}`);
      item.append(
        el('span', 'journal-icon', KIND_ICON[e.kind]),
        el('span', 'journal-title', e.title[locale]),
        el('span', 'journal-meta', `${e.author[locale]} · ${e.date[locale]}`),
      );
      if (unread) item.appendChild(el('span', 'journal-new', i18n.t('journal.new')));
      item.addEventListener('click', () => this.onRead?.(id));
      root.appendChild(item);
    }
    const missing = LORE.length - state.lore.length;
    if (missing > 0) root.appendChild(el('div', 'journal-missing', `[[question]] ${i18n.t('journal.missing', { n: missing })}`));
    this.sheet.body.replaceChildren(root);
  }

  /** Chapters told so far (tap to replay) and the people met along the way. */
  private renderStory(state: GameState): HTMLElement {
    const locale = i18n.currentLocale;
    const box = el('div', 'story-codex');
    const met = new Set<CharacterId>();
    for (const c of CHAPTERS) {
      const done = state.storyFlags.includes(`story:${c.id}`);
      if (done) for (const l of c.lines) if (l.who !== 'narrator') met.add(l.who);
      const item = el('button', `journal-item story-item ${done ? '' : 'locked'}`);
      item.append(
        el('span', 'journal-icon', done ? '[[flag]]' : '[[lock]]'),
        el('span', 'journal-title', `${i18n.t('story.chapter', { n: c.number })} · ${done ? c.title[locale] : '???'}`),
      );
      const choice = c.choices?.find(ch => state.storyFlags.includes(`choice:${c.id}:${ch.key}`));
      if (choice) item.appendChild(el('span', 'journal-meta', `[[chat]] ${choice.label[locale]}`));
      if (done) item.addEventListener('click', () => this.onReplay?.(c.id));
      else item.disabled = true;
      box.appendChild(item);
    }
    if (met.size) {
      box.appendChild(el('div', 'bp-section-title', `[[people]] ${i18n.t('story.characters')}`));
      const grid = el('div', 'char-grid');
      for (const id of met) {
        const ch = CHARACTERS[id];
        const card = el('div', 'char-card');
        if (ch.portrait) {
          const img = el('img', 'char-face');
          img.src = `${import.meta.env.BASE_URL}art/portraits/${ch.portrait}.webp`;
          img.alt = '';
          card.appendChild(img);
        }
        const name = el('div', 'char-name', ch.name[locale]);
        name.style.color = ch.color;
        card.append(name, el('div', 'char-role', ch.role[locale]));
        grid.appendChild(card);
      }
      box.appendChild(grid);
    }
    return box;
  }
}

/** Full-screen reader that dresses each find as what it is: paper, tape transcript or photo. */
export class LoreReader {
  private overlay = el('div', 'lore-overlay');
  private typing = 0;
  onClose: (() => void) | null = null;

  constructor() {
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
    document.body.appendChild(this.overlay);
  }

  get isVisible(): boolean {
    return this.overlay.classList.contains('open');
  }

  show(entry: LoreEntry): void {
    const locale = i18n.currentLocale;
    window.clearInterval(this.typing);
    const card = el('div', `lore-card kind-${entry.kind}`);
    if (entry.kind === 'tape') {
      const deck = el('div', 'tape-deck');
      deck.append(el('span', 'tape-reel'), el('span', 'tape-window'), el('span', 'tape-reel'));
      card.appendChild(deck);
    }
    card.appendChild(el('div', 'lore-kind', `${KIND_ICON[entry.kind]} ${i18n.t(`journal.kind.${entry.kind}`)}`));
    card.appendChild(el('h2', 'lore-title', entry.title[locale]));
    card.appendChild(el('div', 'lore-author', `${entry.author[locale]} · ${entry.date[locale]}`));
    const body = el('p', 'lore-body');
    card.appendChild(body);
    if (entry.bonus) {
      const def = getDef(entry.bonus.type);
      card.appendChild(el('div', 'lore-bonus', `[[intelligence]] ${i18n.t('journal.bonus', { pct: entry.bonus.pct, name: def?.name[locale] ?? '' })}`));
    }
    const close = el('button', 'btn btn-primary lore-close', i18n.t('journal.close'));
    close.addEventListener('click', () => this.hide());
    card.appendChild(close);
    this.overlay.replaceChildren(card);
    this.overlay.classList.add('open');

    const text = entry.body[locale];
    if (entry.kind === 'tape') {
      // Tapes play back: the transcript types itself out.
      let i = 0;
      body.textContent = '';
      this.typing = window.setInterval(() => {
        i = Math.min(text.length, i + 2);
        body.textContent = text.slice(0, i);
        if (i >= text.length) window.clearInterval(this.typing);
      }, 28);
      card.addEventListener('click', () => {
        window.clearInterval(this.typing);
        body.textContent = text;
      }, { once: true });
    } else {
      body.textContent = text;
    }
  }

  hide(): void {
    window.clearInterval(this.typing);
    this.overlay.classList.remove('open');
    this.onClose?.();
  }
}

import { i18n } from '../../i18n/I18nManager';
import type { GameState } from '../../core/GameState';
import type { GameApp } from '../../app';
import { RESEARCH } from '../../data/research';
import { lawSlots } from '../../data/laws';
import { seasonsActive } from '../../data/seasons';
import { actOf } from '../../data/acts';
import { getProject } from '../../data/projects';
import type { SpotKey } from '../HUD';
import { el } from '../dom';

/** One system a run meets along the way: a card says what it is, once, and the button to use it glows for a moment. */
interface SystemCard {
  id: string;
  icon: string;
  /** Holds once the system is available in this run. */
  ready: (s: GameState, app: GameApp) => boolean;
  /** The HUD button to highlight. */
  spot: SpotKey;
  /** The Bunker Book entry the "show me" button opens. */
  book: string;
  /** Extra values for the card's text. */
  params?: (s: GameState) => Record<string, string>;
  title?: string;
  body?: string;
}

const act = (s: GameState) => s.longGame?.meta.act ?? 0;
const tier2 = (id: string, from: number, resource: string): SystemCard => ({
  id: `cur:${id}`, icon: '[[alloys]]', ready: s => act(s) >= from, spot: 'build', book: 'tier2',
  params: () => ({ name: i18n.t(`resources.${resource}`) }), title: 'sys.currency.title', body: 'sys.currency.body',
});

/**
 * [Q7] "A new system" cards. The Acts open their systems one at a time (never more than two together): when one becomes
 * available a short card says what it is and where it lives, the button glows for a few seconds, and the Bunker Book has the
 * long version. Each card shows once per save (flag `sys:<id>`, kept across Genesis).
 */
const CARDS: SystemCard[] = [
  {
    // [ux-wp1 F5] The tutorial is over: from here the Act leads. Says what Act I asks for and where the guide lives.
    id: 'act1', icon: '[[flag]]', spot: 'era', book: 'act', title: 'wp1.act1.title', body: 'wp1.act1.body',
    ready: (s, app) => act(s) === 1 && app.engine.objectiveSystem.tutorialDone(s),
    params: s => {
      const a = actOf(s);
      const locale = i18n.currentLocale;
      const charter = a.charter.map(id => getProject(id)?.name[locale]).filter((n): n is string => !!n);
      return { act: a.name[locale], goals: [...a.goals.map(g => g.text[locale]), ...charter].join(' · ') };
    },
  },
  { id: 'inbox', icon: '[[inbox]]', ready: s => act(s) >= 2, spot: 'inbox', book: 'inbox' },
  { id: 'foreman', icon: '[[worker]]', ready: s => act(s) >= 2, spot: 'era', book: 'foreman' },
  { id: 'contracts', icon: '[[cart]]', ready: (_s, app) => app.engine.contractSystem.active(app.state), spot: 'inbox', book: 'contracts' },
  { id: 'seasons', icon: '[[clover]]', ready: s => seasonsActive(s), spot: 'season', book: 'seasons' },
  {
    id: 'doctrines', icon: '[[books]]', spot: 'research', book: 'doctrine',
    ready: (s, app) => act(s) >= 2 && RESEARCH.some(r => r.fork && app.engine.researchSystem.status(s, r.id) === 'available'),
  },
  { id: 'outposts', icon: '[[surface]]', ready: s => act(s) >= 3, spot: 'surface', book: 'outposts' },
  { id: 'laws', icon: '[[books]]', ready: s => lawSlots(s) > 0, spot: 'era', book: 'laws' },
  tier2('alloys', 4, 'alloys'),
  tier2('data', 5, 'data'),
  tier2('influence', 6, 'influence'),
  tier2('seedCores', 7, 'seedCores'),
];

/** Minimum play seconds between two cards ([phase2] between two news cards; the Act's own card lists everything at once). */
const CARD_GAP = 120;

/** [phase2] Set once the Act's "what opens" card was shown (or the Act was already under way when this arrived). */
const actFlag = (s: GameState) => `sys:act${act(s)}`;

/**
 * [phase2] Never a chain of "new system" dialogs: at most ONE card per Act transition, listing everything that opened ("New in Act II:
 * Decisions, Foreman, Doctrines"). A system that opens later in the same Act is a news card (non-blocking, hides by itself, "Show me").
 */
export class SystemsController {
  private app: GameApp;
  private lastShown = -Infinity;
  private initDone = false;

  constructor(app: GameApp) {
    this.app = app;
  }

  /** [plan4:UX-10] The cards that are due now. Shows nothing; flags only what an older save already knew. */
  private dueAll(state: GameState): SystemCard[] {
    if (!state.longGame || !state.storyFlags.includes('intro:done')) return [];
    if (!this.initDone) {
      this.initDone = true;
      // A game that was already past these systems when this feature arrived has seen them: mark, don't show.
      if (!state.storyFlags.includes('sys:init')) {
        const known = CARDS.filter(c => c.ready(state, this.app)).map(c => `sys:${c.id}`);
        this.flag(['sys:init', ...known]);
        return [];
      }
      // [phase2] A save loaded in the middle of an Act (nothing owed now) had its Act card: later systems of this Act come as news.
      const owed = CARDS.some(c => !state.storyFlags.includes(`sys:${c.id}`) && c.ready(state, this.app));
      if (!owed && (act(state) > 1 || this.app.engine.objectiveSystem.tutorialDone(state)) && !state.storyFlags.includes(actFlag(state))) this.flag([actFlag(state)]);
    }
    const flags = this.app.state.storyFlags;
    return CARDS.filter(c => !flags.includes(`sys:${c.id}`) && c.ready(state, this.app));
  }

  /** [phase2] The Act's card is owed: something opened and this Act has not had its card yet (for the dialog queue). */
  hasDue(state: GameState): boolean {
    return !state.storyFlags.includes(actFlag(state)) && this.dueAll(state).length > 0;
  }

  /** Title of the card due now, for the "N waiting" line. */
  dueTitle(state: GameState): string {
    const due = this.dueAll(state);
    if (due.length > 1) return i18n.t('p2p.sys.actTitle', { act: actOf(state).name[i18n.currentLocale] });
    const card = due[0];
    return card ? i18n.t(card.title ?? `sys.${card.id}.title`, card.params?.(state) ?? {}) : '';
  }

  /** Called by the dialog queue while no dialog is open: the Act's one card, listing everything that opened. */
  update(state: GameState): void {
    const due = this.dueAll(state);
    if (!due.length) return;
    this.lastShown = state.stats.totalPlayTime;
    this.flag([actFlag(state), ...due.map(c => `sys:${c.id}`)]);
    if (due.length === 1) this.show(due[0], state);
    else this.showMany(due, state);
  }

  /**
   * [phase2] Called a few times a second (inbox.refresh): a system that opened after this Act's card is told as a news card, one at a
   * time, CARD_GAP apart. "Show me" guides to where it lives; "Tell me more" opens its Bunker Book page.
   */
  offerNews(state: GameState): void {
    if (!state.storyFlags.includes(actFlag(state))) return;
    if (state.stats.totalPlayTime - this.lastShown < CARD_GAP) return;
    const card = this.dueAll(state)[0];
    if (!card) return;
    this.lastShown = state.stats.totalPlayTime;
    this.flag([`sys:${card.id}`]);
    const params = card.params?.(state) ?? {};
    const title = i18n.t(card.title ?? `sys.${card.id}.title`, params);
    this.app.tips.pushNews({
      key: `sys:${card.id}`, icon: card.icon, text: title,
      // Hid unanswered: it stays in the bell as a line ("Show me" from there).
      onTimeout: () => this.app.inbox.keepNews({ key: `sys:${card.id}`, icon: card.icon, title, open: () => this.goTo(card) }),
      actions: [
        { label: i18n.t('sys.more'), onPress: () => this.app.openBook(card.book) },
        { label: i18n.t('p2p.sys.show'), primary: true, onPress: () => this.goTo(card) },
      ],
    });
  }

  private flag(add: string[]): void {
    this.app.engine.stateManager.applyDelta({ path: 'storyFlags', value: [...new Set([...this.app.state.storyFlags, ...add])] });
  }

  /** Once per player a guided tap on where it lives; [w3fix] one highlight only: the HUD's own short glow otherwise. */
  private goTo(card: SystemCard): void {
    if (!this.app.onboarding.guideTo(card.spot, card.id)) this.app.hud.spotlight(card.spot);
  }

  private show(card: SystemCard, state: GameState): void {
    const params = card.params?.(state) ?? {};
    this.app.audio.play('paper');
    this.app.modal.show({
      icon: card.icon,
      title: i18n.t(card.title ?? `sys.${card.id}.title`, params),
      body: i18n.t(card.body ?? `sys.${card.id}.body`, params),
      actions: [
        {
          label: i18n.t('sys.ok'), className: 'btn-primary', onClick: () => {
            this.app.modal.hide();
            // [ux-redesign W3a] Once per player a guided tap on where it lives.
            this.goTo(card);
          },
        },
        { label: i18n.t('sys.more'), className: 'btn-secondary', onClick: () => { this.app.modal.hide(); this.app.openBook(card.book); } },
      ],
    });
  }

  /** [phase2] One card for everything this Act opened: a line each (name and what it does); "Got it" guides to the first one. */
  private showMany(cards: SystemCard[], state: GameState): void {
    const locale = i18n.currentLocale;
    const short = (c: SystemCard) => (c.id.startsWith('cur:') ? i18n.t(c.title ?? '', c.params?.(state) ?? {}) : i18n.t(`p2p.sys.short.${c.id}`));
    const body = el('div', 'dq-fold');
    body.appendChild(el('p', 'modal-body', i18n.t('p2p.sys.actBody', { list: cards.map(short).join(' · ') })));
    const ul = el('ul', 'dq-list');
    for (const c of cards) ul.appendChild(el('li', '', `${c.icon} ${i18n.t(c.body ?? `sys.${c.id}.body`, c.params?.(state) ?? {})}`));
    body.appendChild(ul);
    this.app.audio.play('paper');
    this.app.modal.show({
      icon: '[[flag]]',
      title: i18n.t('p2p.sys.actTitle', { act: actOf(state).name[locale] }),
      body,
      actions: [
        { label: i18n.t('sys.ok'), className: 'btn-primary', onClick: () => { this.app.modal.hide(); this.goTo(cards[0]); } },
        { label: i18n.t('sys.more'), className: 'btn-secondary', onClick: () => { this.app.modal.hide(); this.app.openBook(cards[0].book); } },
      ],
      dismiss: 0,
    });
  }
}

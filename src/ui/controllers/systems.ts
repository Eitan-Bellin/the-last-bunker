import { i18n } from '../../i18n/I18nManager';
import type { GameState } from '../../core/GameState';
import type { GameApp } from '../../app';
import { RESEARCH } from '../../data/research';
import { lawSlots } from '../../data/laws';
import { seasonsActive } from '../../data/seasons';
import type { SpotKey } from '../HUD';

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

/** Minimum play seconds between two cards. */
const CARD_GAP = 120;

export class SystemsController {
  private app: GameApp;
  private lastShown = -Infinity;
  private initDone = false;

  constructor(app: GameApp) {
    this.app = app;
  }

  /** Called while no dialog is open. Shows at most one card, and only when the last one is a while ago. */
  update(state: GameState): void {
    if (!state.longGame || !state.storyFlags.includes('intro:done')) return;
    const flags = state.storyFlags;
    if (!this.initDone) {
      this.initDone = true;
      // A game that was already past these systems when this feature arrived has seen them: mark, don't show.
      if (!flags.includes('sys:init')) {
        const known = CARDS.filter(c => c.ready(state, this.app)).map(c => `sys:${c.id}`);
        this.flag(state, ['sys:init', ...known]);
        return;
      }
    }
    const now = state.stats.totalPlayTime;
    if (now - this.lastShown < CARD_GAP) return;
    const card = CARDS.find(c => !flags.includes(`sys:${c.id}`) && c.ready(state, this.app));
    if (!card) return;
    this.lastShown = now;
    this.flag(state, [`sys:${card.id}`]);
    this.show(card, state);
  }

  private flag(state: GameState, add: string[]): void {
    this.app.engine.stateManager.applyDelta({ path: 'storyFlags', value: [...new Set([...state.storyFlags, ...add])] });
  }

  private show(card: SystemCard, state: GameState): void {
    const params = card.params?.(state) ?? {};
    this.app.audio.play('paper');
    this.app.modal.show({
      icon: card.icon,
      title: i18n.t(card.title ?? `sys.${card.id}.title`, params),
      body: i18n.t(card.body ?? `sys.${card.id}.body`, params),
      actions: [
        { label: i18n.t('sys.ok'), className: 'btn-primary', onClick: () => { this.app.modal.hide(); this.app.hud.spotlight(card.spot); } },
        { label: i18n.t('sys.more'), className: 'btn-secondary', onClick: () => { this.app.modal.hide(); this.app.openBook(card.book); } },
      ],
    });
  }
}

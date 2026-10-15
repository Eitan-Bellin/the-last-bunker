import { i18n } from '../../i18n/I18nManager';
import type { GameState } from '../../core/GameState';
import type { GameApp } from '../../app';
import { wingsAvailable } from './tips';

/** Set by migrateState on a save older than v7: the card is owed. */
export const WHATSNEW_OWED = 'whatsnew:v7';
/** Set once the card was shown. */
export const WHATSNEW_SEEN = 'whatsnew:wings';
/** Never in the guided first half hour (play seconds). */
const AFTER_PLAY_S = 1800;

/**
 * [plan4:ST-9] The one-time "what's new" card for a save that came over from v6: the bunker can now grow sideways and upward.
 * [phase2] A news card (was the dialog queue's lowest source), only once the player is in Act II or later,
 * the wings are available and the first half hour is over. "Show me" opens the Command panel at its wing line.
 * A new game never owes it (no `whatsnew:v7` flag), so only migrated saves see it, once.
 */
export class WhatsNewController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  /** The card is due now (for the dialog queue; no side effects). */
  hasDue(state: GameState): boolean {
    const flags = state.storyFlags;
    if (!flags.includes(WHATSNEW_OWED) || flags.includes(WHATSNEW_SEEN)) return false;
    if ((state.longGame?.meta.act ?? 1) < 2 || !wingsAvailable(state)) return false;
    return state.stats.totalPlayTime >= AFTER_PLAY_S;
  }

  /**
   * Shows the card and marks it seen (a card that was shown once is never owed again). [phase2] A news card now (non-blocking, hides by
   * itself), never a dialog in a chain: "Show me" opens the Command panel at its wing line. Called a few times a second (inbox.refresh).
   */
  offer(state: GameState): void {
    if (!this.hasDue(state)) return;
    this.app.engine.stateManager.applyDelta({ path: 'storyFlags', value: [...new Set([...state.storyFlags, WHATSNEW_SEEN])] });
    this.app.tips.pushNews({
      key: 'whatsnew:wings', icon: '[[build]]',
      text: i18n.t('p2p.whatsnew.wings'),
      onTimeout: () => this.app.inbox.keepNews({ key: 'whatsnew:wings', icon: '[[build]]', title: i18n.t('p2p.whatsnew.wings'), open: () => this.app.showWingLine() }),
      actions: [
        { label: i18n.t('sys.ok'), onPress: () => undefined },
        { label: i18n.t('whatsnew.wings.show'), primary: true, onPress: () => this.app.showWingLine() },
      ],
    });
  }

  label(): string {
    return i18n.t('whatsnew.wings.title');
  }
}

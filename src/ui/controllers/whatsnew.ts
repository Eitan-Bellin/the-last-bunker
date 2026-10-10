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
 * It is a source of the dialog queue (lowest priority: everything else goes first), only once the player is in Act II or later,
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

  /** Opens the card and marks it seen (a card that was shown once is never owed again). */
  open(state: GameState): void {
    this.app.engine.stateManager.applyDelta({ path: 'storyFlags', value: [...new Set([...state.storyFlags, WHATSNEW_SEEN])] });
    this.app.audio.play('paper');
    // [plan5:UX-B] A card above the console, not a dialog.
    this.app.toasts.log(`[[build]] ${i18n.t('whatsnew.wings.title')}`, 'info', 'whatsnew');
    this.app.notice.show({
      icon: '[[build]]',
      title: i18n.t('whatsnew.wings.title'),
      body: i18n.t('whatsnew.wings.body'),
      action: { label: i18n.t('whatsnew.wings.show'), onClick: () => this.app.showWingLine() },
    });
  }

  label(): string {
    return i18n.t('whatsnew.wings.title');
  }
}

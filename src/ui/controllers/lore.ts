import { i18n } from '../../i18n/I18nManager';
import { getLore } from '../../data/lore';
import type { GameApp } from '../../app';

/** Finds from the previous residents: the "found" news cards ([phase2], were dialogs) and the reader. */
export class LoreController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  /**
   * Finds wait their turn so two discoveries never fight over the same spot. [phase2] A find is a news card now ("Found: <title>",
   * Read now / Later) that hides by itself; it is never a dialog of its own. An unread find stays in the journal (and the bell's finds line).
   */
  queueLore(id: string): void {
    const entry = getLore(id);
    if (!entry) return;
    if (!this.told.includes(id)) this.told.push(id);
    const locale = i18n.currentLocale;
    this.app.tips.pushNews({
      key: `lore:${id}`,
      icon: entry.kind === 'tape' ? '[[tape]]' : entry.kind === 'photo' ? '[[eye]]' : '[[note]]',
      text: `${i18n.t('journal.found')} ${entry.title[locale]} · ${entry.author[locale]}`,
      actions: [
        { label: i18n.t('journal.later'), onPress: () => undefined },
        { label: i18n.t('journal.readNow'), primary: true, onPress: () => this.readLore(id) },
      ],
      // [ux-redesign final F4] A find the player already read (from the journal, or the tutorial's "read the note" step) needs no card.
      valid: () => !!this.app.state?.loreUnread?.includes(id),
      sound: 'lore',
    });
  }

  /** [phase2] Finds told this session (newest last). */
  private told: string[] = [];

  /** [phase2] Finds told this session and still unread, newest first (the bell's finds line). */
  sessionUnread(): string[] {
    const unread = this.app.state?.loreUnread ?? [];
    return this.told.filter(id => unread.includes(id)).reverse();
  }

  readLore(id: string): void {
    const entry = getLore(id);
    if (!entry) return;
    this.app.storyOpen = true;
    this.app.audio.play(entry.kind === 'tape' ? 'tape' : 'paper');
    this.app.engine.restorationSystem.markRead(id);
    this.app.engine.requestSave();
    this.app.loreReader.onClose = () => {
      this.app.storyOpen = false;
      this.app.journal.refresh(this.app.state);
    };
    this.app.loreReader.show(entry);
    this.reserveText(entry.body[i18n.currentLocale]);
  }

  /**
   * [ux-redesign w2a #18] A tape types itself out: the page keeps the height of the whole transcript from the start, so the Close button
   * never slides away under a finger (a tap on the card still finishes the typing at once).
   */
  private reserveText(text: string): void {
    const body = document.querySelector<HTMLElement>('.lore-overlay.open .lore-body');
    if (!body || !body.parentElement) return;
    const probe = body.cloneNode(false) as HTMLElement;
    probe.textContent = text;
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;inline-size:${body.clientWidth}px`;
    body.parentElement.appendChild(probe);
    body.style.minBlockSize = `${probe.offsetHeight}px`;
    probe.remove();
  }
}

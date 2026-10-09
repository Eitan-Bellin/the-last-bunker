import { i18n } from '../../i18n/I18nManager';
import { getLore } from '../../data/lore';
import type { GameApp } from '../../app';

/** Finds from the previous residents: queued "found" dialogs and the reader. */
export class LoreController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  /** Finds wait their turn so two discoveries never fight over the same dialog. */
  loreQueue: string[] = [];

  queueLore(id: string): void {
    // [ux] Until the B1 note is found (the first three tasks and the farm's own find as it completes), a find goes to the journal quietly:
    // no dialog over the work. The B1 note itself is that task's goal and still opens.
    if ((this.app.state.tutorialStep ?? 0) < 4 && id !== 'welcome') {
      this.app.toasts.show(`[[note]] ${i18n.t('journal.foundQuiet')}`, 'info');
      return;
    }
    if (!this.loreQueue.includes(id)) this.loreQueue.push(id);
  }

  /** [plan4:UX-10] A find is waiting for its dialog (the dialog queue asks, then calls flushLoreQueue when the gate is open). */
  get hasQueued(): boolean {
    return this.loreQueue.length > 0;
  }

  /** Shows the next queued find once nothing else is on screen. */
  flushLoreQueue(): void {
    if (!this.loreQueue.length || this.app.modal.isVisible || this.app.storyOpen || this.app.introPlaying || this.app.loreReader.isVisible) return;
    if (document.querySelector('.era-banner')) return;
    this.showLoreFound(this.loreQueue.shift()!);
  }

  /** "You found something": offers to read a newly found note, log or tape. */
  showLoreFound(id: string): void {
    const entry = getLore(id);
    if (!entry) return;
    this.app.audio.play('lore');
    const locale = i18n.currentLocale;
    this.app.storyOpen = true;
    this.app.modal.show({
      icon: entry.kind === 'tape' ? '[[tape]]' : entry.kind === 'photo' ? '[[eye]]' : '[[note]]',
      title: i18n.t('journal.found'),
      body: `${entry.title[locale]} · ${entry.author[locale]}`,
      actions: [
        { label: i18n.t('journal.readNow'), className: 'btn-primary', onClick: () => { this.app.modal.hide(); this.readLore(id); } },
        { label: i18n.t('journal.later'), className: 'btn-secondary', onClick: () => { this.app.modal.hide(); this.app.storyOpen = false; } },
      ],
    });
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
  }
}

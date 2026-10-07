import { i18n } from '../../i18n/I18nManager';
import { bus } from '../../core/EventBus';
import { el } from '../../ui/dom';
import type { BackupInfo, BackupKind } from '../../core/SaveManager';
import { hideSplash } from '../../ui/splash';
import type { GameApp } from '../../app';
import { shareFile } from '../../utils/platform'; // [plan4:UX-16]
import { markExported } from '../../ui/pwa';
import { lastSaveWasInterrupted } from '../../core/saveFlag';

/** Saving and the save menu: new game, Genesis, import/export, backups, and save problems at start. */
export class SaveController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  confirmNewGame(): void {
    this.app.modal.show({
      icon: '[[warning]]',
      title: i18n.t('settings.newGame'),
      body: i18n.t('settings.newGameConfirm'),
      actions: [
        {
          label: i18n.t('settings.newGameYes'),
          className: 'btn-danger',
          onClick: async () => {
            this.app.modal.hide();
            await this.app.engine.newGame();
            this.app.toasts.show(i18n.t('settings.newGameDone'), 'good');
            this.app.story.playIntroSequence();
          },
        },
        { label: i18n.t('placement.cancel'), className: 'btn-secondary', onClick: () => this.app.modal.hide() },
      ],
    });
  }

  confirmRebirth(): void {
    const gain = this.app.engine.metaSystem.rebirthGain(this.app.state);
    this.app.modal.show({
      icon: '[[isotope7]]',
      title: i18n.t('genesis.confirmTitle'),
      body: i18n.t('genesis.confirmBody', { n: gain }),
      actions: [
        {
          label: i18n.t('genesis.confirmYes'),
          className: 'btn-primary',
          onClick: async () => {
            this.app.modal.hide();
            await this.app.engine.rebirth();
            this.app.audio.play('achievement');
            this.app.toasts.show(`[[isotope7]] ${i18n.t('genesis.done', { n: gain })}`, 'good');
          },
        },
        { label: i18n.t('placement.cancel'), className: 'btn-secondary', onClick: () => this.app.modal.hide() },
      ],
    });
  }

  /** An import replaces the running game, so it is checked first and then confirmed (the current game is kept as a backup). */
  importSave(raw: string): void {
    if (!this.app.engine.saveManager.importSave(raw)) {
      this.app.toasts.show(i18n.t('settings.importBad'), 'bad');
      this.app.audio.play('error');
      return;
    }
    this.app.modal.show({
      icon: '[[save]]',
      title: i18n.t('settings.import'),
      body: i18n.t('settings.importConfirm'),
      actions: [
        {
          label: i18n.t('settings.importYes'),
          className: 'btn-danger',
          onClick: async () => {
            this.app.modal.hide();
            const ok = await this.app.engine.importState(raw);
            this.app.toasts.show(ok ? i18n.t('settings.importOk') : i18n.t('settings.importBad'), ok ? 'good' : 'bad');
            if (!ok) this.app.audio.play('error');
            this.app.menuPanel.loadBackups();
          },
        },
        { label: i18n.t('placement.cancel'), className: 'btn-secondary', onClick: () => this.app.modal.hide() },
      ],
    });
  }

  confirmRestore(kind: BackupKind): void {
    void this.app.engine.saveManager.listBackups().then((list: BackupInfo[]) => {
      const info = list.find(b => b.kind === kind);
      if (!info) return;
      const locale = i18n.currentLocale === 'he' ? 'he-IL' : 'en-GB';
      const when = new Date(info.timestamp).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
      this.app.modal.show({
        icon: '[[refresh]]',
        title: i18n.t('settings.backups'),
        body: i18n.t('settings.backups.confirm', { time: when }),
        actions: [
          {
            label: i18n.t('settings.backups.restore'),
            className: 'btn-danger',
            onClick: async () => {
              this.app.modal.hide();
              const ok = await this.app.engine.restoreBackup(kind);
              this.app.toasts.show(ok ? i18n.t('settings.backups.done') : i18n.t('settings.importBad'), ok ? 'good' : 'bad');
              this.app.menuPanel.loadBackups();
            },
          },
          { label: i18n.t('placement.cancel'), className: 'btn-secondary', onClick: () => this.app.modal.hide() },
        ],
      });
    });
  }

  /**
   * Writes the save to a file the player keeps outside the browser's storage.
   * [plan4:UX-16] On a phone the system share sheet ("Save to Files", AirDrop, Mail) is the reliable way: a download link does nothing
   * useful in a home-screen app. Where there is no share sheet (a laptop) it is a plain download, and if even that is impossible the
   * code is shown in a box to copy (no more window.prompt, which was English only).
   */
  async exportFile(): Promise<void> {
    const data = this.app.engine.exportState();
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const name = `last-bunker-save-${stamp}.txt`;
    const shared = await shareFile(new File([data], name, { type: 'text/plain' }), i18n.t('settings.exportShareTitle'));
    if (shared === 'cancelled') return;
    if (shared === 'unsupported') {
      try {
        const url = URL.createObjectURL(new Blob([data], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch {
        this.showCopyCode(data);
        return;
      }
    }
    markExported();
    this.app.toasts.show(i18n.t('settings.exportedFile'), 'good');
  }

  /** The save as text in a box the player can select and copy by hand (and a Copy button where the clipboard works). */
  showCopyCode(raw: string, titleKey = 'save.copy.title', onClose?: () => void): void {
    const box = el('div', 'copy-code-wrap');
    box.appendChild(el('p', 'modal-body', i18n.t('save.copy.body')));
    const area = el('textarea', 'copy-code');
    area.readOnly = true;
    area.value = raw;
    area.setAttribute('aria-label', i18n.t(titleKey));
    area.addEventListener('focus', () => area.select());
    box.appendChild(area);
    this.app.modal.show({
      icon: '[[save]]',
      title: i18n.t(titleKey),
      body: box,
      actions: [
        {
          label: i18n.t('save.copy.button'),
          className: 'btn-primary',
          onClick: () => {
            area.focus();
            area.select();
            area.setSelectionRange(0, raw.length); // iOS needs the explicit range
            const done = () => { markExported(); this.app.toasts.show(i18n.t('settings.copied'), 'good'); };
            if (navigator.clipboard?.writeText) navigator.clipboard.writeText(raw).then(done, () => undefined);
            else if (document.execCommand?.('copy')) done();
          },
        },
        { label: i18n.t('save.copy.close'), className: 'btn-secondary', onClick: () => { this.app.modal.hide(); onClose?.(); } },
      ],
    });
  }

  importFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,text/plain';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then(text => this.importSave(text)).catch(() => this.app.toasts.show(i18n.t('settings.importBad'), 'bad'));
    });
    input.click();
  }

  /** The save could not be used at start. Nothing has been written over it; the player decides what happens next. */
  resolveLoadProblem(): Promise<void> {
    hideSplash();
    const problem = this.app.engine.loadProblem;
    return new Promise<void>(resolve => {
      const retry = { label: i18n.t('save.problem.retry'), className: 'btn-primary', onClick: () => location.reload() };
      if (problem === 'error') {
        this.app.modal.show({
          icon: '[[warning]]',
          title: i18n.t('save.problem.error.title'),
          body: i18n.t('save.problem.error.body'),
          actions: [
            retry,
            {
              label: i18n.t('save.problem.noSave'),
              className: 'btn-secondary',
              onClick: () => {
                this.app.modal.hide();
                this.unsavedReminder();
                resolve();
              },
            },
          ],
        });
        return;
      }
      // [plan4:UX-16] A function, so the copy box can come back to this dialog when it is closed (the player still has to choose).
      const showCorrupt = (): void => this.app.modal.show({
        icon: '[[warning]]',
        title: i18n.t('save.problem.corrupt.title'),
        body: i18n.t('save.problem.corrupt.body'),
        actions: [
          retry,
          {
            label: i18n.t('save.problem.copy'),
            className: 'btn-secondary',
            onClick: () => {
              void this.app.engine.saveManager.corruptCopy().then(raw => {
                if (raw && navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(raw).then(() => this.app.toasts.show(i18n.t('save.problem.copied'), 'good'), () => this.showCopyCode(raw, 'save.copy.title', showCorrupt));
                } else if (raw) this.showCopyCode(raw, 'save.copy.title', showCorrupt);
              });
            },
          },
          {
            label: i18n.t('save.problem.newGame'),
            className: 'btn-secondary',
            onClick: () => {
              this.app.modal.hide();
              this.app.engine.allowSaving();
              resolve();
            },
          },
        ],
      });
      showCorrupt();
    });
  }

  /** The main save was unreadable and a backup took its place: say so. */
  noticeRecovered(): Promise<void> {
    hideSplash();
    const kind = this.app.engine.recoveredFrom ?? 'session';
    const locale = i18n.currentLocale === 'he' ? 'he-IL' : 'en-GB';
    const when = new Date(this.app.engine.recoveredAt ?? Date.now()).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
    return new Promise<void>(resolve => {
      this.app.modal.show({
        icon: '[[save]]',
        title: i18n.t('save.recovered.title'),
        body: i18n.t('save.recovered.body', { kind: i18n.t(`save.kind.${kind}`), time: when }),
        actions: [{ label: i18n.t('event.ok'), onClick: () => { this.app.modal.hide(); resolve(); } }],
      });
    });
  }

  /** Playing without saving (the player chose it): a reminder every few minutes, so it is never forgotten. */
  unsavedReminder(): void {
    this.app.toasts.show(`[[warning]] ${i18n.t('save.problem.unsaved')}`, 'critical');
    window.setInterval(() => {
      if (this.app.engine.saveBlocked && !document.hidden) this.app.toasts.show(`[[warning]] ${i18n.t('save.problem.unsaved')}`, 'critical');
    }, 5 * 60_000);
  }

  watchSaving(): void {
    bus.on('save:failed', () => this.app.toasts.show(`[[warning]] ${i18n.t('save.failed')}`, 'critical'));
    bus.on('save:recovered', () => this.app.toasts.show(`[[save]] ${i18n.t('save.recoveredOk')}`, 'good'));
    bus.on('save:superseded', () => this.showSuperseded());
    // [plan4:UX-16] The last session asked for a save that never reached storage (the phone froze or closed the page): say so, once.
    if (lastSaveWasInterrupted()) window.setTimeout(() => this.app.toasts.show(`[[warning]] ${i18n.t('save.lostMoments')}`, 'bad'), 3500);
  }

  /** The game was opened in another window after this one: this one stops saving, so it cannot overwrite the newer progress. */
  showSuperseded(): void {
    if (document.querySelector('.save-lock')) return;
    this.app.engine.saveBlocked = true;
    this.app.engine.paused = true;
    const box = el('div', 'save-lock');
    const use = el('button', 'btn btn-primary', i18n.t('save.superseded.use'));
    use.addEventListener('click', () => location.reload());
    box.append(el('h2', '', i18n.t('save.superseded.title')), el('p', '', i18n.t('save.superseded.body')), use);
    box.setAttribute('role', 'alertdialog');
    document.body.appendChild(box);
  }
}

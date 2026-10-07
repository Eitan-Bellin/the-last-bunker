import type { GameState } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { ACHIEVEMENTS } from '../../data/achievements';
import { PRESTIGE_UPGRADES, upgradeCost } from '../../data/prestige';
import { ERAS } from '../../data/eras';
import type { MetaSystem } from '../../systems/MetaSystem';
import { Sheet } from './Sheet';
import { button, el } from '../dom';
import { uiSound } from '../../audio/uiSound';
import type { BackupInfo, BackupKind } from '../../core/SaveManager';
import { getA11y, setA11y } from '../../utils/a11y';
import { haptic } from '../../utils/haptics';
import { enhanceTabs } from '../a11yDom';

export type MenuTab = 'settings' | 'a11y' | 'stats' | 'achievements' | 'genesis';

/** Genesis checklist (research, survivors, era): shown wherever the rebirth button or its lock appears. */
export function genesisRequirements(state: GameState, meta: MetaSystem): HTMLElement {
  const box = el('div', 'genesis-reqs');
  const reqs = meta.rebirthRequirements(state);
  const ready = reqs.every(r => r.met);
  box.appendChild(el('div', 'bp-section-title', ready ? `[[check]] ${i18n.t('genesis.ready')}` : `[[lock]] ${i18n.t('genesis.locked')}`));
  for (const r of reqs) {
    const vars: Record<string, string | number> = { current: r.current, target: r.target };
    if (r.key === 'genesis.reqEra') vars.name = ERAS[r.target]?.name[i18n.currentLocale] ?? String(r.target);
    box.appendChild(el('div', `genesis-req ${r.met ? 'met' : ''}`, `${r.met ? '[[check]]' : '[[lock]]'} ${i18n.t(r.key, vars)}`));
  }
  return box;
}

export interface MenuActions {
  toggleLanguage: () => void;
  toggleSound: () => void;
  isSoundOn: () => boolean;
  newGame: () => void;
  rebirth: () => void;
  importSave: (raw: string) => void;
  /** Graphics quality: current label and cycling to the next setting. */
  graphics: () => string;
  cycleGraphics: () => void;
  /** Screen brightness: current label and cycling to the next level. */
  brightness: () => string;
  cycleBrightness: () => void;
  /** Puts the crash/diagnostics report on the clipboard. */
  copyDiagnostics: () => void;
  /** Notifications (S6): current label, and turning them on (asks the system) or off. */
  notifications: () => string;
  toggleNotifications: () => Promise<void>;
  /** Saves to a file / imports from a file (the player's own copy, outside the browser's storage). */
  exportFile: () => void;
  importFile: () => void;
  /** The automatic backups that exist, and putting one back (the app asks for confirmation first). */
  listBackups: () => Promise<BackupInfo[]>;
  restoreBackup: (kind: BackupKind) => void;
  /** Music and effects volume, 0..1. */
  getLevels: () => { music: number; fx: number };
  setLevels: (music: number, fx: number) => void;
  /** [plan4:AC-11] Opens the list view of the bunker. */
  openStructure: () => void;
  /** Text size: current label and cycling to the next. */
  textSize: () => string;
  cycleTextSize: () => void;
  /** Whether the browser promised to keep the save. */
  persistLabel: () => string;
  /** Checks a coupon code and opens the coupon sheet when it is right. */
  redeemCoupon: (code: string) => boolean;
  /** [Q6] Opens the Bunker Book. */
  openBook: () => void;
  /** [Q14] Opens the Chronicle (the run's milestones). */
  openChronicle: () => void;
  /** [plan4:UX-11] Forget which gesture tips were seen / play the opening story again (no change to the game). */
  showTipsAgain?: () => void;
  replayIntro?: () => void;
}

export class MenuPanel {
  private sheet = new Sheet('menu-sheet', 'menu');
  private engine: GameEngine;
  private actions: MenuActions;
  private tab: MenuTab = 'settings';
  private signature = '';
  private backups: BackupInfo[] | null = null;

  constructor(engine: GameEngine, actions: MenuActions) {
    this.engine = engine;
    this.actions = actions;
  }

  show(tab?: MenuTab): void {
    if (tab) this.tab = tab;
    this.signature = '';
    this.refresh(this.engine.stateManager.state);
    this.sheet.show();
    this.loadBackups();
  }

  /** Reads the list of backups (they live in storage, so it is asynchronous) and redraws when it arrives. */
  loadBackups(): void {
    void this.actions.listBackups().then(list => {
      this.backups = list;
      this.signature = '';
      if (this.sheet.isVisible) this.refresh(this.engine.stateManager.state);
    }).catch(() => undefined);
  }

  hide(): void {
    this.sheet.hide();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  refresh(state: GameState): void {
    const meta = this.engine.metaSystem;
    const sig = [
      this.tab, state.achievements.length, meta.isotope(state), JSON.stringify(state.prestige.upgrades),
      meta.canRebirth(state), this.tab === 'stats' ? Math.floor(state.stats.totalPlayTime / 5) : 0,
      this.tab === 'genesis' ? meta.rebirthGain(state) : 0, this.actions.isSoundOn(), this.actions.graphics(), this.actions.brightness(), this.actions.textSize(), this.actions.persistLabel(),
      this.backups?.map(b => `${b.kind}${b.timestamp}`).join(',') ?? 'loading',
      this.tab === 'a11y' ? JSON.stringify(getA11y()) : '',
      this.tab === 'genesis' ? meta.rebirthRequirements(state).map(r => r.current).join(',') : '',
    ].join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    this.render(state);
  }

  private render(state: GameState): void {
    this.sheet.setTitle(`[[menu]] ${i18n.t('menu.title')}`);
    const root = el('div', 'bp');
    const tabs = el('div', 'tab-row');
    const tabDefs: { id: MenuTab; icon: string }[] = [
      { id: 'settings', icon: '[[settings]]' },
      { id: 'a11y', icon: '[[eye]]' },
      { id: 'stats', icon: '[[chart]]' },
      { id: 'achievements', icon: '[[trophy]]' },
      { id: 'genesis', icon: '[[isotope7]]' },
    ];
    for (const t of tabDefs) {
      tabs.appendChild(button(`${t.icon} ${i18n.t(`menu.${t.id}`)}`, `tab ${t.id === this.tab ? 'active' : ''}`, () => {
        this.tab = t.id;
        this.signature = '';
        this.refresh(this.engine.stateManager.state);
      }));
    }
    // [plan4:AC-8] ARIA tabs: tablist / tab / tabpanel, arrow keys.
    const panel = el('div');
    panel.id = 'menu-tabpanel';
    enhanceTabs(tabs, i18n.t('menu.title'), panel);
    root.appendChild(tabs);

    if (this.tab === 'settings') panel.appendChild(this.renderSettings());
    if (this.tab === 'a11y') panel.appendChild(this.renderA11y());
    if (this.tab === 'stats') panel.appendChild(this.renderStats(state));
    if (this.tab === 'achievements') panel.appendChild(this.renderAchievements(state));
    if (this.tab === 'genesis') panel.appendChild(this.renderGenesis(state));
    root.appendChild(panel);
    this.sheet.body.replaceChildren(root);
  }

  /** [plan4:UX-11] Learning aids, as a block of their own: the gesture tips again, and the opening story again. */
  private renderTipsBlock(): HTMLElement {
    const card = el('div', 'bp-card settings-learn');
    const tips = button(`[[hand]] ${i18n.t('settings.tipsAgain')}`, 'btn-secondary learn-btn', () => { uiSound('click'); this.actions.showTipsAgain?.(); });
    const intro = button(`[[flashlight]] ${i18n.t('settings.introAgain')}`, 'btn-secondary learn-btn', () => { uiSound('click'); this.actions.replayIntro?.(); });
    if (!this.actions.showTipsAgain) tips.hidden = true;
    if (!this.actions.replayIntro) intro.hidden = true;
    card.append(tips, intro);
    return card;
  }

  private renderSettings(): HTMLElement {
    const box = el('div', 'bp');
    // [Q6/Q14] The book and the chronicle sit first: the questions a new player asks.
    const guide = el('div', 'bp-card');
    const book = el('div', 'bp-row');
    book.append(el('span', '', `[[question]] ${i18n.t('book.title')}`), button(i18n.t('book.open'), 'btn-small', () => { uiSound('click'); this.actions.openBook(); }));
    const chron = el('div', 'bp-row');
    chron.append(el('span', '', `[[journal]] ${i18n.t('chronicle.title')}`), button(i18n.t('book.open'), 'btn-small', () => { uiSound('click'); this.actions.openChronicle(); }));
    guide.append(book, chron);
    box.appendChild(guide);
    box.appendChild(this.renderTipsBlock());
    const general = el('div', 'bp-card');
    const lang = el('div', 'bp-row');
    lang.append(el('span', '', `[[surface]] ${i18n.t('settings.language')}`),
      button(i18n.currentLocale === 'he' ? 'English' : 'עברית', 'btn-small', () => { uiSound('switch'); this.actions.toggleLanguage(); }));
    const sound = el('div', 'bp-row');
    sound.append(el('span', '', `[[sound]] ${i18n.t('settings.sfx')}`),
      button(this.actions.isSoundOn() ? i18n.t('settings.on') : i18n.t('settings.off'), 'btn-small', () => {
        uiSound('switch');
        this.actions.toggleSound();
        this.signature = '';
        this.refresh(this.engine.stateManager.state);
      }));
    const levels = this.actions.getLevels();
    const slider = (labelKey: string, icon: string, value: number, onInput: (v: number) => void): HTMLElement => {
      const row = el('div', 'bp-row vol-row');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '5';
      input.value = String(Math.round(value * 100));
      input.className = 'vol-slider';
      input.setAttribute('aria-label', i18n.t(labelKey));
      // [plan4:UX-4] Dragging the thumb must not be taken over by the sheet's pull-down-to-close.
      input.setAttribute('data-no-pulldown', '');
      // No redraw while dragging: replacing the slider under the finger would end the drag.
      input.addEventListener('input', () => onInput(Number(input.value) / 100));
      input.addEventListener('change', () => uiSound('switch'));
      row.append(el('span', '', `${icon} ${i18n.t(labelKey)}`), input);
      return row;
    };
    const music = slider('settings.volumeMusic', '[[sound]]', levels.music, v => this.actions.setLevels(v, this.actions.getLevels().fx));
    const fx = slider('settings.volumeFx', '[[sound]]', levels.fx, v => this.actions.setLevels(this.actions.getLevels().music, v));
    const gfx = el('div', 'bp-row');
    gfx.append(el('span', '', `[[sparkle]] ${i18n.t('settings.graphics')}`),
      button(this.actions.graphics(), 'btn-small', () => {
        uiSound('switch');
        this.actions.cycleGraphics();
        this.signature = '';
        this.refresh(this.engine.stateManager.state);
      }));
    const gfxHint = el('div', 'bp-hint', i18n.t('settings.gfxHint'));
    const bright = el('div', 'bp-row');
    bright.append(el('span', '', `[[sun]] ${i18n.t('settings.brightness')}`),
      button(this.actions.brightness(), 'btn-small', () => {
        uiSound('switch');
        this.actions.cycleBrightness();
        this.signature = '';
        this.refresh(this.engine.stateManager.state);
      }));
    const textSize = el('div', 'bp-row');
    textSize.append(el('span', '', `[[note]] ${i18n.t('settings.textSize')}`),
      button(this.actions.textSize(), 'btn-small', () => {
        uiSound('switch');
        this.actions.cycleTextSize();
        this.signature = '';
        this.refresh(this.engine.stateManager.state);
      }));
    // [offline agent] Notifications toggle: turning it on asks the system for permission.
    const notify = el('div', 'bp-row');
    notify.append(el('span', '', `[[bell]] ${i18n.t('settings.notifications')}`),
      button(this.actions.notifications(), 'btn-small', async () => {
        uiSound('switch');
        await this.actions.toggleNotifications();
        this.signature = '';
        this.refresh(this.engine.stateManager.state);
      }));
    const notifyHint = el('div', 'bp-hint', i18n.t('settings.notifyWebHint'));
    const diag = el('div', 'bp-row');
    diag.append(el('span', '', `[[chart]] ${i18n.t('settings.diagnostics')}`),
      button(i18n.t('settings.diagnosticsCopy'), 'btn-small', () => { uiSound('switch'); this.actions.copyDiagnostics(); }));
    general.append(lang, sound, music, fx, gfx, gfxHint, bright, textSize, notify, notifyHint, diag);
    box.appendChild(general);

    const coupon = el('div', 'bp-card');
    coupon.appendChild(el('div', 'bp-section-title', `[[gift]] ${i18n.t('coupon.code')}`));
    const codeRow = el('div', 'btn-row');
    const code = el('input', 'coupon-code');
    code.type = 'text';
    code.autocomplete = 'off';
    code.spellcheck = false;
    code.placeholder = i18n.t('coupon.placeholder');
    code.setAttribute('aria-label', i18n.t('coupon.code'));
    const redeem = () => {
      if (!code.value.trim()) return;
      if (this.actions.redeemCoupon(code.value)) code.value = '';
      else {
        uiSound('cancel');
        code.classList.add('bad');
        setTimeout(() => code.classList.remove('bad'), 900);
      }
    };
    code.addEventListener('keydown', e => { if (e.key === 'Enter') redeem(); });
    codeRow.append(code, button(i18n.t('coupon.redeem'), 'btn-small', redeem));
    coupon.appendChild(codeRow);
    box.appendChild(coupon);

    const saves = el('div', 'bp-card');
    saves.appendChild(el('div', 'bp-section-title', `[[save]] ${i18n.t('settings.save')}`));
    const area = el('textarea', 'save-area');
    area.placeholder = i18n.t('settings.pasteHere');
    area.setAttribute('aria-label', i18n.t('settings.save')); // [plan4:AC-8]
    const row = el('div', 'btn-row');
    row.append(
      button(i18n.t('settings.export'), 'btn-small', async () => {
        const data = this.engine.exportState();
        area.value = data;
        area.select();
        try {
          await navigator.clipboard.writeText(data);
          area.placeholder = i18n.t('settings.copied');
        } catch {
          // clipboard blocked; the text stays selected in the box for manual copy
        }
      }),
      button(i18n.t('settings.exportFile'), 'btn-small', () => this.actions.exportFile()),
      button(i18n.t('settings.import'), 'btn-small', () => {
        if (area.value.trim()) this.actions.importSave(area.value);
      }),
      button(i18n.t('settings.importFile'), 'btn-small', () => this.actions.importFile()),
    );
    saves.append(area, row);
    const persist = el('div', 'bp-row');
    persist.append(el('span', '', `[[lock]] ${i18n.t('settings.persist')}`), el('span', 'bp-value', this.actions.persistLabel()));
    saves.append(persist, el('div', 'bp-hint', i18n.t('settings.persistHint')));
    box.appendChild(saves);

    const backupCard = el('div', 'bp-card');
    backupCard.appendChild(el('div', 'bp-section-title', `[[refresh]] ${i18n.t('settings.backups')}`));
    if (this.backups && this.backups.length > 0) {
      const locale = i18n.currentLocale === 'he' ? 'he-IL' : 'en-GB';
      for (const b of this.backups) {
        const r = el('div', 'bp-row backup-row');
        const when = new Date(b.timestamp).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
        r.append(
          el('span', 'backup-text', i18n.t('settings.backups.row', { kind: i18n.t(`save.kind.${b.kind}`), time: when, n: b.people })),
          button(i18n.t('settings.backups.restore'), 'btn-small', () => this.actions.restoreBackup(b.kind)),
        );
        backupCard.appendChild(r);
      }
    } else if (this.backups) {
      backupCard.appendChild(el('div', 'bp-hint', i18n.t('settings.backups.none')));
    }
    backupCard.appendChild(el('div', 'bp-hint', i18n.t('settings.backups.hint')));
    box.appendChild(backupCard);

    const danger = el('div', 'bp-card');
    danger.appendChild(button(`[[warning]] ${i18n.t('settings.newGame')}`, 'btn-ghost danger-btn', () => this.actions.newGame()));
    box.appendChild(danger);
    return box;
  }

  /**
   * [plan4:AC-1] The accessibility tab. Every control writes through utils/a11y.ts (the single source), which applies it to the page.
   * Not shown on purpose: powerSaver (the field is kept for a later wave; a switch before it does something would be a lie).
   * Everything else in the A11ySettings block has a row here. [plan4:AC-12] One-hand mode and large touch targets are live
   * (styles/touch.css keys off data-onehand / data-large on <html>).
   */
  private renderA11y(): HTMLElement {
    const box = el('div', 'bp');
    const a = getA11y();
    const redraw = () => { this.signature = ''; this.refresh(this.engine.stateManager.state); };
    const card = el('div', 'bp-card a11y-card');
    card.appendChild(el('div', 'bp-section-title', `[[eye]] ${i18n.t('a11y.title')}`));

    const cycleRow = <T extends string>(icon: string, labelKey: string, order: readonly T[], value: T, optKey: string, onPick: (v: T) => void): HTMLElement => {
      const row = el('div', 'bp-row');
      row.append(el('span', '', `${icon} ${i18n.t(labelKey)}`),
        button(i18n.t(`${optKey}.${value}`), 'btn-small', () => {
          uiSound('switch');
          onPick(order[(order.indexOf(value) + 1) % order.length]);
          redraw();
        }));
      return row;
    };

    const hapticsRow = cycleRow('[[hand]]', 'a11y.haptics', ['off', 'light', 'strong'] as const, a.haptics, 'a11y.haptics', v => {
      setA11y({ haptics: v });
      haptic('success'); // a sample of the new strength (nothing when it was just turned off)
    });
    const silentRow = el('div', 'bp-row');
    silentRow.append(el('span', '', `[[sound]] ${i18n.t('a11y.playInSilent')}`),
      button(i18n.t(a.playInSilent ? 'settings.on' : 'settings.off'), 'btn-small', () => {
        uiSound('switch');
        setA11y({ playInSilent: !a.playInSilent });
        redraw();
      }));
    const textRow = el('div', 'bp-row');
    textRow.append(el('span', '', `[[note]] ${i18n.t('settings.textSize')}`),
      button(this.actions.textSize(), 'btn-small', () => {
        uiSound('switch');
        this.actions.cycleTextSize();
        redraw();
      }));
    const motionRow = cycleRow('[[sparkle]]', 'a11y.motion', ['auto', 'reduced', 'full'] as const, a.motion, 'a11y.motion', v => setA11y({ motion: v }));

    // [plan4:AC-12] One-hand mode: which thumb; large targets: every touch target at least 52 px.
    const oneHandRow = cycleRow('[[hand]]', 'a11y.oneHand', ['off', 'right', 'left'] as const, a.oneHand, 'a11y.oneHand', v => setA11y({ oneHand: v }));
    const largeRow = el('div', 'bp-row');
    largeRow.append(el('span', '', `[[hand]] ${i18n.t('a11y.largeTargets')}`),
      button(i18n.t(a.largeTargets ? 'settings.on' : 'settings.off'), 'btn-small', () => {
        uiSound('switch');
        setA11y({ largeTargets: !a.largeTargets });
        redraw();
      }));

    // [plan4:AC-5/AC-6] Flash budget switch and the three colour-vision modes.
    const flashRow = cycleRow('[[sparkle]]', 'a11y.flash', ['normal', 'safe'] as const, a.flash, 'a11y.flash', v => setA11y({ flash: v }));
    const colorRow = cycleRow('[[eye]]', 'a11y.color', ['none', 'deuter', 'protan', 'tritan'] as const, a.colorMode, 'a11y.color', v => setA11y({ colorMode: v }));

    // [plan4:AC-9/AC-11] Captions for sounds, and announcements for a screen reader.
    const toggleRow = (icon: string, key: string, on: boolean, set: (v: boolean) => void): HTMLElement => {
      const row = el('div', 'bp-row');
      row.append(el('span', '', `${icon} ${i18n.t(key)}`), button(i18n.t(on ? 'settings.on' : 'settings.off'), 'btn-small', () => {
        uiSound('switch');
        set(!on);
        redraw();
      }));
      return row;
    };
    const captionsRow = toggleRow('[[note]]', 'a11y.captions', a.captions, v => setA11y({ captions: v }));
    const announceRow = toggleRow('[[eye]]', 'a11y.announce', a.announce, v => setA11y({ announce: v }));
    // [plan4:AC-3/AC-1/AC-13] High contrast, popup density, relaxed timing, floating zoom buttons.
    const contrastRow = cycleRow('[[eye]]', 'a11y.contrast', ['normal', 'high'] as const, a.contrast, 'a11y.contrast', v => setA11y({ contrast: v }));
    const popupsRow = cycleRow('[[note]]', 'a11y.popups', ['all', 'important', 'off'] as const, a.popups, 'a11y.popups', v => setA11y({ popups: v }));
    const timingRow = cycleRow('[[clock]]', 'a11y.timing', ['normal', 'relaxed'] as const, a.timing, 'a11y.timing', v => setA11y({ timing: v }));
    const zoomRow = toggleRow('[[hand]]', 'a11y.zoomButtons', a.zoomButtons, v => setA11y({ zoomButtons: v }));
    // [plan4:AC-16] The accessibility statement (a static page next to the game: public/accessibility.html).
    const statementRow = el('div', 'bp-row');
    statementRow.append(el('span', '', `[[eye]] ${i18n.t('a11y.statement')}`),
      button(i18n.t('a11y.statementOpen'), 'btn-small', () => { uiSound('click'); window.open(new URL('accessibility.html', document.baseURI).href, '_blank', 'noopener'); }));
    // [plan4:AC-11] The list view: the bunker as floors and rooms.
    const listRow = el('div', 'bp-row');
    listRow.append(el('span', '', `[[build]] ${i18n.t('structure.openList')}`),
      button(i18n.t('structure.open'), 'btn-small', () => { uiSound('click'); this.actions.openStructure(); }));

    card.append(listRow, el('div', 'bp-hint', i18n.t('structure.openListHint')), hapticsRow, el('div', 'bp-hint', i18n.t('a11y.hapticsHint')), silentRow, el('div', 'bp-hint', i18n.t('a11y.playInSilentHint')),
      textRow, motionRow, el('div', 'bp-hint', i18n.t('a11y.motionHint')),
      flashRow, el('div', 'bp-hint', i18n.t('a11y.flashHint')), colorRow, el('div', 'bp-hint', i18n.t('a11y.colorHint')),
      captionsRow, el('div', 'bp-hint', i18n.t('a11y.captionsHint')), announceRow, el('div', 'bp-hint', i18n.t('a11y.announceHint')),
      contrastRow, el('div', 'bp-hint', i18n.t('a11y.contrastHint')), popupsRow, el('div', 'bp-hint', i18n.t('a11y.popupsHint')),
      oneHandRow, el('div', 'bp-hint', i18n.t('a11y.oneHandHint')), largeRow, el('div', 'bp-hint', i18n.t('a11y.largeTargetsHint')),
      zoomRow, el('div', 'bp-hint', i18n.t('a11y.zoomButtonsHint')), timingRow, el('div', 'bp-hint', i18n.t('a11y.timingHint')),
      statementRow, el('div', 'bp-hint', i18n.t('a11y.statementHint')));
    box.appendChild(card);
    return box;
  }

  private renderStats(state: GameState): HTMLElement {
    const card = el('div', 'bp-card');
    const rows: [string, string][] = [
      ['[[clock]] ' + i18n.t('stats2.playTime'), i18n.formatDuration(state.stats.totalPlayTime)],
      ['[[food]] ' + i18n.t('stats2.food'), i18n.formatCompact(state.stats.totalFoodProduced)],
      ['[[build]] ' + i18n.t('stats2.buildings'), String(state.stats.totalBuildingsBuilt)],
      ['[[people]] ' + i18n.t('stats2.recruited'), String(state.stats.totalSurvivorsRecruited)],
      ['[[walker]] ' + i18n.t('stats2.missions'), String(state.stats.totalMissionsCompleted)],
      ['[[map]] ' + i18n.t('stats2.explored'), String(state.explorationMap.filter(h => h.explored).length)],
      ['[[research]] ' + i18n.t('stats2.research'), String(Object.values(state.research).filter(r => r.completed).length)],
      ['[[refresh]] ' + i18n.t('stats2.rebirths'), String(state.prestige.rebirthCount)],
      ['[[isotope7]] ' + i18n.t('stats2.isotope'), String(state.prestige.totalIsotope7Earned)],
    ];
    for (const [k, v] of rows) {
      const r = el('div', 'bp-row');
      r.append(el('span', '', k), el('span', 'bp-value', v));
      card.appendChild(r);
    }
    return card;
  }

  private renderAchievements(state: GameState): HTMLElement {
    const locale = i18n.currentLocale;
    const box = el('div', 'bp');
    box.appendChild(el('div', 'bp-hint center', `${state.achievements.length}/${ACHIEVEMENTS.length}`));
    const grid = el('div', 'ach-grid');
    for (const a of ACHIEVEMENTS) {
      const done = state.achievements.includes(a.id);
      const card = el('div', `ach-card ${done ? 'done' : ''}`);
      card.append(el('div', 'ach-icon', done ? a.icon : '[[lock]]'), el('div', 'ach-name', a.name[locale] ?? a.name.en), el('div', 'bp-hint', a.desc[locale] ?? a.desc.en));
      grid.appendChild(card);
    }
    box.appendChild(grid);
    return box;
  }

  private renderGenesis(state: GameState): HTMLElement {
    const meta = this.engine.metaSystem;
    const locale = i18n.currentLocale;
    const box = el('div', 'bp');
    const head = el('div', 'bp-card genesis-head');
    head.append(
      el('div', 'genesis-iso', `[[isotope7]] ${meta.isotope(state)}`),
      el('div', 'bp-hint', i18n.t('genesis.isotope')),
    );
    box.appendChild(head);

    const rebirth = el('div', 'bp-card');
    rebirth.appendChild(el('p', 'modal-body', i18n.t('genesis.explain')));
    rebirth.appendChild(genesisRequirements(state, meta));
    if (meta.canRebirth(state)) {
      rebirth.appendChild(button(`[[isotope7]] ${i18n.t('genesis.rebirth', { n: meta.rebirthGain(state) })}`, 'btn-primary', () => this.actions.rebirth()));
    }
    box.appendChild(rebirth);

    const shop = el('div', 'bp-card');
    shop.appendChild(el('div', 'bp-section-title', i18n.t('genesis.upgrades')));
    for (const u of PRESTIGE_UPGRADES) {
      const level = meta.upgradeLevel(state, u.id);
      const row = el('div', 'genesis-row');
      const info = el('div', 'genesis-info');
      info.append(el('div', 'research-name', `${u.icon} ${u.name[locale] ?? u.name.en} · ${level}/${u.maxLevel}`), el('div', 'bp-hint', u.desc[locale] ?? u.desc.en));
      row.appendChild(info);
      // [P5] Keystones: one per group.
      const closed = !!u.keystone && level === 0 && PRESTIGE_UPGRADES.some(x => x.keystone === u.keystone && x.id !== u.id && meta.upgradeLevel(state, x.id) > 0);
      if (u.keystone) info.appendChild(el('div', 'bp-hint doctrine-tag', i18n.t(closed ? 'genesis.keystoneClosed' : 'genesis.keystone')));
      if (closed) {
        row.appendChild(el('span', 'research-done', '[[lock]]'));
      } else if (level >= u.maxLevel) {
        row.appendChild(el('span', 'research-done', '[[star]]'));
      } else {
        const cost = upgradeCost(u, level);
        row.appendChild(button(`[[isotope7]] ${cost}`, 'btn-small', () => {
          if (meta.buy(u.id)) {
            this.engine.requestSave();
            this.signature = '';
            this.refresh(this.engine.stateManager.state);
          }
        }, meta.isotope(state) < cost));
      }
      shop.appendChild(row);
    }
    box.appendChild(shop);
    return box;
  }
}

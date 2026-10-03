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

export type MenuTab = 'settings' | 'stats' | 'achievements' | 'genesis';

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
  /** Notifications (S6): current label, and turning them on (asks the system) or off. */
  notifications: () => string;
  toggleNotifications: () => Promise<void>;
}

export class MenuPanel {
  private sheet = new Sheet('menu-sheet');
  private engine: GameEngine;
  private actions: MenuActions;
  private tab: MenuTab = 'settings';
  private signature = '';

  constructor(engine: GameEngine, actions: MenuActions) {
    this.engine = engine;
    this.actions = actions;
  }

  show(tab?: MenuTab): void {
    if (tab) this.tab = tab;
    this.signature = '';
    this.refresh(this.engine.stateManager.state);
    this.sheet.show();
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
      this.tab === 'genesis' ? meta.rebirthGain(state) : 0, this.actions.isSoundOn(), this.actions.graphics(),
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
    root.appendChild(tabs);

    if (this.tab === 'settings') root.appendChild(this.renderSettings());
    if (this.tab === 'stats') root.appendChild(this.renderStats(state));
    if (this.tab === 'achievements') root.appendChild(this.renderAchievements(state));
    if (this.tab === 'genesis') root.appendChild(this.renderGenesis(state));
    this.sheet.body.replaceChildren(root);
  }

  private renderSettings(): HTMLElement {
    const box = el('div', 'bp');
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
    const gfx = el('div', 'bp-row');
    gfx.append(el('span', '', `[[sparkle]] ${i18n.t('settings.graphics')}`),
      button(this.actions.graphics(), 'btn-small', () => {
        uiSound('switch');
        this.actions.cycleGraphics();
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
    general.append(lang, sound, gfx, notify);
    box.appendChild(general);

    const saves = el('div', 'bp-card');
    saves.appendChild(el('div', 'bp-section-title', `[[save]] ${i18n.t('settings.save')}`));
    const area = el('textarea', 'save-area');
    area.placeholder = i18n.t('settings.pasteHere');
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
      button(i18n.t('settings.import'), 'btn-small', () => {
        if (area.value.trim()) this.actions.importSave(area.value);
      }),
    );
    saves.append(area, row);
    box.appendChild(saves);

    const danger = el('div', 'bp-card');
    danger.appendChild(button(`[[warning]] ${i18n.t('settings.newGame')}`, 'btn-ghost danger-btn', () => this.actions.newGame()));
    box.appendChild(danger);
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
      if (level >= u.maxLevel) {
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

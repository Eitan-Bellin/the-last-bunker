import type { GameState, ResourceType } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { PROJECTS, designOf, projectDone, stagesDone, type ProjectDef } from '../../data/projects';
import { Sheet } from './Sheet';
import { RESOURCE_ICONS, bar, button, el } from '../dom';
import { uiSound } from '../../audio/uiSound';
import { WEEKLY_CREDITS } from '../../data/challenges';

/** Badge colours of the weekly prizes (ids from COSMETICS in src/data/challenges.ts). */
const COSMETIC_COLORS: Record<string, string> = {
  'plate:amber': '#e0a43a', 'flag:red': '#d9534a', 'plate:green': '#5fbf6a', 'flag:blue': '#4d8fe0', 'plate:violet': '#a779e0', 'flag:gold': '#f5d04a',
};

/** [LateGame B1/B4] Big projects: pick the one that is fed and crewed, deliver resources, see the weekly challenge. */
export class ProjectsPanel {
  private sheet = new Sheet('projects-sheet', 'projects');
  private engine: GameEngine;
  private sig = '';

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  show(): void {
    this.sig = '';
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
    const ps = this.engine.projectSystem;
    const active = state.activeProjectId;
    const sig = [
      i18n.currentLocale, state.era, active, JSON.stringify(state.lateGame.projects),
      active ? ps.crew(state, active).map(s => s.id).join(',') : '',
      // Coarse: the numbers move every tick, the panel redraws a few times a minute.
      Math.floor(state.stats.totalPlayTime / 5),
      JSON.stringify(state.lateGame.weekly),
    ].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    this.render(state);
  }

  private rerender(): void {
    this.sig = '';
    this.refresh(this.engine.stateManager.state);
  }

  private render(state: GameState): void {
    const ps = this.engine.projectSystem;
    const locale = i18n.currentLocale;
    this.sheet.setTitle(`[[build]] ${i18n.t('proj.title')}`);
    const root = el('div', 'projects');
    const t = ps.totals(state);
    root.appendChild(el('p', 'bp-hint', i18n.t('proj.intro', { done: t.done, all: t.all })));

    const weekly = this.engine.objectiveSystem.weekly(state);
    if (weekly) {
      const card = el('div', 'bp-card');
      card.appendChild(el('div', 'bp-section-title', `[[trophy]] ${i18n.t('weekly.title')}`));
      card.appendChild(el('div', '', `${weekly.def.icon} ${weekly.def.text[locale]}`));
      card.appendChild(bar((weekly.cur / weekly.target) * 100, 'accent'));
      card.appendChild(el('div', 'bp-hint', weekly.done ? `[[check]] ${i18n.t('weekly.done')}` : i18n.t('weekly.prize', { n: WEEKLY_CREDITS, cur: weekly.cur, target: weekly.target })));
      const cos = state.lateGame.weekly.cosmetics;
      if (cos.length) {
        const shelf = el('div', 'cosmetic-shelf');
        for (const c of cos) {
          const chip = el('span', 'cosmetic-chip', i18n.t(`cosmetic.${c}`));
          chip.dataset.kind = c.split(':')[0];
          chip.style.setProperty('--cos', COSMETIC_COLORS[c] ?? '#c9a35a');
          shelf.appendChild(chip);
        }
        card.append(el('div', 'bp-hint', `[[star]] ${i18n.t('weekly.cosmetics', { n: cos.length })}`), shelf);
      }
      root.appendChild(card);
    }

    for (const def of PROJECTS) root.appendChild(this.renderProject(state, def));
    this.sheet.body.replaceChildren(root);
  }

  /** [P2-2] The two designs of a project: pick one before the first stage is done. */
  private renderDesign(state: GameState, def: ProjectDef): HTMLElement {
    const locale = i18n.currentLocale;
    const ps = this.engine.projectSystem;
    const chosen = designOf(state, def.id);
    const locked = stagesDone(state, def.id) > 0;
    const box = el('div', 'design-pick');
    box.appendChild(el('div', 'bp-hint', i18n.t(locked ? 'proj.designLocked' : 'proj.design')));
    const options: { id: 'a' | 'b'; label: string; finale: string }[] = [
      { id: 'a', label: i18n.t('proj.designA'), finale: def.finale[locale] },
      { id: 'b', label: def.variant!.label[locale], finale: def.variant!.finale[locale] },
    ];
    for (const o of options) {
      const b = button(o.label, `btn-small design-opt ${chosen === o.id ? 'btn-primary' : 'btn-secondary'}`, () => {
        if (ps.setDesign(def.id, o.id)) {
          uiSound('click');
          this.engine.requestSave();
          this.sig = '';
          this.refresh(this.engine.stateManager.state);
        }
      }, locked && chosen !== o.id);
      b.setAttribute('aria-pressed', String(chosen === o.id));
      const row = el('div', `design-row ${chosen === o.id ? 'on' : ''}`);
      row.append(b, el('span', 'bp-hint', `[[gift]] ${o.finale}`));
      box.appendChild(row);
    }
    return box;
  }

  private renderProject(state: GameState, def: ProjectDef): HTMLElement {
    const ps = this.engine.projectSystem;
    const locale = i18n.currentLocale;
    const done = projectDone(state, def.id);
    const open = ps.isAvailable(state, def);
    const isActive = state.activeProjectId === def.id;
    const card = el('div', `bp-card project ${isActive ? 'active' : ''}`);
    const head = el('div', 'bp-row');
    head.append(el('span', 'research-name', `${def.icon} ${def.name[locale]}`), el('span', 'bp-hint', `${stagesDone(state, def.id)}/${def.stages.length}`));
    card.appendChild(head);
    card.appendChild(el('div', 'bp-hint', def.desc[locale]));
    if (def.variant && !done) card.appendChild(this.renderDesign(state, def));
    else card.appendChild(el('div', 'bp-hint', `[[gift]] ${(designOf(state, def.id) === 'b' && def.variant ? def.variant.finale : def.finale)[locale]}`));
    if (done) {
      card.appendChild(el('div', 'bp-hint', `[[check]] ${i18n.t('proj.finished')}`));
      return card;
    }
    if (!open) {
      card.appendChild(el('div', 'bp-hint', `[[lock]] ${def.act ? i18n.t('proj.lockedAct', { n: def.act }) : i18n.t('proj.locked')}`));
      return card;
    }
    const stage = ps.stageOf(state, def.id)!;
    const prog = ps.progressOf(state, def.id);
    card.appendChild(el('div', 'bp-section-title', i18n.t('proj.stage', { n: prog.stage + 1, all: def.stages.length })));
    const costs = el('div', 'cost-row');
    for (const [r, v] of Object.entries(stage.cost) as [ResourceType, number][]) {
      const paid = Math.min(v, Math.floor(prog.paid[r] ?? 0));
      costs.appendChild(el('span', `cost-chip ${paid >= v ? 'affordable' : 'expensive'}`, `${RESOURCE_ICONS[r] ?? r} ${paid}/${v}`));
    }
    card.appendChild(costs);
    card.appendChild(bar(ps.paidFraction(state, def.id) * 100));
    const crew = ps.workers(state, def.id).length;
    const eta = ps.workEta(state, def.id);
    card.appendChild(el('div', 'bp-hint', `[[worker]] ${i18n.t('proj.crew', { n: crew, max: stage.crew })} · [[clock]] ${Number.isFinite(eta) ? i18n.formatDuration(eta) : i18n.t('proj.noCrew')}`));
    card.appendChild(bar(ps.workFraction(state, def.id) * 100, 'accent'));

    const row = el('div', 'btn-row');
    if (isActive) {
      row.appendChild(button(i18n.t('proj.deliver'), 'btn-primary', () => {
        uiSound('click');
        ps.deposit(def.id);
        this.engine.requestSave();
        this.rerender();
      }, !ps.canDeposit(state, def.id)));
      row.appendChild(button(i18n.t('proj.staff'), 'btn-secondary', () => {
        uiSound('assign');
        ps.autoStaff(def.id);
        this.engine.requestSave();
        this.rerender();
      }, !ps.canAssign(state, def.id)));
      row.appendChild(button(i18n.t('proj.stop'), 'btn-ghost', () => {
        uiSound('unassign');
        ps.setActive(null);
        this.engine.requestSave();
        this.rerender();
      }));
      card.appendChild(row);
      card.appendChild(el('div', 'bp-hint', `[[recycle]] ${i18n.t('proj.fedHint')}`));
    } else {
      row.appendChild(button(i18n.t('proj.setActive'), 'btn-primary', () => {
        uiSound('click');
        ps.setActive(def.id);
        this.engine.requestSave();
        this.rerender();
      }));
      card.appendChild(row);
    }
    return card;
  }
}

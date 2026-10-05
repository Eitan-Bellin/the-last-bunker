import type { GameState, ResourceType } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { PROJECTS, projectDone, stagesDone, type ProjectDef } from '../../data/projects';
import { Sheet } from './Sheet';
import { RESOURCE_ICONS, bar, button, el } from '../dom';
import { uiSound } from '../../audio/uiSound';
import { WEEKLY_CREDITS } from '../../data/challenges';

/** [LateGame B1/B4] Big projects: pick the one that is fed and crewed, deliver resources, see the weekly challenge. */
export class ProjectsPanel {
  private sheet = new Sheet('projects-sheet');
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
      if (cos.length) card.appendChild(el('div', 'bp-hint', `[[star]] ${i18n.t('weekly.cosmetics', { n: cos.length })}`));
      root.appendChild(card);
    }

    for (const def of PROJECTS) root.appendChild(this.renderProject(state, def));
    this.sheet.body.replaceChildren(root);
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
    card.appendChild(el('div', 'bp-hint', `[[gift]] ${def.finale[locale]}`));
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

import type { GameState } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { BRANCHES, REFINEMENTS, RESEARCH, type ResearchBranch, type ResearchDef } from '../../data/research';
import { refinementLevel } from '../../systems/ResearchSystem';
import { Sheet } from './Sheet';
import { bar, button, costRow, el, setBar, setRich } from '../dom';
import { uiSound } from '../../audio/uiSound';
import { genesisRequirements } from './MenuPanel';

export class ResearchPanel {
  private sheet = new Sheet('research-sheet');
  private engine: GameEngine;
  private branch: ResearchBranch = 'infrastructure';
  private signature = '';
  private activeBar: HTMLElement | null = null;
  private activeTime: HTMLElement | null = null;

  onOpenGenesis: (() => void) | null = null;

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  show(): void {
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
    const rs = this.engine.researchSystem;
    const ids = [...RESEARCH.map(r => r.id), ...REFINEMENTS.map(r => r.id)];
    const sig = [
      this.branch, i18n.currentLocale, rs.activeId(state), rs.queue(state).join(','), JSON.stringify(state.refinements ?? {}),
      ids.map(id => `${id}:${rs.status(state, id)}:${rs.canStart(state, id)}`).join(','),
      state.buildings.filter(b => b.type === 'laboratory').length,
      this.branch === 'genesis' ? this.engine.metaSystem.rebirthRequirements(state).map(r => r.current).join(',') : '',
    ].join('|');
    if (sig !== this.signature) {
      this.signature = sig;
      this.render(state);
    }
    const id = rs.activeId(state);
    if (id && this.activeBar && this.activeTime) {
      const node = state.research[id];
      setBar(this.activeBar, (node.progress / node.total) * 100);
      setRich(this.activeTime, `[[clock]] ${i18n.formatDuration((node.total - node.progress) / rs.speed(state))}`);
    }
  }

  private start(id: string): void {
    if (this.engine.researchSystem.start(this.engine.stateManager, id)) {
      uiSound('confirm');
      this.engine.requestSave();
      this.refresh(this.engine.stateManager.state);
    }
  }

  private render(state: GameState): void {
    const rs = this.engine.researchSystem;
    const locale = i18n.currentLocale;
    this.sheet.setTitle(`[[research]] ${i18n.t('research.title')}`);
    const root = el('div', 'bp');

    const head = el('div', 'bp-card research-head');
    const activeId = rs.activeId(state);
    this.activeBar = null;
    this.activeTime = null;
    if (activeId) {
      const def = rs.defOf(state, activeId)!;
      const row = el('div', 'bp-row');
      row.append(el('span', 'research-active-name', `${def.icon} ${def.name[locale] ?? def.name.en}`));
      this.activeTime = el('span', 'bp-hint');
      row.appendChild(this.activeTime);
      this.activeBar = bar(0, 'xp');
      head.append(row, this.activeBar);
      head.appendChild(this.renderQueue(state));
    } else {
      head.appendChild(el('div', 'bp-hint', i18n.t('research.idle')));
    }
    const speed = rs.speed(state);
    const hasLab = state.buildings.some(b => b.type === 'laboratory');
    head.appendChild(el('div', 'bp-hint', hasLab
      ? i18n.t('research.speed', { x: speed.toFixed(2) })
      : `[[intelligence]] ${i18n.t('research.needLab')}`));
    root.appendChild(head);

    const tabs = el('div', 'tab-row');
    for (const b of BRANCHES) {
      const t = button(`${b.icon} ${b.name[locale] ?? b.name.en}`, `tab ${b.id === this.branch ? 'active' : ''}`, () => {
        this.branch = b.id;
        this.refresh(this.engine.stateManager.state);
      });
      tabs.appendChild(t);
    }
    root.appendChild(tabs);

    const list = el('div', 'research-list');
    if (this.branch === 'refinement') {
      list.appendChild(el('div', 'bp-hint', `[[up]] ${i18n.t('research.refineHint')}`));
      for (const ref of REFINEMENTS) list.appendChild(this.renderCard(state, rs.defOf(state, ref.id)!, refinementLevel(state, ref.id)));
    } else {
      for (const def of RESEARCH.filter(r => r.branch === this.branch).sort((a, b) => a.tier - b.tier)) {
        list.appendChild(this.renderCard(state, def, null));
      }
    }
    root.appendChild(list);

    if (this.branch === 'genesis') {
      root.appendChild(genesisRequirements(state, this.engine.metaSystem));
      root.appendChild(button(`[[isotope7]] ${i18n.t('genesis.open')}`, 'btn-secondary', () => this.onOpenGenesis?.()));
    }
    this.sheet.body.replaceChildren(root);
  }

  /** The waiting line behind the active research, with a refund button per entry. */
  private renderQueue(state: GameState): HTMLElement {
    const rs = this.engine.researchSystem;
    const locale = i18n.currentLocale;
    const queue = rs.queue(state);
    const box = el('div', 'research-queue');
    box.appendChild(el('div', 'bp-hint', `[[clock]] ${i18n.t('research.queue', { n: queue.length, max: rs.queueSlots(state) })}`));
    queue.forEach((id, i) => {
      const def = rs.defOf(state, id);
      if (!def) return;
      const row = el('div', 'research-queue-row');
      row.append(
        el('span', 'research-queue-name', `${i + 1}. ${def.icon} ${def.name[locale] ?? def.name.en}`),
        el('span', 'bp-hint', `[[clock]] ${i18n.formatDuration(rs.etaSeconds(state, id))}`),
      );
      const cancel = button('[[close]]', 'btn-small btn-ghost', () => {
        if (rs.cancelQueued(this.engine.stateManager, id)) {
          uiSound('switch');
          this.engine.requestSave();
          this.refresh(this.engine.stateManager.state);
        }
      });
      cancel.title = i18n.t('research.cancelQueued');
      cancel.setAttribute('aria-label', i18n.t('research.cancelQueued'));
      row.appendChild(cancel);
      box.appendChild(row);
    });
    if (queue.length < rs.queueSlots(state)) box.appendChild(el('div', 'bp-hint', i18n.t('research.queueHint')));
    return box;
  }

  /** One node; `level` is set for repeatable refinements (levels already done). */
  private renderCard(state: GameState, def: ResearchDef, level: number | null): HTMLElement {
    const rs = this.engine.researchSystem;
    const locale = i18n.currentLocale;
    const status = rs.status(state, def.id);
    const card = el('div', `research-card ${status}`);
    const top = el('div', 'bp-row');
    top.append(
      el('span', 'research-name', `${def.icon} ${def.name[locale] ?? def.name.en}`),
      el('span', 'tier-chip', level === null ? `T${def.tier}` : i18n.t('research.level', { n: level })),
    );
    card.append(top, el('div', 'build-item-desc', def.desc[locale] ?? def.desc.en));

    if (status === 'done') {
      card.appendChild(el('div', 'research-done', `[[check]] ${i18n.t('research.done')}`));
    } else if (status === 'active') {
      card.appendChild(el('div', 'research-done active', `[[hourglass]] ${i18n.t('research.inProgress')}`));
    } else if (status === 'queued') {
      const pos = rs.queue(state).indexOf(def.id) + 1;
      card.appendChild(el('div', 'research-done active', `[[clock]] ${i18n.t('research.queued', { n: pos })}`));
    } else {
      const meta = el('div', 'bp-upgrade-info');
      meta.append(costRow(state, def.cost as Record<string, number>), el('span', 'bp-hint', `[[clock]] ${i18n.formatDuration(def.time / rs.speed(state))}`));
      card.appendChild(meta);
      const pending = new Set([rs.activeId(state), ...rs.queue(state)]);
      const missing = def.requires.filter(r => !state.research[r]?.completed && !pending.has(r));
      if (missing.length > 0) {
        const names = missing.map(r => rs.defOf(state, r)?.name[locale] ?? r).join(', ');
        card.appendChild(el('div', 'bp-hint', `[[lock]] ${i18n.t('research.requires', { list: names })}`));
      } else {
        const busy = !!rs.activeId(state);
        const full = busy && rs.queue(state).length >= rs.queueSlots(state);
        const label = full ? i18n.t('research.queueFull') : busy ? i18n.t('research.addToQueue') : i18n.t('research.start');
        card.appendChild(button(label, busy ? 'btn-secondary' : 'btn-primary', () => this.start(def.id), !rs.canStart(state, def.id)));
      }
    }
    return card;
  }
}

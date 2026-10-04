import type { GameEngine } from '../../core/GameEngine';
import type { GameState } from '../../core/GameState';
import { i18n } from '../../i18n/I18nManager';
import { ERAS, eraOf, type EraDef } from '../../data/eras';
import { Sheet } from './Sheet';
import { bar, button, el, setBar } from '../dom';
import { ACTS, actOf, type ActDef } from '../../data/acts';
import { getProject, stagesDone } from '../../data/projects';
import { FOREMAN_ACT, FOREMAN_ORDERS, type ForemanSystem } from '../../systems/ForemanSystem';

/** Where the bunker stands in its story, and what it takes to reach the next era. */
export class EraPanel {
  private sheet = new Sheet('era-sheet');
  private signature = '';
  private bars: HTMLElement[] = [];
  private labels: HTMLElement[] = [];
  /** [LateGame B1] Opens the big projects panel. */
  onOpenProjects: (() => void) | null = null;
  /** [Long game] The Act's goal bars (its own goals, then its charter projects). */
  private actBars: HTMLElement[] = [];
  private actLabels: HTMLElement[] = [];
  /** [Long game] Set by the app: the Foreman whose standing orders are toggled here. */
  foreman: ForemanSystem | null = null;
  /** [Long game UX] Set by the app: the engine, for the "next up" card (objective, project ETA). */
  engine: GameEngine | null = null;
  private lastState: GameState | null = null;

  show(state: GameState): void {
    this.signature = '';
    this.refresh(state);
    this.sheet.show();
  }

  hide(): void {
    this.sheet.hide();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  refresh(state: GameState): void {
    const era = eraOf(state);
    const act = state.longGame ? actOf(state) : null;
    this.lastState = state;
    const orders = FOREMAN_ORDERS.map(o => (state.longGame?.foreman.orders[o] ? 1 : 0)).join('');
    const goalIdx = act ? act.goals.findIndex(g => { const [c, t] = g.progress(state); return c < t; }) : -1;
    const sig = `${era.id}|${act?.id ?? 0}|${orders}|${state.tutorialStep}|${goalIdx}|${state.activeProjectId}|${state.activeProjectId ? state.lateGame.projects[state.activeProjectId]?.stage ?? 0 : 0}|${i18n.currentLocale}`;
    if (sig !== this.signature) {
      this.signature = sig;
      this.render(era, act);
    }
    if (act) {
      const rows: [number, number][] = [
        ...act.goals.map(g => g.progress(state)),
        ...act.charter.map(id => [stagesDone(state, id), getProject(id)?.stages.length ?? 1] as [number, number]),
      ];
      rows.forEach(([c, t], i) => {
        setBar(this.actBars[i], (Math.min(c, t) / t) * 100);
        if (this.actLabels[i]) this.actLabels[i].textContent = c >= t ? '✓' : t > 1 ? `${Math.min(c, t)}/${t}` : '';
      });
    }
    era.next.forEach((g, i) => {
      const [c, t] = g.progress(state);
      setBar(this.bars[i], (Math.min(c, t) / t) * 100);
      if (this.labels[i]) this.labels[i].textContent = t > 1 ? `${Math.min(c, t)}/${t}` : c >= t ? '✓' : '';
    });
  }

  /** [Long game UX] Three goals, short to long: the current objective, the Act's next goal, and the charter work. */
  private renderNextUp(state: GameState, act: ActDef): HTMLElement {
    const locale = i18n.currentLocale;
    const engine = this.engine!;
    const card = el('div', 'bp-card next-up');
    card.appendChild(el('div', 'bp-section-title', `[[target]] ${i18n.t('next.title')}`));
    const obj = engine.objectiveSystem.current(state);
    const [oc, ot] = obj.progress(state);
    card.appendChild(el('div', 'next-row', `${i18n.t('next.short')}: ${obj.text[locale] ?? obj.text.en}${ot > 1 ? ` (${Math.min(oc, ot)}/${ot})` : ''}`));
    const goal = act.goals.find(g => { const [c, t] = g.progress(state); return c < t; });
    if (goal) {
      const [c, t] = goal.progress(state);
      card.appendChild(el('div', 'next-row', `${i18n.t('next.medium')}: ${goal.text[locale]} (${c}/${t})`));
    }
    const pid = state.activeProjectId;
    const charter = act.charter.find(id => stagesDone(state, id) < (getProject(id)?.stages.length ?? 0));
    if (pid) {
      const def = getProject(pid);
      const eta = engine.projectSystem.workEta(state, pid);
      const done = stagesDone(state, pid);
      card.appendChild(el('div', 'next-row', `${i18n.t('next.long')}: ${def?.name[locale] ?? pid} · ${i18n.t('next.stage', { n: done + 1, all: def?.stages.length ?? 0 })}${isFinite(eta) ? ` · ${i18n.t('next.workLeft', { t: i18n.formatDuration(eta) })}` : ` · ${i18n.t('next.noCrew')}`}`));
    } else if (charter) {
      card.appendChild(el('div', 'next-row', `${i18n.t('next.long')}: ${i18n.t('next.pick', { name: getProject(charter)?.name[locale] ?? charter })}`));
    }
    return card;
  }

  /** [Long game] The Act card: its name, what it allows, and what finishes it (goals and charter projects). */
  private renderAct(act: ActDef): HTMLElement {
    const locale = i18n.currentLocale;
    const card = el('div', 'bp-card act-card');
    card.append(
      el('div', 'act-name', act.name[locale]),
      el('div', 'era-tagline', act.tagline[locale]),
      el('div', 'act-limits', i18n.t('act.limits', { level: act.levelCap, people: act.popCap, floors: act.floorCap })),
    );
    // [P2] How tempting the bunker looks out there.
    if (this.lastState?.longGame) {
      const t = this.lastState.longGame.threat;
      const calm = t.breatherUntil > this.lastState.longGame.meta.worldT;
      card.appendChild(el('div', 'act-limits', `[[skull]] ${i18n.t('threat.meter', { n: Math.round(t.meter) })}${calm ? ` · ${i18n.t('threat.breather', { t: i18n.formatDuration(t.breatherUntil - this.lastState.longGame.meta.worldT) })}` : ''}`));
    }
    const last = act.id >= ACTS.length;
    card.appendChild(el('div', 'bp-section-title', last ? i18n.t('act.goalsGenesis') : i18n.t('act.goalsNext', { name: ACTS[act.id].name[locale] })));
    this.actBars = [];
    this.actLabels = [];
    const addRow = (text: string) => {
      const row = el('div', 'era-goal');
      const label = el('span', 'era-goal-count');
      row.append(el('span', 'era-goal-text', text), label);
      const b = bar(0, 'accent');
      card.append(row, b);
      this.actBars.push(b);
      this.actLabels.push(label);
    };
    for (const g of act.goals) addRow(g.text[locale]);
    for (const id of act.charter) addRow(`[[build]] ${i18n.t('act.charter', { name: getProject(id)?.name[locale] ?? id })}`);
    const steps = el('div', 'era-timeline');
    for (const a of ACTS) {
      const step = el('div', `era-step ${a.id < act.id ? 'past' : a.id === act.id ? 'current' : 'future'}`);
      step.append(el('span', 'era-dot'), el('span', 'era-step-name', a.name[locale]));
      steps.appendChild(step);
    }
    card.appendChild(steps);
    if (act.id >= FOREMAN_ACT && this.foreman && this.lastState) card.appendChild(this.renderForeman(this.lastState));
    return card;
  }

  /** [Long game] The Foreman's standing orders: routine handed over, on or off. */
  private renderForeman(state: GameState): HTMLElement {
    const box = el('div', 'foreman');
    box.appendChild(el('div', 'bp-section-title', `[[worker]] ${i18n.t('foreman.title')}`));
    box.appendChild(el('div', 'bp-hint', i18n.t('foreman.hint')));
    for (const o of FOREMAN_ORDERS) {
      const on = !!state.longGame?.foreman.orders[o];
      const row = el('div', 'foreman-row');
      row.append(el('span', 'foreman-text', i18n.t(`foreman.${o}`)), button(i18n.t(on ? 'settings.on' : 'settings.off'), on ? 'btn-primary btn-small' : 'btn-secondary btn-small', () => {
        this.foreman?.set(o, !on);
        this.signature = '';
        if (this.lastState) this.refresh(this.lastState);
      }));
      box.appendChild(row);
    }
    return box;
  }

  private render(era: EraDef, act: ActDef | null): void {
    const locale = i18n.currentLocale;
    this.sheet.setTitle(`[[flag]] ${i18n.t('era.title')}`);
    const root = el('div', 'era');
    if (act && this.lastState && this.engine) root.appendChild(this.renderNextUp(this.lastState, act));
    if (act) root.appendChild(this.renderAct(act));
    const head = el('div', `era-head era-${era.key}`);
    head.append(
      el('div', 'era-num', i18n.t('era.number', { n: era.id + 1 })),
      el('div', 'era-name', era.name[locale]),
      el('div', 'era-tagline', era.tagline[locale]),
    );
    root.appendChild(head);
    root.appendChild(button(`[[build]] ${i18n.t('proj.open')}`, 'btn-primary', () => this.onOpenProjects?.())); // [LateGame B1]
    this.bars = [];
    this.labels = [];
    if (era.next.length) {
      const goals = el('div', 'bp-card');
      goals.appendChild(el('div', 'bp-section-title', i18n.t('era.nextGoals', { name: ERAS[era.id + 1].name[locale] })));
      for (const g of era.next) {
        const row = el('div', 'era-goal');
        const label = el('span', 'era-goal-count');
        row.append(el('span', 'era-goal-text', g.text[locale]), label);
        const b = bar(0, 'accent');
        goals.append(row, b);
        this.bars.push(b);
        this.labels.push(label);
      }
      root.appendChild(goals);
    } else {
      root.appendChild(el('div', 'bp-card bp-hint', i18n.t('era.final')));
    }
    const timeline = el('div', 'era-timeline');
    for (const e of ERAS) {
      const step = el('div', `era-step ${e.id < era.id ? 'past' : e.id === era.id ? 'current' : 'future'}`);
      step.append(el('span', 'era-dot'), el('span', 'era-step-name', e.name[locale]));
      timeline.appendChild(step);
    }
    root.appendChild(timeline);
    this.sheet.body.replaceChildren(root);
  }
}

/** [Long game] Full-screen title card when a new Act begins: what it opens. */
export function showActBanner(act: ActDef, onDone: () => void): void {
  const locale = i18n.currentLocale;
  const overlay = el('div', 'era-banner act-banner');
  const inner = el('div', 'era-banner-inner');
  inner.append(
    el('div', 'era-banner-kicker', i18n.t('act.new')),
    el('div', 'era-banner-name', act.name[locale]),
    el('div', 'era-banner-tagline', act.tagline[locale]),
    el('p', 'era-banner-story', i18n.t('act.opens', { level: act.levelCap, people: act.popCap, floors: act.floorCap })),
  );
  const btn = el('button', 'btn btn-primary', i18n.t('era.continue'));
  inner.appendChild(btn);
  overlay.appendChild(inner);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));
  btn.addEventListener('click', () => {
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 600);
    onDone();
  });
}

/** Full-screen title card when a new era begins. */
export function showEraBanner(era: EraDef, onDone: () => void): void {
  const locale = i18n.currentLocale;
  const overlay = el('div', `era-banner era-${era.key}`);
  const inner = el('div', 'era-banner-inner');
  inner.append(
    el('div', 'era-banner-kicker', i18n.t('era.newEra')),
    el('div', 'era-banner-name', era.name[locale]),
    el('div', 'era-banner-tagline', era.tagline[locale]),
    el('p', 'era-banner-story', era.story[locale]),
  );
  const btn = el('button', 'btn btn-primary', i18n.t('era.continue'));
  inner.appendChild(btn);
  overlay.appendChild(inner);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));
  btn.addEventListener('click', () => {
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 600);
    onDone();
  });
}

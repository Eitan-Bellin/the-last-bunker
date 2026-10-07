import type { GameEngine } from '../../core/GameEngine';
import type { ResourceType } from '../../core/GameState';
import { i18n } from '../../i18n/I18nManager';
import { uiSound } from '../../audio/uiSound';
import { Sheet } from './Sheet';
import { button, el } from '../dom';

/** The coupon code (letters are compared without case and spaces). Change it here. */
const COUPON_CODE = 'BUNKER17';

export function couponValid(code: string): boolean {
  return code.replace(/\s+/g, '').toUpperCase() === COUPON_CODE;
}

type Kind = 'rush' | 'research' | 'build' | 'dig' | 'project' | 'missions' | 'arrival' | 'fill';

interface Row {
  kind: Kind;
  icon: string;
  /** Default amount in the box (0 = no box: the row is one button). */
  amount: number;
  max: number;
}

const ROWS: Row[] = [
  { kind: 'rush', icon: '[[rocket]]', amount: 10, max: 999 },
  { kind: 'research', icon: '[[research]]', amount: 1, max: 999 },
  { kind: 'build', icon: '[[build]]', amount: 1, max: 999 },
  { kind: 'dig', icon: '[[pick]]', amount: 1, max: 999 },
  { kind: 'project', icon: '[[worker]]', amount: 1, max: 50 },
  { kind: 'missions', icon: '[[surface]]', amount: 1, max: 999 },
  { kind: 'arrival', icon: '[[door]]', amount: 5, max: 999 },
  { kind: 'fill', icon: '[[storage]]', amount: 0, max: 0 },
];

/**
 * The coupon sheet: opened from Settings with the right code. The player picks how much to add on each line:
 * accelerators, hours skipped on the research, on every room being built, on the expeditions, stages of the
 * active project, or full stores.
 */
export class CouponPanel {
  private sheet = new Sheet('coupon-sheet');
  private engine: GameEngine;
  private toast: (text: string, good: boolean) => void;

  constructor(engine: GameEngine, toast: (text: string, good: boolean) => void) {
    this.engine = engine;
    this.toast = toast;
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  show(): void {
    this.render();
    this.sheet.show();
  }

  hide(): void {
    this.sheet.hide();
  }

  private render(): void {
    this.sheet.setTitle(`[[gift]] ${i18n.t('coupon.title')}`);
    const root = el('div', 'bp');
    root.appendChild(el('p', 'bp-hint', i18n.t('coupon.intro')));
    for (const row of ROWS) {
      const card = el('div', 'bp-card');
      card.appendChild(el('div', 'bp-section-title', `${row.icon} ${i18n.t(`coupon.${row.kind}`)}`));
      card.appendChild(el('div', 'bp-hint', this.status(row.kind)));
      const line = el('div', 'btn-row');
      let input: HTMLInputElement | null = null;
      if (row.max > 0) {
        input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = String(row.max);
        input.step = '1';
        input.value = String(row.amount);
        input.inputMode = 'numeric';
        input.className = 'coupon-amount';
        input.setAttribute('aria-label', i18n.t(`coupon.${row.kind}.unit`));
        line.append(input, el('span', 'bp-hint', i18n.t(`coupon.${row.kind}.unit`)));
      }
      line.appendChild(button(i18n.t('coupon.apply'), 'btn-primary btn-small', () => {
        const n = input ? Math.max(1, Math.min(row.max, Math.floor(Number(input.value) || 0))) : 1;
        const done = this.apply(row.kind, n);
        uiSound(done ? 'confirm' : 'cancel');
        this.toast(done ? `[[check]] ${i18n.t('coupon.done')}` : i18n.t('coupon.nothing'), done);
        if (done) {
          this.engine.requestSave();
          this.render();
        }
      }));
      card.appendChild(line);
      root.appendChild(card);
    }
    this.sheet.body.replaceChildren(root);
  }

  /** What the line would act on right now. */
  private status(kind: Kind): string {
    const e = this.engine;
    const state = e.stateManager.state;
    switch (kind) {
      case 'rush': return i18n.t('coupon.rush.have', { n: e.rushSystem.count(state) });
      case 'research': {
        const id = e.researchSystem.activeId(state);
        return id ? i18n.t('coupon.research.on', { n: 1 + e.researchSystem.queue(state).length }) : i18n.t('coupon.none');
      }
      case 'build': {
        const n = state.buildings.filter(b => b.isConstructing).length;
        return n ? i18n.t('coupon.build.on', { n }) : i18n.t('coupon.none');
      }
      case 'dig': {
        const d = e.digSystem.dig(state); // [plan4:ST-3] the primary dig (the floor dig, else the first running one)
        if (!d || d.floor == null) return i18n.t('coupon.none');
        return i18n.t('coupon.dig.on', { n: d.floor + 1, h: Math.ceil(Math.max(0, d.total - d.progress) / 3600) });
      }
      case 'project': {
        const id = state.activeProjectId;
        return id ? i18n.t('coupon.project.on') : i18n.t('coupon.none');
      }
      case 'missions': {
        const n = state.activeMissions.length;
        return n ? i18n.t('coupon.missions.on', { n }) : i18n.t('coupon.none');
      }
      case 'arrival': {
        if (state.survivors.length >= state.maxPopulation) return i18n.t('coupon.arrival.full');
        const left = Math.max(0, Math.ceil(state.nextArrivalAt - state.stats.totalPlayTime));
        return i18n.t('coupon.arrival.on', { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` });
      }
      case 'fill': return i18n.t('coupon.fill.hint');
    }
  }

  private apply(kind: Kind, n: number): boolean {
    const e = this.engine;
    const sm = e.stateManager;
    switch (kind) {
      case 'rush':
        e.rushSystem.grant(n);
        return true;
      case 'research': {
        // The research system runs the hours through the queue: what is left after one research goes on to the next.
        if (!e.researchSystem.activeId(sm.state) && !e.researchSystem.queue(sm.state).length) return false;
        e.researchSystem.update(sm, n * 3600);
        return true;
      }
      case 'build': {
        const secs = n * 3600;
        const state = sm.state;
        let any = false;
        state.buildings.forEach((b, i) => {
          if (!b.isConstructing) return;
          sm.applyDelta({ path: `buildings.${i}.constructionProgress`, value: Math.min(b.constructionTotal, b.constructionProgress + secs) });
          any = true;
        });
        return any;
      }
      case 'dig': {
        const slot = e.digSystem.primary(sm.state);
        const d = e.digSystem.dig(sm.state, slot);
        if (!d || d.floor == null) return false;
        sm.applyDelta({ path: slot === 0 ? 'longGame.dig.progress' : 'longGame.dig2.progress', value: Math.min(d.total, d.progress + n * 3600) });
        // Opens the floor at once if the dig is now complete (even with no crew on site).
        if (d.progress + n * 3600 >= d.total) e.digSystem.update(0);
        return true;
      }
      case 'project': {
        let any = false;
        for (let k = 0; k < n; k++) {
          const ps = e.projectSystem;
          if (!sm.state.activeProjectId || !ps.boostStage(sm.state, 1)) break;
          ps.update(0);
          any = true;
        }
        return any;
      }
      case 'missions': {
        const secs = n * 3600;
        const missions = sm.state.activeMissions;
        if (!missions.length) return false;
        // Like an accelerator: a pending radio call is never jumped over.
        sm.applyDelta({
          path: 'activeMissions',
          value: missions.map(m => {
            if (m.waiting) return m;
            const stop = m.event && !m.event.choice && m.progress < m.total * m.event.at ? m.total * m.event.at : m.total;
            return { ...m, progress: Math.min(stop, m.progress + secs) };
          }),
        });
        return true;
      }
      case 'arrival': {
        // The next newcomer knocks sooner; with no free bed they would only wait at the door, so nothing happens.
        const state = sm.state;
        const now = state.stats.totalPlayTime;
        if (state.survivors.length >= state.maxPopulation || state.nextArrivalAt <= now) return false;
        sm.applyDelta({ path: 'nextArrivalAt', value: Math.max(now, state.nextArrivalAt - n * 60) });
        return true;
      }
      case 'fill': {
        let any = false;
        for (const [r, res] of Object.entries(sm.state.resources) as [ResourceType, { amount: number; cap: number }][]) {
          if (!Number.isFinite(res.cap) || res.amount >= res.cap) continue;
          sm.applyDelta({ path: `resources.${r}.amount`, value: res.cap });
          any = true;
        }
        return any;
      }
    }
  }
}

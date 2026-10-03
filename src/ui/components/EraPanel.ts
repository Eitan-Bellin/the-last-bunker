import type { GameState } from '../../core/GameState';
import { i18n } from '../../i18n/I18nManager';
import { ERAS, eraOf, type EraDef } from '../../data/eras';
import { Sheet } from './Sheet';
import { bar, button, el, setBar } from '../dom';

/** Where the bunker stands in its story, and what it takes to reach the next era. */
export class EraPanel {
  private sheet = new Sheet('era-sheet');
  private signature = '';
  private bars: HTMLElement[] = [];
  private labels: HTMLElement[] = [];
  /** [LateGame B1] Opens the big projects panel. */
  onOpenProjects: (() => void) | null = null;

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
    const sig = `${era.id}|${i18n.currentLocale}`;
    if (sig !== this.signature) {
      this.signature = sig;
      this.render(era);
    }
    era.next.forEach((g, i) => {
      const [c, t] = g.progress(state);
      setBar(this.bars[i], (Math.min(c, t) / t) * 100);
      if (this.labels[i]) this.labels[i].textContent = t > 1 ? `${Math.min(c, t)}/${t}` : c >= t ? '✓' : '';
    });
  }

  private render(era: EraDef): void {
    const locale = i18n.currentLocale;
    this.sheet.setTitle(`[[flag]] ${i18n.t('era.title')}`);
    const root = el('div', 'era');
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

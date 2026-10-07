import { i18n } from '../i18n/I18nManager';
import { el } from './dom';
import type { Modal } from './components/Modal';

/**
 * [plan4:UX-10] Every dialog that opens by itself (welcome, memorial, raid result, danger prompt, events, expedition questions and
 * reports, chapters, "new system" cards, finds, a district that broke through) is a source here. Each has an explicit priority
 * (the old fixed chain's order, so the first half hour plays exactly as before) and a snooze. One dialog at a time; the gate
 * (GameApp.dialogGate) decides when a dialog may land, and three or more waiting ones fold into one "N things are waiting" card
 * instead of stacking up one after another.
 */
export interface DialogSource {
  id: string;
  /** Higher goes first. */
  priority: number;
  /** How long "Later" holds this source back. */
  snoozeMs: number;
  /** Emergencies (a countdown is running) ignore an open sheet; they still wait for a gesture, a placement or a ceremony to end. */
  critical?: boolean;
  /** Something is waiting from this source (no side effects). */
  ready: () => boolean;
  /** Opens the dialog (the source consumes its own queue entry). */
  open: () => void;
  icon: string;
  /** One line for the "N waiting" card. */
  label: () => string;
}

/** Folded cards only apply after the guided first half hour (play seconds), which keeps that stretch unchanged. */
const FOLD_AFTER_PLAY_S = 1800;
const FOLD_AT = 3;

export class DialogQueue {
  private snoozedUntil = new Map<string, number>();
  /** The player pressed "Open them" on the folded card: no new folded card until the pile is down again. */
  private working = false;
  /** How many sources are waiting right now (for tests and the HUD chip, if ever). */
  waiting = 0;
  /** Last decision, for debugging: 'open:<id>' | 'blocked' | 'fold' | 'idle'. */
  lastDecision = 'idle';

  private readonly sources: DialogSource[];
  private readonly modal: Modal;
  private readonly gate: (critical: boolean) => boolean;
  private readonly playSeconds: () => number;

  constructor(sources: DialogSource[], modal: Modal, gate: (critical: boolean) => boolean, playSeconds: () => number) {
    this.sources = [...sources].sort((a, b) => b.priority - a.priority);
    this.modal = modal;
    this.gate = gate;
    this.playSeconds = playSeconds;
  }

  /** The sources with something to say right now and not snoozed, best first. */
  pending(now = performance.now()): DialogSource[] {
    return this.sources.filter(s => (this.snoozedUntil.get(s.id) ?? 0) <= now && s.ready());
  }

  /** Called every frame while no dialog is on screen. Opens at most one. */
  update(now = performance.now()): void {
    const list = this.pending(now);
    this.waiting = list.length;
    if (list.length === 0) {
      this.working = false;
      this.lastDecision = 'idle';
      return;
    }
    const top = list[0];
    if (!this.gate(!!top.critical)) {
      this.lastDecision = 'blocked';
      return;
    }
    const soft = list.filter(s => !s.critical);
    if (!top.critical && !this.working && soft.length >= FOLD_AT && this.playSeconds() > FOLD_AFTER_PLAY_S) {
      this.lastDecision = 'fold';
      this.showFolded(soft, now);
      return;
    }
    if (soft.length < FOLD_AT) this.working = false;
    this.lastDecision = `open:${top.id}`;
    top.open();
  }

  /** One card for the whole pile: what waits, "start" (one by one, most important first) or "later". */
  private showFolded(soft: DialogSource[], now: number): void {
    const body = el('div', 'dq-fold');
    body.appendChild(el('p', 'modal-body', i18n.t('dq.body', { n: soft.length })));
    const ul = el('ul', 'dq-list');
    for (const s of soft.slice(0, 6)) ul.appendChild(el('li', '', `${s.icon} ${s.label()}`));
    if (soft.length > 6) ul.appendChild(el('li', 'dq-more', i18n.t('dq.more', { n: soft.length - 6 })));
    body.appendChild(ul);
    this.modal.show({
      icon: '[[inbox]]',
      title: i18n.t('dq.title', { n: soft.length }),
      body,
      actions: [
        { label: i18n.t('dq.start'), className: 'btn-primary', onClick: () => { this.working = true; this.modal.hide(); soft[0].open(); } },
        {
          label: i18n.t('dq.later'), className: 'btn-secondary',
          onClick: () => { for (const s of soft) this.snoozedUntil.set(s.id, now + s.snoozeMs); this.modal.hide(); },
        },
      ],
    });
  }

  /** "Later" for a single source (used by dialogs that offer to wait). */
  snooze(id: string, ms: number): void {
    this.snoozedUntil.set(id, performance.now() + ms);
  }
}

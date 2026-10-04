import { i18n } from '../../i18n/I18nManager';
import { bus } from '../../core/EventBus';
import { el, costRow } from '../../ui/dom';
import { Sheet } from '../../ui/components/Sheet';
import { eventDeadline, type EventExpired } from '../../systems/EventSystem';
import { inboxKind } from '../../systems/InboxSystem';
import type { GameState } from '../../core/GameState';
import type { InboxItem } from '../../core/state/longGame';
import type { GameApp } from '../../app';
import { EVENT_ICONS } from './events';

/** One card in the inbox: something waiting for the player's answer or attention. */
interface Entry {
  key: string;
  icon: string;
  title: string;
  /** Seconds left before the safe default is taken (null = it waits). */
  left: number | null;
  urgent: boolean;
  open: () => void;
}

/**
 * The Decision Inbox (long game, UX): after the first era, events, expedition questions and reports no longer jump
 * onto the screen. They wait here as cards (with a deadline and a safe default where one exists), the HUD shows how many,
 * and only real emergencies (raids, disasters, the memorial) and story chapters still open by themselves.
 * During the Remnant the old behaviour stays: the first half hour is guided by those dialogs.
 */
export class InboxController {
  private app: GameApp;
  private sheet: Sheet | null = null;
  /** Cards already announced with a toast (by key), so each one is announced once. */
  private seen = new Set<string>();
  private lastCount = -1;

  constructor(app: GameApp) {
    this.app = app;
  }

  install(): void {
    this.app.hud.onInbox = () => {
      this.app.audio.play('click');
      const wasOpen = this.sheet?.isVisible;
      this.app.closeSheets();
      if (!wasOpen) this.show();
    };
    bus.on('event:expired', (e: unknown) => {
      const x = e as EventExpired;
      const params = this.app.events.eventParams(x.data);
      this.app.toasts.show(`[[clock]] ${i18n.t('inbox.expired', { name: i18n.t(`event.${x.id}.title`, params), choice: i18n.t(`event.${x.id}.choice.${x.key}`, params) })}`, 'info');
    });
    bus.on('inbox:expired', (it: unknown) => {
      const item = it as InboxItem;
      const def = inboxKind(item.kind);
      if (def) this.app.toasts.show(`[[clock]] ${i18n.t('inbox.expiredItem', { name: i18n.t(def.title, this.params(item)) })}`, 'info');
    });
  }

  /** True once the inbox takes over from pop-up dialogs (after the Remnant, the guided first era). */
  defers(state: GameState): boolean {
    return (state.era ?? 0) >= 1;
  }

  /** Should the event on the table open by itself? Raids and other never-expiring events always do. */
  autoOpenEvent(state: GameState): boolean {
    const ev = state.activeEvent;
    return !!ev && (!this.defers(state) || eventDeadline(ev) === null);
  }

  entries(state: GameState): Entry[] {
    const out: Entry[] = [];
    const now = state.stats.totalPlayTime;
    const ev = state.activeEvent;
    if (ev) {
      const params = this.app.events.eventParams(ev.data);
      const due = eventDeadline(ev);
      out.push({
        key: `event:${ev.id}:${ev.at ?? 0}`, icon: EVENT_ICONS[ev.id] ?? '[[warning]]', title: i18n.t(`event.${ev.id}.title`, params),
        left: due === null ? null : Math.max(0, due - now), urgent: due === null,
        open: () => this.app.events.showEvent(),
      });
    }
    for (const m of state.activeMissions) {
      if (!m.waiting) continue;
      out.push({ key: `mission:${m.id}`, icon: '[[radioTower]]', title: i18n.t('inbox.missionAsks'), left: null, urgent: false, open: () => this.app.events.showMissionChoice(m) });
    }
    for (const r of state.missionReports) {
      out.push({ key: `report:${r.id}`, icon: r.success ? '[[map]]' : '[[skull]]', title: i18n.t(r.success ? 'inbox.reportOk' : 'inbox.reportBad'), left: null, urgent: false, open: () => this.app.events.showMissionReport(r) });
    }
    const worldT = state.longGame?.meta.worldT ?? 0;
    for (const item of state.longGame?.inbox.items ?? []) {
      const def = inboxKind(item.kind);
      if (!def) continue;
      out.push({
        key: `item:${item.id}`, icon: def.icon, title: i18n.t(def.title, this.params(item)),
        left: item.deadline === null ? null : Math.max(0, item.deadline - worldT), urgent: item.urgent,
        open: () => this.openItem(item.id),
      });
    }
    // Most pressing first: urgent, then the nearest deadline, then the rest in arrival order.
    return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.left ?? Infinity) - (b.left ?? Infinity));
  }

  /** Called a few times a second: keeps the HUD count and the open list current, and announces new cards once. */
  refresh(state: GameState): void {
    const deferring = this.defers(state);
    const list = deferring ? this.entries(state) : [];
    if (list.length !== this.lastCount) {
      this.lastCount = list.length;
      this.app.hud.setInbox(deferring, list.length);
    }
    for (const e of list) {
      if (this.seen.has(e.key)) continue;
      this.seen.add(e.key);
      this.app.audio.play('paper');
      this.app.toasts.show(`[[inbox]] ${i18n.t('inbox.new', { name: e.title })}`, 'info');
    }
    if (this.sheet?.isVisible) this.render(list);
  }

  get isVisible(): boolean {
    return !!this.sheet?.isVisible;
  }

  hide(): void {
    this.sheet?.hide();
  }

  show(): void {
    this.sheet ??= new Sheet('inbox-sheet');
    this.sheet.setTitle(`[[inbox]] ${i18n.t('inbox.title')}`);
    this.render(this.entries(this.app.state));
    this.sheet.show();
  }

  private renderedKey = '';

  private render(list: Entry[]): void {
    if (!this.sheet) return;
    // Rebuild only when the cards change; the time left is updated in place.
    const key = list.map(e => e.key).join('|');
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      const body = this.sheet.body;
      body.replaceChildren();
      if (list.length === 0) {
        body.appendChild(el('p', 'inbox-empty', i18n.t('inbox.empty')));
        return;
      }
      for (const e of list) {
        const card = el('button', `inbox-card${e.urgent ? ' urgent' : ''}`);
        card.dataset.key = e.key;
        card.append(el('span', 'inbox-icon', e.icon), el('span', 'inbox-title', e.title), el('span', 'inbox-left'));
        card.addEventListener('click', () => {
          this.app.audio.play('click');
          this.sheet?.hide();
          e.open();
        });
        body.appendChild(card);
      }
    }
    for (const e of list) {
      const left = this.sheet.body.querySelector<HTMLElement>(`.inbox-card[data-key="${e.key}"] .inbox-left`);
      if (!left) continue;
      const text = e.left === null ? i18n.t('inbox.waits') : i18n.t('inbox.left', { t: i18n.formatDuration(e.left) });
      if (left.textContent !== text) left.textContent = text;
      left.classList.toggle('soon', e.left !== null && e.left < 120);
    }
  }

  private params(item: InboxItem): Record<string, string> {
    return Object.fromEntries(Object.entries(item.data).map(([k, v]) => [k, String(v)]));
  }

  /** A card of the inbox's own (posted by a newer system): its text and choices in a dialog. */
  private openItem(id: number): void {
    const state = this.app.state;
    const item = state.longGame?.inbox.items.find(i => i.id === id);
    const def = item ? inboxKind(item.kind) : undefined;
    if (!item || !def) return;
    const params = this.params(item);
    const choices = def.choices(item, state);
    const sys = this.app.engine.inboxSystem;
    this.app.modal.show({
      icon: def.icon,
      title: i18n.t(def.title, params),
      body: i18n.t(def.body, params),
      actions: [
        ...choices.map((c, i) => ({
          label: i18n.t(c.label, params),
          className: i === 0 ? 'btn-primary' : 'btn-secondary',
          disabled: !!c.cost && !this.app.engine.resourceSystem.canAfford(state, c.cost),
          detail: c.cost ? costRow(state, c.cost) : undefined,
          onClick: () => {
            this.app.modal.hide();
            if (sys.resolve(id, c.key)) this.app.engine.requestSave();
          },
        })),
        { label: i18n.t('inbox.later'), className: 'btn-secondary', onClick: () => this.app.modal.hide() },
      ],
    });
  }
}

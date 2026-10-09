import { i18n } from '../../i18n/I18nManager';
import { bus } from '../../core/EventBus';
import { button, el, costRow } from '../../ui/dom';
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
  /** [Q4] What it asks and what it pays, under the title. */
  detail?: string;
  /** [Q4] How much it is worth (richest first among cards of the same urgency). */
  value?: number;
  /** [Q4] A contract that costs nothing the bunker would miss. */
  safe?: boolean;
  /** Seconds left before the safe default is taken (null = it waits). */
  left: number | null;
  urgent: boolean;
  /** [plan4:GP-1] Shown in place of the time left (the daily orders card: "1/3"). */
  tag?: string;
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
  /**
   * [ux-wp4] B7: a card was opened from the inbox. Once its dialog has come and gone (answered, or put off with "Later"), the inbox opens
   * again on the next card instead of dropping the player back to the bunker. Dropped when the card led somewhere else (a sheet).
   */
  private resume: { at: number; sawDialog: boolean } | null = null;

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

  /** True once the inbox takes over from pop-up dialogs. */
  defers(state: GameState): boolean {
    // From Act II (the first Act is guided by dialogs); a state without the long game falls back to the era.
    return (state.longGame?.meta.act ?? ((state.era ?? 0) >= 1 ? 2 : 1)) >= 2;
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
        detail: def.preview?.(item, i18n.currentLocale), value: def.value?.(item),
        safe: item.kind === 'contract' && this.app.engine.contractSystem.isSafe(state, item),
        left: item.deadline === null ? null : Math.max(0, item.deadline - worldT), urgent: item.urgent,
        open: () => this.openItem(item.id),
      });
    }
    // [plan4:GP-1] The daily orders: one card, always (the badge counts it only while something can be taken).
    const daily = this.app.daily.inboxEntry(state);
    if (daily) {
      const s = this.app.engine.dailySystem.summary(state);
      out.push({ key: 'daily', icon: '[[target]]', title: i18n.t('daily.title'), detail: `${daily.title} · ${daily.detail}`, tag: `${s.done}/${s.n}`, value: Infinity, left: null, urgent: false, open: () => this.app.daily.show() });
    }
    // [Q4] Most pressing first: urgent, then whatever lapses within the hour, then the richest, then the nearest deadline.
    const soon = (e: Entry) => e.left !== null && e.left < 3600;
    return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || Number(soon(b)) - Number(soon(a))
      || (b.value ?? 0) - (a.value ?? 0) || (a.left ?? Infinity) - (b.left ?? Infinity));
  }

  /** Called a few times a second: keeps the HUD count and the open list current, and announces new cards once. */
  refresh(state: GameState): void {
    const deferring = this.defers(state);
    const list = deferring ? this.entries(state) : [];
    // [plan4:GP-1] The daily orders card is a standing card: it counts on the badge only while a reward waits, and is never announced.
    const waiting = list.filter(e => e.key !== 'daily' || this.app.engine.dailySystem.summary(state).claimable > 0).length;
    if (waiting !== this.lastCount) {
      this.lastCount = waiting;
      this.app.hud.setInbox(deferring, waiting);
    }
    for (const e of list) {
      if (e.key === 'daily') continue;
      if (this.seen.has(e.key)) continue;
      this.seen.add(e.key);
      this.app.audio.play('paper');
      this.app.toasts.show(`[[inbox]] ${i18n.t('inbox.new', { name: e.title })}`, 'info');
    }
    if (this.sheet?.isVisible) this.render(list);
    if (this.resume) this.checkResume(waiting);
  }

  /** [ux-wp4] B7: see `resume`. */
  private checkResume(waiting: number): void {
    const r = this.resume!;
    const app = this.app;
    if (app.modal.isVisible) { r.sawDialog = true; return; }
    if (!r.sawDialog) {
      if (performance.now() - r.at > 2500) this.resume = null;
      return;
    }
    this.resume = null;
    if (waiting <= 0 || app.anyPanelOpen() || app.placementMode || app.storyOpen || app.welcomeOpen || app.introPlaying) return;
    this.show();
  }

  get isVisible(): boolean {
    return !!this.sheet?.isVisible;
  }

  hide(): void {
    this.sheet?.hide();
  }

  show(): void {
    this.sheet ??= new Sheet('inbox-sheet', 'inbox');
    this.sheet.setTitle(`[[inbox]] ${i18n.t('inbox.title')}`);
    this.render(this.entries(this.app.state));
    this.sheet.show();
  }

  private renderedKey = '';

  private render(list: Entry[]): void {
    if (!this.sheet) return;
    // Rebuild only when the cards change; the time left is updated in place.
    const key = list.map(e => `${e.key}${e.safe ? '+' : ''}${e.tag ?? ''}`).join('|');
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      const body = this.sheet.body;
      body.replaceChildren();
      if (list.length === 0) {
        body.appendChild(el('p', 'inbox-empty', i18n.t('inbox.empty')));
        return;
      }
      // [Q4] One tap for every contract that costs nothing the bunker would miss.
      const safeCount = list.filter(e => e.safe).length;
      if (safeCount >= 2) {
        body.appendChild(button(i18n.t('contract.acceptSafe', { n: safeCount }), 'btn-primary btn-small inbox-all', () => {
          const n = this.app.engine.contractSystem.acceptSafe();
          if (n > 0) {
            this.app.engine.requestSave();
            this.app.audio.play('click');
            this.app.toasts.show(`[[cart]] ${i18n.t('contract.safeTaken', { n })}`, 'good');
          }
        }));
      }
      for (const e of list) {
        const card = el('button', `inbox-card${e.urgent ? ' urgent' : ''}`);
        card.dataset.key = e.key;
        const main = el('span', 'inbox-title');
        main.appendChild(el('span', 'inbox-name', e.title));
        if (e.detail) main.appendChild(el('span', 'inbox-detail', e.detail));
        if (e.safe) main.appendChild(el('span', 'inbox-safe', i18n.t('contract.safe')));
        card.append(el('span', 'inbox-icon', e.icon), main, el('span', 'inbox-left'));
        card.addEventListener('click', () => {
          this.app.audio.play('click');
          this.sheet?.hide();
          this.resume = { at: performance.now(), sawDialog: false }; // [ux-wp4] B7
          e.open();
        });
        body.appendChild(card);
      }
    }
    for (const e of list) {
      const left = this.sheet.body.querySelector<HTMLElement>(`.inbox-card[data-key="${e.key}"] .inbox-left`);
      if (!left) continue;
      const text = e.tag ?? (e.left === null ? i18n.t('inbox.waits') : i18n.t('inbox.left', { t: i18n.formatDuration(e.left) }));
      if (left.textContent !== text) left.textContent = text;
      left.classList.toggle('soon', e.left !== null && e.left < 120);
    }
  }

  private params(item: InboxItem): Record<string, string> {
    const def = inboxKind(item.kind);
    if (def?.params) return def.params(item, i18n.currentLocale);
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
          disabled: c.available === false || (!!c.cost && !this.app.engine.resourceSystem.canAfford(state, c.cost)),
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

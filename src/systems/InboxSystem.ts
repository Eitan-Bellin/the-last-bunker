import type { StateManager } from '../core/StateManager';
import type { GameState } from '../core/GameState';
import type { InboxItem } from '../core/state/longGame';
import { bus } from '../core/EventBus';

/**
 * The Decision Inbox's own cards (the long game's newer systems post here instead of opening a dialog).
 * A kind says how its card reads and what each choice does; a card with a deadline takes its `fallback` choice when
 * the deadline (world time) passes, so a card is never lost and never decided worse than the safe default.
 */
export interface InboxChoice {
  key: string;
  /** i18n key of the button. */
  label: string;
  cost?: Record<string, number>;
}

export interface InboxKind {
  /** i18n keys of the card's title and text; the item's data fills their {placeholders}. */
  title: string;
  body: string;
  icon: string;
  choices(item: InboxItem, state: GameState): InboxChoice[];
  apply(item: InboxItem, key: string, sm: StateManager): void;
}

const kinds = new Map<string, InboxKind>();

export function registerInboxKind(kind: string, def: InboxKind): void {
  kinds.set(kind, def);
}

export function inboxKind(kind: string): InboxKind | undefined {
  return kinds.get(kind);
}

export interface PostOptions {
  data?: Record<string, unknown>;
  /** Seconds of world time to answer; omitted = no deadline. Ignored for destructive cards (`fallback` null). */
  deadlineIn?: number;
  fallback?: string | null;
  urgent?: boolean;
}

export class InboxSystem {
  private sm: StateManager;

  constructor(sm: StateManager) {
    this.sm = sm;
  }

  items(): InboxItem[] {
    return this.sm.state.longGame?.inbox.items ?? [];
  }

  post(kind: string, o: PostOptions = {}): InboxItem | null {
    const lg = this.sm.state.longGame;
    if (!lg || !kinds.has(kind)) return null;
    const now = lg.meta.worldT;
    const fallback = o.fallback ?? null;
    const item: InboxItem = {
      id: lg.inbox.seq + 1,
      kind,
      at: now,
      // A card with no safe default never runs out: it waits for the player.
      deadline: fallback !== null && o.deadlineIn ? now + o.deadlineIn : null,
      urgent: !!o.urgent,
      fallback,
      data: o.data ?? {},
    };
    this.sm.applyDeltas([
      { path: 'longGame.inbox.seq', value: item.id },
      { path: 'longGame.inbox.items', value: [...lg.inbox.items, item] },
    ]);
    bus.emit('inbox:posted', item);
    return item;
  }

  /** The player's answer. Returns false if the card is gone or the choice is not possible now. */
  resolve(id: number, key: string): boolean {
    const item = this.items().find(i => i.id === id);
    const def = item ? kinds.get(item.kind) : undefined;
    if (!item || !def) return false;
    const choice = def.choices(item, this.sm.state).find(c => c.key === key);
    if (!choice) return false;
    if (choice.cost) {
      for (const [r, v] of Object.entries(choice.cost)) {
        if ((this.sm.state.resources[r as keyof GameState['resources']]?.amount ?? 0) < v) return false;
      }
      for (const [r, v] of Object.entries(choice.cost)) {
        const res = this.sm.state.resources[r as keyof GameState['resources']];
        this.sm.applyDelta({ path: `resources.${r}.amount`, value: res.amount - v });
      }
    }
    this.remove(id);
    def.apply(item, key, this.sm);
    bus.emit('inbox:resolved', item, key);
    return true;
  }

  /** Cards past their deadline take their safe default; cards of an unknown kind (an older build's) are dropped. */
  update(): void {
    const lg = this.sm.state.longGame;
    if (!lg || lg.inbox.items.length === 0) return;
    const now = lg.meta.worldT;
    for (const item of [...lg.inbox.items]) {
      if (!kinds.has(item.kind)) { this.remove(item.id); continue; }
      if (item.deadline === null || now < item.deadline || item.fallback === null) continue;
      if (this.resolve(item.id, item.fallback)) bus.emit('inbox:expired', item);
      else this.remove(item.id);
    }
  }

  private remove(id: number): void {
    const items = this.items().filter(i => i.id !== id);
    this.sm.applyDelta({ path: 'longGame.inbox.items', value: items });
  }
}

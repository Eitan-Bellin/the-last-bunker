import type { ToastKind } from './components/Toast';

/**
 * [plan5:UX-F] One place for "what happened": every message the game sends by itself lands here, whether or not it also became a
 * toast. Routine news (a room finished, someone levelled up, a ruin cleared) lands only here, so the screen stays quiet and nothing
 * is lost. The HUD's activity chip shows how many entries arrived since the player last looked (ActivitySheet).
 *
 * In memory only: it is the session's feed, not a save field (the welcome-back report covers the time away).
 */
export interface ActivityEntry {
  text: string;
  kind: ToastKind;
  /** Groups repeats: the same key again within DIGEST_MS bumps the newest entry's count instead of adding a line. */
  key: string;
  count: number;
  /** Says a folded group in one line ("3 survivors levelled up"); without it the line shows the latest text and "×n". */
  digest?: (n: number) => string;
  /** Wall clock (ms) of the first and the latest occurrence. */
  at: number;
  last: number;
}

const MAX_ENTRIES = 80;
const DIGEST_MS = 60_000;

export class ActivityLog {
  private list: ActivityEntry[] = [];
  private seenAt = Date.now();
  private listeners = new Set<() => void>();

  add(text: string, kind: ToastKind, key = text, digest?: (n: number) => string): void {
    const now = Date.now();
    const top = this.list[0];
    if (top && top.key === key && now - top.last < DIGEST_MS) {
      top.count++;
      top.text = top.digest ? top.digest(top.count) : text;
      top.kind = kind;
      top.last = now;
    } else {
      this.list.unshift({ text, kind, key, count: 1, at: now, last: now, digest });
      if (this.list.length > MAX_ENTRIES) this.list.length = MAX_ENTRIES;
    }
    this.emit();
  }

  /** Newest first. */
  get entries(): readonly ActivityEntry[] {
    return this.list;
  }

  /** Entries that arrived (or grew) since the player last opened the feed. */
  get unseen(): number {
    let n = 0;
    for (const e of this.list) if (e.last > this.seenAt) n++;
    return n;
  }

  /** Only the warnings among the unseen (the chip turns red for these). */
  get unseenBad(): number {
    let n = 0;
    for (const e of this.list) if (e.last > this.seenAt && (e.kind === 'bad' || e.kind === 'critical')) n++;
    return n;
  }

  isNew(e: ActivityEntry, since: number): boolean {
    return e.last > since;
  }

  /** The moment of the last look (ActivitySheet marks entries newer than this). */
  get lastSeen(): number {
    return this.seenAt;
  }

  markSeen(): void {
    this.seenAt = Date.now();
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

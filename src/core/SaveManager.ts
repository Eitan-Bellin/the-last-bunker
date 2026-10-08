import { get, set, del } from 'idb-keyval';
import { compressToBase64, compressToUTF16, decompressFromBase64, decompressFromUTF16 } from 'lz-string';
import { SAVE_VERSION, type GameState } from './GameState';

/**
 * Dev builds accept ?slot=<name> to play on a separate save (testing a fresh game
 * never touches the real one). Production always uses the main slot.
 */
function slotSuffix(): string {
  if (!import.meta.env.DEV) return '';
  const slot = new URLSearchParams(location.search).get('slot');
  return slot && /^[a-z0-9_-]{1,20}$/i.test(slot) ? `_${slot}` : '';
}

// The main save keeps its key and its format (LZ-compressed JSON, UTF-16): every older build and every save already on a phone stays readable.
const AUTO_SAVE_KEY = `lastbunker_auto${slotSuffix()}`;
const SAVE_SLOT_PREFIX = `lastbunker_slot${slotSuffix()}_`;
/** The autosave as it was when this session began: if a session ever goes wrong, the last good game is still here. */
const BACKUP_KEY = `${AUTO_SAVE_KEY}_bak`;
/** A copy of the main save taken every half hour of play (before it is overwritten). */
const ROLL_KEY = `${AUTO_SAVE_KEY}_roll`;
/** The game as it was right before the last "new game", "import", "Genesis" or "restore": the undo for those. */
const PREV_KEY = `${AUTO_SAVE_KEY}_prev`;
/** The raw text of a main save that could not be read: it is never thrown away, so it can still be inspected or repaired. */
const CORRUPT_KEY = `${AUTO_SAVE_KEY}_corrupt`;
/** Before a save is migrated to a newer format, its raw text is kept once under this key + its version (never overwritten). */
const PRE_MIGRATION_KEY = `${AUTO_SAVE_KEY}_v`;

const ROLL_EVERY_MS = 30 * 60_000;
const READ_RETRY_DELAYS = [0, 250, 700];
const WORKER_TIMEOUT_MS = 4000;

export type BackupKind = 'session' | 'rolling' | 'previous';
const BACKUP_KEYS: Record<BackupKind, string> = { session: BACKUP_KEY, rolling: ROLL_KEY, previous: PREV_KEY };

/** 'missing' = no save exists (a brand-new player); 'error' = the storage itself failed; 'corrupt' = a save exists but cannot be read. */
export type LoadStatus = 'ok' | 'missing' | 'error' | 'corrupt';

export interface LoadResult {
  status: LoadStatus;
  state: GameState | null;
  /** Set when the main save was unreadable and a backup was used instead. */
  recoveredFrom?: BackupKind;
}

export interface BackupInfo {
  kind: BackupKind;
  /** Wall-clock ms the backed-up game was last saved. */
  timestamp: number;
  era: number;
  people: number;
  playTime: number;
}

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

/** A parsed save must at least look like a game: older saves lack newer fields (migrateState fills them in), never these. */
function looksLikeSave(p: unknown): p is GameState {
  const s = p as Partial<GameState> | null;
  return !!s && typeof s === 'object' && !!s.resources && typeof s.resources === 'object' && Array.isArray(s.buildings) && Array.isArray(s.survivors);
}

function decode(raw: string | undefined | null): GameState | null {
  if (!raw) return null;
  try {
    const serialized = decompressFromUTF16(raw);
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    return looksLikeSave(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Whether the browser promised to keep the save (it may otherwise clear site data when the phone runs low on space or after weeks unused). */
export type PersistStatus = 'granted' | 'denied' | 'unsupported' | 'unknown';
let persistStatus: PersistStatus = 'unknown';

export function getPersistStatus(): PersistStatus {
  return persistStatus;
}

/** Asks the browser not to evict the game's storage. Call after a user gesture (some browsers ask the player). */
export async function ensurePersistentStorage(): Promise<PersistStatus> {
  try {
    const storage = navigator.storage;
    if (!storage?.persist || !storage.persisted) return (persistStatus = 'unsupported');
    if (await storage.persisted()) return (persistStatus = 'granted');
    return (persistStatus = (await storage.persist()) ? 'granted' : 'denied');
  } catch {
    return (persistStatus = 'unsupported');
  }
}

export class SaveManager {
  private worker: Worker | null | undefined;
  private pending = new Map<number, { resolve: (s: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private seq = 0;
  /** Saves go through one queue: they land in order, and a newer one replaces one still waiting. */
  private queued: string | null = null;
  private draining: Promise<void> | null = null;
  private drainError: unknown = null;
  private lastRoll = Date.now();

  // ---- saving ----

  /** Saves the game (already serialized with JSON.stringify). Resolves when it is stored; rejects when storage refused it. */
  saveJson(json: string, slot: 'auto' | number = 'auto'): Promise<void> {
    if (slot !== 'auto') return this.write(json, `${SAVE_SLOT_PREFIX}${slot}`);
    this.queued = json;
    this.draining ??= this.drain();
    return this.draining.then(() => {
      if (this.drainError) {
        const err = this.drainError;
        this.drainError = null;
        throw err;
      }
    });
  }

  private async drain(): Promise<void> {
    try {
      while (this.queued !== null) {
        const json = this.queued;
        this.queued = null;
        try {
          await this.maybeRoll();
          await this.write(json, AUTO_SAVE_KEY);
        } catch (err) {
          this.drainError = err;
        }
      }
    } finally {
      this.draining = null;
    }
  }

  private async write(json: string, key: string): Promise<void> {
    await set(key, await this.compress(json));
  }

  /** Every half hour the main save, as it stands, is copied aside before the new one replaces it. */
  private async maybeRoll(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRoll < ROLL_EVERY_MS) return;
    this.lastRoll = now;
    try {
      const current = await get<string>(AUTO_SAVE_KEY);
      if (current && decode(current)) await set(ROLL_KEY, current);
    } catch {
      // best effort: the main save is what matters
    }
  }

  /** Keeps the game as it is right now (call before anything that replaces it). Failure never blocks the action. */
  async snapshotPrev(json: string): Promise<boolean> {
    try {
      await set(PREV_KEY, await this.compress(json));
      return true;
    } catch {
      return false;
    }
  }

  // ---- loading ----

  private async getRaw(key: string): Promise<{ ok: true; raw: string | undefined } | { ok: false }> {
    for (const delay of READ_RETRY_DELAYS) {
      if (delay) await sleep(delay);
      try {
        return { ok: true, raw: await get<string>(key) };
      } catch {
        // storage hiccup: try again
      }
    }
    return { ok: false };
  }

  /**
   * Loads the main save and says exactly what happened. A failed read is NOT the same as "no save": the caller must not
   * start a new game over it (and so must not overwrite what may still be there).
   */
  async loadSafe(): Promise<LoadResult> {
    const main = await this.getRaw(AUTO_SAVE_KEY);
    if (!main.ok) return { status: 'error', state: null };
    if (main.raw !== undefined && main.raw !== null && main.raw !== '') {
      const state = decode(main.raw);
      if (state) {
        // A save from an older format: keep it exactly as it was, once, before the game migrates it.
        if ((state.version ?? 1) < SAVE_VERSION) await this.keepPreMigration(main.raw, state.version ?? 1);
        // Remember the game we just loaded fine (best effort, never blocks the start).
        void set(BACKUP_KEY, main.raw).catch(() => undefined);
        return { status: 'ok', state };
      }
      // Present but unreadable: keep the raw text for good, then fall back to the freshest backup.
      void set(CORRUPT_KEY, main.raw).catch(() => undefined);
      const rescued = await this.bestBackup();
      return rescued ? { status: 'ok', state: rescued.state, recoveredFrom: rescued.kind } : { status: 'corrupt', state: null };
    }
    // No main save. A surviving backup means the main one was lost (cleared storage, a bug): use it rather than starting over.
    const rescued = await this.bestBackup();
    return rescued ? { status: 'ok', state: rescued.state, recoveredFrom: rescued.kind } : { status: 'missing', state: null };
  }

  /** Stores the raw save under its old version's key, unless one is already there (the first copy is the true original). */
  private async keepPreMigration(raw: string, version: number): Promise<void> {
    const key = `${PRE_MIGRATION_KEY}${version}`;
    try {
      if ((await get(key)) === undefined) await set(key, raw);
    } catch {
      // best effort: never block the start (the session and rolling backups still hold it)
    }
  }

  /** Legacy single-slot loader (kept for callers that only want the game or nothing). */
  async load(slot: 'auto' | number = 'auto'): Promise<GameState | null> {
    if (slot === 'auto') return (await this.loadSafe()).state;
    const raw = await this.getRaw(`${SAVE_SLOT_PREFIX}${slot}`);
    return raw.ok ? decode(raw.raw) : null;
  }

  /**
   * The backup to fall back on: the one with the most play behind it (a fresh "new game" taken right before a crash must not win over
   * the long game it replaced), and among equals the newest.
   */
  private async bestBackup(): Promise<{ kind: BackupKind; state: GameState } | null> {
    let best: { kind: BackupKind; state: GameState } | null = null;
    const played = (s: GameState) => s.stats?.totalPlayTime ?? 0;
    for (const kind of Object.keys(BACKUP_KEYS) as BackupKind[]) {
      const state = await this.readBackup(kind);
      if (!state) continue;
      if (!best || played(state) > played(best.state) || (played(state) === played(best.state) && (state.timestamp ?? 0) > (best.state.timestamp ?? 0))) best = { kind, state };
    }
    return best;
  }

  async readBackup(kind: BackupKind): Promise<GameState | null> {
    const r = await this.getRaw(BACKUP_KEYS[kind]);
    return r.ok ? decode(r.raw) : null;
  }

  /** The backups that exist and can be read, newest first (for the restore list in Settings). */
  async listBackups(): Promise<BackupInfo[]> {
    const out: BackupInfo[] = [];
    for (const kind of Object.keys(BACKUP_KEYS) as BackupKind[]) {
      const s = await this.readBackup(kind);
      if (!s) continue;
      out.push({ kind, timestamp: s.timestamp ?? 0, era: s.era ?? 0, people: s.survivors.length, playTime: s.stats?.totalPlayTime ?? 0 });
    }
    return out.sort((a, b) => b.timestamp - a.timestamp);
  }

  /** The unreadable save's raw text, if one was set aside (for "copy my data"). */
  async corruptCopy(): Promise<string | null> {
    const r = await this.getRaw(CORRUPT_KEY);
    return r.ok && r.raw ? r.raw : null;
  }

  /**
   * [plan4:qa] Recovery from a save that reads fine but crashes the game at start: the main save is kept as the "corrupt copy" (for
   * "copy my data") and removed, so the next start falls back to the freshest backup. With `everything` the backups go the same way
   * (copied aside first) and the next start is a new game, for the case where the backup carries the same fault.
   */
  async setAsideForRecovery(everything: boolean): Promise<void> {
    const main = await this.getRaw(AUTO_SAVE_KEY);
    if (main.ok && main.raw) await set(CORRUPT_KEY, main.raw);
    await del(AUTO_SAVE_KEY);
    if (!everything) return;
    for (const kind of Object.keys(BACKUP_KEYS) as BackupKind[]) {
      const r = await this.getRaw(BACKUP_KEYS[kind]);
      if (r.ok && r.raw) await set(`${CORRUPT_KEY}_${kind}`, r.raw);
      await del(BACKUP_KEYS[kind]);
    }
  }

  async deleteSave(slot: 'auto' | number): Promise<void> {
    const key = slot === 'auto' ? AUTO_SAVE_KEY : `${SAVE_SLOT_PREFIX}${slot}`;
    await del(key);
  }

  async hasSave(slot: 'auto' | number = 'auto'): Promise<boolean> {
    const key = slot === 'auto' ? AUTO_SAVE_KEY : `${SAVE_SLOT_PREFIX}${slot}`;
    try {
      return (await get(key)) !== undefined;
    } catch {
      return true; // can't tell: assume there is one so nothing is treated as a fresh install
    }
  }

  // ---- export / import (the player's own copy) ----

  exportSave(state: GameState): string {
    return compressToBase64(JSON.stringify(state));
  }

  /** Parses a pasted save string; returns null for anything that isn't a valid save. */
  importSave(data: string): GameState | null {
    try {
      const serialized = decompressFromBase64(data.trim());
      if (!serialized) return null;
      const parsed: unknown = JSON.parse(serialized);
      return looksLikeSave(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  // ---- compression (off the main thread when a worker is available) ----

  private getWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    this.worker = null;
    try {
      if (typeof Worker === 'undefined') return null;
      const w = new Worker(new URL('./saveWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; out?: string; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        clearTimeout(p.timer);
        if (typeof e.data.out === 'string') p.resolve(e.data.out);
        else p.reject(new Error(e.data.error ?? 'worker failed'));
      };
      w.onerror = () => this.dropWorker();
      this.worker = w;
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  private dropWorker(): void {
    try { this.worker?.terminate(); } catch { /* already gone */ }
    this.worker = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('worker dropped'));
    }
    this.pending.clear();
  }

  private async compress(json: string): Promise<string> {
    const w = this.getWorker();
    if (w) {
      try {
        return await new Promise<string>((resolve, reject) => {
          const id = ++this.seq;
          const timer = setTimeout(() => {
            this.pending.delete(id);
            reject(new Error('worker timeout'));
          }, WORKER_TIMEOUT_MS);
          this.pending.set(id, { resolve, reject, timer });
          w.postMessage({ id, json });
        });
      } catch {
        this.dropWorker();
        this.worker = null; // do not try a broken worker again this session
      }
    }
    return compressToUTF16(json);
  }
}

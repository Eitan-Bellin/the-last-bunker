/**
 * Crash guard: keeps one bad frame from stopping the game, remembers what went wrong, and notices when the
 * previous session was killed while the player was playing (the browser reloads the tab: "it crashed and came back").
 *
 * - `logCrash` keeps the last few errors (and why) in localStorage, de-duplicated, so a report has something to show.
 * - A heartbeat records "alive and visible" every few seconds; a start that finds a heartbeat from a visible, unfinished
 *   session knows the last run died abnormally (out of memory, GPU process lost, ...). Two such deaths in an hour put the
 *   game in lite mode (lower resolution, no bloom, lighter audio) until the player picks a graphics level again.
 */

const LOG_KEY = 'lastbunker_crashlog';
const HEARTBEAT_KEY = 'lastbunker_hb';
const DEATHS_KEY = 'lastbunker_deaths';
const LITE_KEY = 'lastbunker_lite';
// [perf] Every 15 s (was 4): the write is synchronous (on Android a blocking disk write on the main thread) and samples the GPU texture list.
const HEARTBEAT_MS = 15000;
const MAX_LOG = 30;
const HOUR = 3_600_000;
/** Lite mode lasts this long, then the normal graphics return (closing the app by hand twice used to switch it on for good). */
const LITE_TTL = 3 * 24 * HOUR;

export interface CrashEntry {
  t: number;
  kind: string;
  msg: string;
  stack?: string;
  count: number;
  info?: Record<string, unknown>;
}

interface Heartbeat {
  t: number;
  visible: boolean;
  clean: boolean;
  info: Record<string, unknown>;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the guard just forgets
  }
}

let rawProbe: () => Record<string, unknown> = () => ({});

/** The probe reads half-built objects at start-up: it must never throw into the guard itself. */
function probe(): Record<string, unknown> {
  try {
    return rawProbe();
  } catch {
    return {};
  }
}
const recent = new Map<string, number>();

/** Records an error without ever throwing; the same message within 10 s only bumps the counter. */
export function logCrash(kind: string, err: unknown, info?: Record<string, unknown>): void {
  try {
    const e = err as { message?: unknown; stack?: unknown } | null;
    const msg = String(e?.message ?? err ?? 'unknown').slice(0, 300);
    const key = `${kind}|${msg}`;
    const now = Date.now();
    const last = recent.get(key) ?? 0;
    const log = read<CrashEntry[]>(LOG_KEY, []);
    const prev = log.find(x => x.kind === kind && x.msg === msg);
    if (now - last < 10_000) {
      if (prev) { prev.count++; write(LOG_KEY, log); }
      return;
    }
    recent.set(key, now);
    if (recent.size > 200) recent.clear();
    if (prev) {
      prev.count++;
      prev.t = now;
    } else {
      log.push({
        t: now, kind, msg, count: 1, info: { ...probe(), ...info },
        stack: typeof e?.stack === 'string' ? e.stack.split('\n').slice(0, 6).join('\n').slice(0, 700) : undefined,
      });
    }
    write(LOG_KEY, log.slice(-MAX_LOG));
    console.error(`[crashGuard] ${kind}:`, err);
  } catch {
    // never throw from the error handler
  }
}

export function crashLog(): CrashEntry[] {
  return read<CrashEntry[]>(LOG_KEY, []);
}

/** Plain-text report the player can paste into a message. */
export function crashReport(): string {
  const log = crashLog();
  const lines = [
    `The Last Bunker diagnostics ${new Date().toISOString()}`,
    `UA: ${navigator.userAgent}`,
    `Screen: ${innerWidth}x${innerHeight} @${devicePixelRatio}, cores ${navigator.hardwareConcurrency ?? '?'}, mem ${(navigator as { deviceMemory?: number }).deviceMemory ?? '?'} GB`,
    `Lite mode: ${isLiteMode()}`,
    `Now: ${JSON.stringify(probe())}`,
    '',
  ];
  for (const c of log.slice(-15)) {
    lines.push(`${new Date(c.t).toISOString()} [${c.kind}] x${c.count} ${c.msg}`);
    if (c.info) lines.push(`  ${JSON.stringify(c.info)}`);
    if (c.stack) lines.push(c.stack.split('\n').map(l => `  ${l}`).join('\n'));
  }
  return lines.join('\n');
}

let lite: boolean | null = null;

/** Cached: the renderer asks every frame. */
export function isLiteMode(): boolean {
  if (lite === null) {
    try {
      const v = localStorage.getItem(LITE_KEY);
      if (v === null) lite = false;
      else {
        // Older versions stored '1' with no time: that starts its countdown now.
        const since = v === '1' ? Date.now() : Number(v);
        if (v === '1') localStorage.setItem(LITE_KEY, String(since));
        lite = Number.isFinite(since) && Date.now() - since < LITE_TTL;
        if (!lite) {
          localStorage.removeItem(LITE_KEY);
          localStorage.removeItem(DEATHS_KEY);
        }
      }
    } catch {
      lite = false;
    }
  }
  return lite;
}

/** The player chose a graphics level by hand: lite mode is over. */
export function clearLiteMode(): void {
  lite = false;
  try {
    localStorage.removeItem(LITE_KEY);
    localStorage.removeItem(DEATHS_KEY);
  } catch {
    // nothing to clear
  }
}

export interface GuardStart {
  /** The previous session ended while visible and without a clean exit. */
  diedLastTime: boolean;
  /** Lite mode is on for this session (just switched on, or still on from before). */
  lite: boolean;
  /** Lite mode switched on right now, so the player can be told once. */
  liteJustEnabled: boolean;
}

/** Starts the heartbeat and the global error hooks. `info` is sampled into every record (memory, quality, ...). */
export function installCrashGuard(info: () => Record<string, unknown>): GuardStart {
  rawProbe = info;
  const prev = read<Heartbeat | null>(HEARTBEAT_KEY, null);
  let diedLastTime = false;
  let liteJustEnabled = false;
  if (prev && prev.visible && !prev.clean) {
    diedLastTime = true;
    logCrash('abnormal-exit', 'previous session ended while in the foreground', { ...prev.info, lastSeenAgoMin: Math.round((Date.now() - prev.t) / 60000) });
    const deaths = read<number[]>(DEATHS_KEY, []).filter(t => Date.now() - t < HOUR);
    deaths.push(Date.now());
    write(DEATHS_KEY, deaths);
    if (deaths.length >= 2 && !isLiteMode()) {
      try {
        localStorage.setItem(LITE_KEY, String(Date.now()));
        lite = true;
        liteJustEnabled = true;
      } catch {
        // can't persist
      }
    }
  }

  const beat = (clean: boolean) => write(HEARTBEAT_KEY, { t: Date.now(), visible: !document.hidden, clean, info: probe() } satisfies Heartbeat);
  beat(false);
  window.setInterval(() => { if (!document.hidden) beat(false); }, HEARTBEAT_MS);
  // Leaving (home button, app switch, closing) is not a crash, whatever the system does to the tab afterwards.
  document.addEventListener('visibilitychange', () => beat(document.hidden));
  window.addEventListener('pagehide', () => beat(true));
  window.addEventListener('pageshow', () => beat(false));

  window.addEventListener('error', ev => logCrash('error', ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', ev => logCrash('promise', ev.reason));
  return { diedLastTime, lite: isLiteMode(), liteJustEnabled };
}

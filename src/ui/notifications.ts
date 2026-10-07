/**
 * Local notifications (S6): "the team is home", "research done", "storage is full", "someone is at the door".
 * At most 3 a day, only while the game is in the background, and only after the player turned them on in Settings.
 *
 * The backend is a small interface so the web Notification API used now can be swapped for
 * Capacitor LocalNotifications in the app build (same schedule/cancel calls, real OS scheduling).
 */

import { webNotificationsHonest } from '../utils/platform';

export type NotifyKind = 'expedition' | 'research' | 'storage' | 'door' | 'danger';

export interface NotifyItem {
  kind: NotifyKind;
  /** Seconds from now. */
  inSeconds: number;
  title: string;
  body: string;
}

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface NotifyBackend {
  permission(): NotifyPermission;
  request(): Promise<boolean>;
  /** Shows the notice at the given time (epoch ms) if `allow()` still says yes then (the daily cap). */
  schedule(id: number, at: number, title: string, body: string, allow: () => boolean): void;
  cancelAll(): void;
}

/** Browser backend: timers keep running (throttled) in a hidden tab, so notices arrive while the game is in the background. */
class WebBackend implements NotifyBackend {
  private timers: ReturnType<typeof setTimeout>[] = [];

  permission(): NotifyPermission {
    // [plan4:UX-15] On iPhone the page and its timers are suspended within seconds of leaving, and Web Push needs a server: a switch
    // here would promise notices that never come. Only the native app (local notifications) can keep that promise.
    if (!webNotificationsHonest()) return 'unsupported';
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  }

  async request(): Promise<boolean> {
    if (typeof Notification === 'undefined' || !webNotificationsHonest()) return false;
    try {
      return (await Notification.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  schedule(id: number, at: number, title: string, body: string, allow: () => boolean): void {
    const timer = setTimeout(() => {
      // Only while the game is out of sight: in front of the player a toast does the job.
      if (!document.hidden || this.permission() !== 'granted' || !allow()) return;
      const opts: NotificationOptions = { body, tag: `lastbunker-${id}`, icon: `${import.meta.env.BASE_URL}icon-192.png` };
      // Mobile Chrome only shows notifications through the service worker; desktop accepts the plain constructor.
      void (navigator.serviceWorker?.getRegistration?.() ?? Promise.resolve(undefined))
        .then(async reg => {
          if (reg) await reg.showNotification(title, opts);
          else new Notification(title, opts);
        })
        .catch(() => undefined);
    }, Math.max(0, at - Date.now()));
    this.timers.push(timer);
  }

  cancelAll(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}

export const MAX_PER_DAY = 3;
const LOG_KEY = 'lastbunker_notify_log';
/** Too soon after leaving to be worth a ping. */
const MIN_DELAY = 20;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export class Notifier {
  private backend: NotifyBackend;

  constructor(backend: NotifyBackend = new WebBackend()) {
    this.backend = backend;
  }

  get permission(): NotifyPermission {
    return this.backend.permission();
  }

  /** On only when the player wants it and the system allows it. */
  isOn(wanted: boolean): boolean {
    return wanted && this.backend.permission() === 'granted';
  }

  /** Asks the system for permission (must come from a tap). */
  request(): Promise<boolean> {
    return this.backend.request();
  }

  /** Notices already shown today (counted per device). */
  sentToday(): number {
    try {
      const log = JSON.parse(localStorage.getItem(LOG_KEY) ?? 'null') as { day: string; n: number } | null;
      return log && log.day === today() ? log.n : 0;
    } catch {
      return 0;
    }
  }

  private markSent(): void {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify({ day: today(), n: this.sentToday() + 1 }));
    } catch {
      // storage blocked: the daily cap just can't be remembered across reloads
    }
  }

  /** Schedules the soonest notice of each kind, within what is left of today's budget. */
  plan(items: NotifyItem[]): number {
    this.cancel();
    const budget = MAX_PER_DAY - this.sentToday();
    if (budget <= 0) return 0;
    const seen = new Set<NotifyKind>();
    const picked = items
      .filter(i => isFinite(i.inSeconds) && i.inSeconds >= MIN_DELAY)
      .sort((a, b) => a.inSeconds - b.inSeconds)
      .filter(i => (seen.has(i.kind) ? false : (seen.add(i.kind), true)))
      .slice(0, budget);
    picked.forEach((i, n) => this.backend.schedule(n + 1, Date.now() + i.inSeconds * 1000, i.title, i.body, () => {
      // Re-checked at fire time: the day may have turned, or earlier notices used it up.
      if (this.sentToday() >= MAX_PER_DAY) return false;
      this.markSent();
      return true;
    }));
    return picked.length;
  }

  cancel(): void {
    this.backend.cancelAll();
  }
}

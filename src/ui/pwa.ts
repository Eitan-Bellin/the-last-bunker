/**
 * [plan4:UX-13, UX-14] The installed-app side of the game on a phone:
 *
 *  - The service worker's update flow. A new version no longer swaps itself in under a running game (that used to happen silently,
 *    and a home-screen app that is never fully closed kept running old code for days). The new worker waits; a small chip says
 *    "new version ready, tap to refresh"; the tap saves, lets the worker take over and reloads. The page re-checks for a new
 *    version whenever it comes back to the foreground, and every half hour while it stays open.
 *  - "Add to Home Screen" for iPhone Safari, once, after ten minutes of play. Honest about the catch: on iOS the home-screen app has
 *    its own, empty storage, so the card offers the backup file first.
 *  - A weekly "save a backup" reminder where the browser may clear site data (Safari) or has not promised to keep it.
 * Dialogs go through the dialog queue (UX-10), so they never land in the middle of a gesture.
 */
import { i18n } from '../i18n/I18nManager';
import { el } from './dom';
import type { Modal } from './components/Modal';
import type { DialogSource } from './dialogQueue';
import { isIOS, isIOSBrowserTab, isIOSSafari, isNative, isStandalone } from '../utils/platform';
import { getPersistStatus } from '../core/SaveManager';
import { isTouchDevice } from '../utils/device';
import { lowPowerSuspected, startPowerWatch } from '../utils/powerWatch';

const DAY_MS = 86_400_000;
const KEY_INSTALL = 'lastbunker_hint_install'; // JSON { seen: boolean, next: epoch ms, n: times shown }
const KEY_BACKUP_ASKED = 'lastbunker_hint_backup'; // epoch ms of the last reminder
export const KEY_LAST_EXPORT = 'lastbunker_last_export'; // epoch ms of the last backup the player made

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: the hint may come back, nothing breaks */ }
}

/** When the player last saved a backup file or copied the code (0 = never on this device). */
export function lastExportAt(): number {
  return Number(read(KEY_LAST_EXPORT)) || 0;
}
export function markExported(): void {
  write(KEY_LAST_EXPORT, String(Date.now()));
}

// ---------------------------------------------------------------------------------------------------------------------
// Service worker: register, notice a new version, apply it on the player's tap.
// ---------------------------------------------------------------------------------------------------------------------

let chip: HTMLButtonElement | null = null;

function showUpdateChip(onTap: () => void): void {
  if (!chip) {
    chip = el('button', 'notice-chip update-chip', `[[refresh]] ${i18n.t('pwa.updateReady')}`);
    chip.setAttribute('role', 'status');
    document.body.appendChild(chip);
    chip.addEventListener('click', () => {
      chip!.disabled = true;
      chip!.replaceChildren(el('span', '', `[[refresh]] ${i18n.t('pwa.updating')}`));
      onTap();
    });
  }
  requestAnimationFrame(() => chip?.classList.add('show'));
}

/** Which build a (waiting) worker carries, or '' when it does not answer (an old worker, or none in a second). */
function workerBuild(w: ServiceWorker): Promise<string> {
  return new Promise<string>(resolve => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(''), 1500);
    channel.port1.onmessage = ev => {
      window.clearTimeout(timer);
      resolve(typeof ev.data === 'string' ? ev.data : '');
    };
    try { w.postMessage({ type: 'build' }, [channel.port2]); } catch { window.clearTimeout(timer); resolve(''); }
  });
}

/**
 * Production builds only (a dev-mode worker would cache stale modules), and not inside the native shell (it ships its own files).
 * `save` is called before the page reloads for an update.
 */
export function initServiceWorker(save: () => Promise<void>): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || isNative()) return;
  const sw = navigator.serviceWorker;
  const pageBuild = document.querySelector('meta[name="build"]')?.getAttribute('content') ?? '';
  let applying = false;

  // The new worker took over after our tap: the page has to be the new one too. (Only after OUR tap: the very first install also
  // "takes control", and nobody asked for a reload then.)
  sw.addEventListener('controllerchange', () => {
    if (applying) location.reload();
  });

  const apply = async (w: ServiceWorker): Promise<void> => {
    applying = true;
    try { await save(); } catch { /* the periodic save still ran a moment ago */ }
    w.postMessage({ type: 'skipWaiting' });
    // If the takeover never reports back (the worker went away), a plain reload still fetches the new page: the network comes first.
    window.setTimeout(() => location.reload(), 5000);
  };

  const offer = async (w: ServiceWorker): Promise<void> => {
    const build = await workerBuild(w);
    if (build && pageBuild && build === pageBuild) {
      // The page already runs exactly this code (it arrived through the network while the old worker was still in charge): let the
      // worker in quietly, no reason to ask anybody to refresh.
      w.postMessage({ type: 'skipWaiting' });
      return;
    }
    showUpdateChip(() => void apply(w));
  };

  // [plan4:qa] initServiceWorker is called after two awaits in main.ts, so on a repeat visit `load` has already fired and a listener never ran:
  // register at once when the page is already loaded.
  const registerWorker = (): void => {
    sw.register('./sw.js').then(reg => {
      if (reg.waiting && sw.controller) void offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && sw.controller) void offer(w);
        });
      });
      // A home-screen app can sit in the background for days without being reloaded: ask for a new version when it comes back.
      const check = (): void => { reg.update().catch(() => undefined); };
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      window.setInterval(() => { if (!document.hidden) check(); }, 30 * 60_000);
    }).catch(console.error);
  };
  if (document.readyState === 'complete') registerWorker();
  else window.addEventListener('load', registerWorker);
}

// ---------------------------------------------------------------------------------------------------------------------
// Dialog sources: "Add to Home Screen" and the weekly backup reminder.
// ---------------------------------------------------------------------------------------------------------------------

export interface PwaContext {
  modal: Modal;
  /** [plan4:UX-24] Battery saver: is it on, and turn it on. */
  powerSaverOn: () => boolean;
  enablePowerSaver: () => void;
  /** Seconds of play so far. */
  playSeconds: () => number;
  /** Makes the backup file (share sheet on a phone). Resolves when it is done. */
  exportBackup: () => Promise<void>;
  /** Snoozes a source in the dialog queue (so "Later" holds). */
  snooze: (id: string, ms: number) => void;
}

interface InstallMemory { seen: boolean; next: number; n: number }

function installMemory(): InstallMemory {
  try {
    const m = JSON.parse(read(KEY_INSTALL) ?? 'null') as Partial<InstallMemory> | null;
    return { seen: !!m?.seen, next: Number(m?.next) || 0, n: Number(m?.n) || 0 };
  } catch {
    return { seen: false, next: 0, n: 0 };
  }
}

/** Safari in a tab, ten minutes in, not yet told (or asked to be reminded in 3 days, at most 3 times). */
export function installHintDue(playSeconds: number): boolean {
  if (!isIOSSafari() || !isIOSBrowserTab() || playSeconds < 600) return false;
  const m = installMemory();
  return !m.seen && m.n < 3 && Date.now() >= m.next;
}

/** Where the browser may throw the save away: Safari (tab or home-screen app) or any browser that did not promise to keep it. */
export function backupReminderDue(playSeconds: number): boolean {
  if (isNative() || playSeconds < 1200) return false;
  const risky = isIOS() || getPersistStatus() === 'denied';
  if (!risky) return false;
  const last = Math.max(lastExportAt(), Number(read(KEY_BACKUP_ASKED)) || 0);
  // Never asked and never saved: the clock starts now rather than nagging at the first opportunity.
  if (last === 0) { write(KEY_BACKUP_ASKED, String(Date.now())); return false; }
  return Date.now() - last >= 7 * DAY_MS;
}

function openInstallCard(ctx: PwaContext): void {
  const body = el('div', 'pwa-steps');
  body.appendChild(el('p', 'modal-body', i18n.t('pwa.installIntro')));
  const list = el('ol', 'pwa-list');
  for (const k of ['pwa.installStep1', 'pwa.installStep2', 'pwa.installStep3']) list.appendChild(el('li', '', i18n.t(k)));
  body.appendChild(list);
  const m = installMemory();
  const remember = (patch: Partial<InstallMemory>): void => write(KEY_INSTALL, JSON.stringify({ ...m, n: m.n + 1, ...patch }));
  ctx.modal.show({
    icon: '[[upload]]',
    title: i18n.t('pwa.installTitle'),
    body,
    actions: [
      { label: i18n.t('pwa.backupNow'), className: 'btn-primary', onClick: () => { void ctx.exportBackup(); } },
      { label: i18n.t('pwa.gotIt'), className: 'btn-secondary', onClick: () => { remember({ seen: true }); ctx.modal.hide(); } },
      { label: i18n.t('pwa.later'), className: 'btn-secondary', onClick: () => { remember({ next: Date.now() + 3 * DAY_MS }); ctx.snooze('installHint', 3 * DAY_MS); ctx.modal.hide(); } },
    ],
    onDismiss: () => { /* closed some other way (replaced): it simply comes back later */ },
  });
}

function openBackupCard(ctx: PwaContext): void {
  write(KEY_BACKUP_ASKED, String(Date.now()));
  ctx.modal.show({
    icon: '[[save]]',
    title: i18n.t('pwa.backupTitle'),
    body: i18n.t(isStandalone() ? 'pwa.backupBodyApp' : 'pwa.backupBody'),
    actions: [
      { label: i18n.t('pwa.backupNow'), className: 'btn-primary', onClick: () => { ctx.modal.hide(); void ctx.exportBackup(); } },
      { label: i18n.t('pwa.later'), className: 'btn-secondary', onClick: () => ctx.modal.hide() },
    ],
  });
}

const KEY_POWER_ASKED = 'lastbunker_hint_power'; // epoch ms of the last battery-saver suggestion

/** Touch device, saver off, and either the phone's rhythm looks like Low Power Mode or the player has been at it for a quarter of an hour. */
export function powerHintDue(ctx: PwaContext): boolean {
  if (!isTouchDevice() || ctx.powerSaverOn()) return false;
  const seconds = ctx.playSeconds();
  if (seconds < 120 || (!lowPowerSuspected() && seconds < 900)) return false;
  return Date.now() - (Number(read(KEY_POWER_ASKED)) || 0) > 7 * DAY_MS;
}

function openPowerCard(ctx: PwaContext): void {
  write(KEY_POWER_ASKED, String(Date.now()));
  ctx.modal.show({
    icon: '[[battery]]',
    title: i18n.t('power.title'),
    body: i18n.t(lowPowerSuspected() ? 'power.bodyLow' : 'power.body'),
    actions: [
      { label: i18n.t('power.turnOn'), className: 'btn-primary', onClick: () => { ctx.enablePowerSaver(); ctx.modal.hide(); } },
      { label: i18n.t('power.notNow'), className: 'btn-secondary', onClick: () => ctx.modal.hide() },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// [plan4:UX-17] A quiet, non-interactive note while the graphics are being restored after the GPU took the context away.
// ---------------------------------------------------------------------------------------------------------------------
let gfxNote: HTMLElement | null = null;
export function setGraphicsNotice(visible: boolean): void {
  if (visible && !gfxNote) {
    gfxNote = el('div', 'notice-chip gfx-note', `[[refresh]] ${i18n.t('gfx.restoring')}`);
    gfxNote.setAttribute('role', 'status');
    document.body.appendChild(gfxNote);
  }
  if (gfxNote) gfxNote.classList.toggle('show', visible);
}

/** Starts the 30 Hz watcher (touch devices only; it stops by itself once it has decided). */
export function startPhoneWatchers(): void {
  if (isTouchDevice()) startPowerWatch();
}

export function pwaDialogSources(ctx: PwaContext): DialogSource[] {
  return [
    {
      id: 'powerHint', priority: 4, snoozeMs: 7 * DAY_MS, icon: '[[battery]]',
      ready: () => powerHintDue(ctx),
      open: () => openPowerCard(ctx),
      label: () => i18n.t('power.title'),
    },
    {
      id: 'installHint', priority: 3, snoozeMs: 3 * DAY_MS, icon: '[[upload]]',
      ready: () => installHintDue(ctx.playSeconds()),
      open: () => openInstallCard(ctx),
      label: () => i18n.t('pwa.installTitle'),
    },
    {
      id: 'backupNudge', priority: 2, snoozeMs: DAY_MS, icon: '[[save]]',
      ready: () => backupReminderDue(ctx.playSeconds()),
      open: () => openBackupCard(ctx),
      label: () => i18n.t('pwa.backupTitle'),
    },
  ];
}

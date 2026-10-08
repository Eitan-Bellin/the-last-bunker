import { GameApp } from './app';
import { logCrash } from './core/crashGuard';
import { SaveManager } from './core/SaveManager';
import { i18n, type Locale } from './i18n/I18nManager';
import { applyTextSize } from './ui/textSize';
import { hideSplash } from './ui/splash';
import { installMaterials } from './ui/materials';
import { prefetchLazyChunks, whenIdle } from './utils/lazy';
import { initServiceWorker } from './ui/pwa';

applyTextSize();

// With ?debug, a Pixi "destroyed while still bound" warning also prints where it came from.
if (import.meta.env.DEV || location.search.includes('debug')) {
  const warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).includes('destroyed while still bound')) console.log('[pixi-trace]', new Error().stack?.split('\n').slice(2, 12).join(' <- '));
    warn(...args);
  };
}

/** A start that fails (no WebGL, assets that did not load) used to leave a black screen: say so, and offer a retry. */
function showStartupError(): void {
  hideSplash();
  if (document.getElementById('startup-error')) return;
  const box = document.createElement('div');
  box.id = 'startup-error';
  box.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;'
    + 'background:#0d0f1a;color:#e8e2d8;font:16px/1.5 Rubik,system-ui,sans-serif;text-align:center;padding:24px';
  const msg = document.createElement('div');
  msg.innerHTML = 'המשחק לא הצליח להיפתח.<br>ההתקדמות שלכם שמורה. נסו שוב.<br><small style="opacity:.7">The game could not start. Your progress is safe. Try again.</small>';
  const btn = document.createElement('button');
  btn.textContent = 'נסו שוב · Retry';
  btn.style.cssText = 'padding:12px 28px;border-radius:10px;border:1px solid #c9a24a;background:#2a2418;color:#f1d58a;font:inherit;cursor:pointer';
  btn.onclick = () => location.reload();
  box.append(msg, btn);
  // [plan4:qa] A save that loads but breaks the start used to be a dead end (Retry fails the same way every time). Two escape hatches, each
  // keeps a copy of what it sets aside: restore the freshest backup, or start a new game.
  const recover = (label: string, everything: boolean, ask: string): void => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:10px 22px;border-radius:10px;border:1px solid #555;background:#1b1b24;color:#cfc8bb;font:inherit;font-size:14px;cursor:pointer';
    b.onclick = () => {
      if (!window.confirm(ask)) return;
      new SaveManager().setAsideForRecovery(everything).catch(console.error).finally(() => location.reload());
    };
    box.appendChild(b);
  };
  recover('שחזור מגיבוי · Restore backup', false, 'לשחזר מהגיבוי האחרון? העותק הנוכחי יישמר בצד.\nRestore the latest backup? The current save is kept aside.');
  recover('משחק חדש · New game', true, 'להתחיל משחק חדש? כל הגיבויים יישמרו בצד ולא יימחקו.\nStart a new game? All saves are kept aside, not deleted.');
  document.body.appendChild(box);
}

function failed(err: unknown): void {
  console.error(err);
  logCrash('start', err);
  showStartupError();
}

/**
 * The game was Hebrew-only by default. Whoever already has a save keeps Hebrew (they have been playing in it); a brand-new
 * player gets the language of their device. Nobody who picked a language in Settings is touched.
 */
async function chooseDefaultLanguage(): Promise<void> {
  try {
    if (localStorage.getItem('lastbunker_lang')) return;
    const hasSave = await new SaveManager().hasSave();
    const device = (navigator.language || 'he').toLowerCase();
    i18n.storeLocale(hasSave || device.startsWith('he') ? 'he' : 'en');
  } catch {
    // storage blocked: the app falls back to Hebrew as before
  }
}

/** The two string tables are separate chunks in the production build (plan 4 wave 3, see i18n/locales.ts); in dev they are already linked in. */
const LOCALE_CHUNKS: Record<Locale, () => Promise<{ default: Record<string, string> }>> = {
  en: () => import('./i18n/en.json'),
  he: () => import('./i18n/he.json'),
};

async function fetchLocale(locale: Locale): Promise<boolean> {
  if (i18n.isLoaded(locale)) return true;
  try {
    i18n.provide(locale, (await LOCALE_CHUNKS[locale]()).default);
    return true;
  } catch (err) {
    console.warn('language file did not load', locale, err);
    return false;
  }
}

/**
 * The player's language is needed before the first screen is built, so it is awaited here. If it cannot be fetched (offline on a
 * first visit to a language that was never cached) the other language is used for this session instead of showing raw keys.
 * The language that is not in use is fetched later, when the page is idle: it is the fallback for a missing key, and having it in the
 * service worker's cache keeps the language switch (which reloads the page) working offline.
 */
async function loadLanguages(): Promise<void> {
  const want = i18n.storedLocale('he');
  if (!(await fetchLocale(want))) await fetchLocale(want === 'he' ? 'en' : 'he'); // GameApp then takes whichever table is there
}

function prefetchOtherLanguage(): void {
  whenIdle(() => { void fetchLocale(i18n.storedLocale('he') === 'he' ? 'en' : 'he'); });
}

async function boot(): Promise<void> {
  await chooseDefaultLanguage();
  await loadLanguages();
  installMaterials(); // plan 2026-10 M7: the worn-steel texture of the HUD plates
  const app = new GameApp();
  // [plan4:UX-14] Service worker with the "new version, tap to refresh" chip (production builds only); the tap saves first.
  initServiceWorker(() => app.engine.forceSave());
  await app.start();
  prefetchOtherLanguage();
  prefetchLazyChunks();
}

boot().catch(failed);

// (The service worker is registered by initServiceWorker in boot(): production builds only, because a dev-mode worker would cache stale modules.)

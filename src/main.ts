import { GameApp } from './app';
import { logCrash } from './core/crashGuard';
import { SaveManager } from './core/SaveManager';
import { i18n, type Locale } from './i18n/I18nManager';
import { applyTextSize } from './ui/textSize';
import { hideSplash } from './ui/splash';
import { installMaterials } from './ui/materials';
import { prefetchLazyChunks, whenIdle } from './utils/lazy';

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
  await new GameApp().start();
  prefetchOtherLanguage();
  prefetchLazyChunks();
}

boot().catch(failed);

// Only in production builds: a dev-mode service worker would cache stale modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  });
}

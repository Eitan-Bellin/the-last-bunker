import { GameApp } from './app';
import { logCrash } from './core/crashGuard';
import { SaveManager } from './core/SaveManager';
import { i18n } from './i18n/I18nManager';
import { applyTextSize } from './ui/textSize';
import { hideSplash } from './ui/splash';
import { installMaterials } from './ui/materials';
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

async function boot(): Promise<void> {
  await chooseDefaultLanguage();
  installMaterials(); // plan 2026-10 M7: the worn-steel texture of the HUD plates
  const app = new GameApp();
  // [plan4:UX-14] Service worker with the "new version, tap to refresh" chip (production builds only); the tap saves first.
  initServiceWorker(() => app.engine.forceSave());
  await app.start();
}

boot().catch(failed);

// (The service worker is registered by initServiceWorker in boot(): production builds only, because a dev-mode worker would cache stale modules.)

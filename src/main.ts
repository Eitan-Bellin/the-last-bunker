import { GameApp } from './app';
import { logCrash } from './core/crashGuard';

/** A start that fails (no WebGL, assets that did not load) used to leave a black screen: say so, and offer a retry. */
function showStartupError(): void {
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

try {
  new GameApp().start().catch(failed);
} catch (err) {
  failed(err);
}

// Only in production builds: a dev-mode service worker would cache stale modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  });
}

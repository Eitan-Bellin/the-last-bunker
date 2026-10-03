import { GameApp } from './app';

const app = new GameApp();
app.start().catch(console.error);

// Only in production builds: a dev-mode service worker would cache stale modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  });
}

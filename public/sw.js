// Offline support.
//  - The page: network first (so updates arrive), but a slow or dead connection falls back to the saved copy after a few seconds.
//  - Hashed build files (/assets/*): cache first, they never change under the same name.
//  - Everything else here (paintings, art tables, icons): shown from the cache at once and re-checked in the background (one cheap conditional
//    request per file per session), so a changed painting or table reaches players without anyone having to bump a version number.
// [plan4:UX-14] Updates: a new worker WAITS instead of taking over under a running game; the page shows "new version, tap to refresh"
// and then sends 'skipWaiting' (after saving). BUILD and PRECACHE are filled in by the vite plugin stampServiceWorker (vite.config.ts), so
// every build gives this file new bytes, which is what makes the browser notice an update at all. In dev they keep their placeholders.
const CACHE = 'lastbunker-v4';
const BUILD = '__BUILD_ID__';
const PRECACHE = /*__PRECACHE__*/[];
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './favicon-64.png'];
const NAVIGATE_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 'reload' skips the browser's own HTTP cache: the saved page must be the one that names THIS build's files (the old ones are pruned).
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    // The build's own files are kept one by one: one that fails (a flaky connection) must not stop the worker from installing.
    await Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => undefined)));
    // The very first install has no game to protect: take over at once. An update waits for the player's tap.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'skipWaiting' || (data && data.type === 'skipWaiting')) self.skipWaiting();
  // The page asks which build this worker carries (so it can tell a real update from the page's own code).
  if (data && data.type === 'build' && event.ports && event.ports[0]) event.ports[0].postMessage(BUILD);
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    // Build files of earlier versions are dead weight now (their names carry a hash).
    if (PRECACHE.length) {
      const cache = await caches.open(CACHE);
      const keep = new Set(PRECACHE.map((u) => new URL(u, self.registration.scope).href));
      for (const req of await cache.keys()) {
        if (new URL(req.url).pathname.includes('/assets/') && !keep.has(req.url)) await cache.delete(req);
      }
    }
    await self.clients.claim();
  })());
});

const revalidated = new Set();

function store(req, res) {
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone(); // cloned right now: later the page itself will have consumed the body
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
        }
        return res;
      });
      const cached = await caches.match('./index.html');
      if (!cached) return network;
      // A dead or very slow connection must not hold the game hostage: after a few seconds the saved page opens.
      const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NAVIGATE_TIMEOUT_MS));
      return Promise.race([network.catch(() => cached), timeout]);
    })());
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (!sameOrigin && !fonts) return;

  // Hashed files and fonts never change under their name.
  if (fonts || url.pathname.includes('/assets/')) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => store(req, res))));
    return;
  }

  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) {
      if (!revalidated.has(req.url)) {
        revalidated.add(req.url);
        // 'no-cache' = ask the server "has it changed?" (a tiny 304 when not).
        event.waitUntil(fetch(req, { cache: 'no-cache' }).then((res) => store(req, res)).catch(() => undefined));
      }
      return hit;
    }
    return fetch(req).then((res) => store(req, res));
  })());
});

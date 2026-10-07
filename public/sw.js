// Offline support.
//  - The page: network first (so updates arrive), but a slow or dead connection falls back to the saved copy after a few seconds.
//  - Hashed build files (/assets/*): cache first, they never change under the same name.
//  - Everything else here (paintings, art tables, icons): shown from the cache at once and re-checked in the background (one cheap conditional
//    request per file per session), so a changed painting or table reaches players without anyone having to bump a version number.
const CACHE = 'lastbunker-v4';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './favicon-64.png'];
const NAVIGATE_TIMEOUT_MS = 4000;

// Plan 4 wave 3: the build writes asset-manifest.json (every script and stylesheet, including the chunks fetched only on demand: the
// string tables, the Bunker Book, the sound recipes). Installing caches them all, so the game works offline after the first visit
// whatever the player has opened so far. Best effort: a missing manifest (dev server) or one failing file never blocks the install.
async function precacheBuild(cache) {
  try {
    const res = await fetch('./asset-manifest.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const files = await res.json();
    await Promise.all(files.map((f) => cache.add(f).catch(() => undefined)));
  } catch (err) {
    // offline or no manifest: the files are cached as they are used
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL).then(() => precacheBuild(cache))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
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

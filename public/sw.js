// Service worker for ETS2 Trucker Advisor — offline caching
// Strategy summary:
//   HTML          → network-first (users always get fresh pages)
//   JSON data     → network-first (game-defs.json / observations.json update with game patches)
//   CSS / images  → cache-first  (truly static, versioned by filename)
//   JS bundles    → cache-first  (Vite outputs content-hashed filenames; precaching would
//                                 require vite-plugin-pwa to track the manifest — out of scope)

const CACHE_NAME = 'trucker-cache-v2';
const BASE = '/trucker/';

// Pre-cache only truly static assets whose URLs never change between deploys.
// JSON data files are intentionally excluded — they use network-first so returning
// users always receive fresh data after a game update.
const PRECACHE_URLS = [
  BASE,
  BASE + 'index.html',
  BASE + 'cities.html',
  BASE + 'companies.html',
  BASE + 'cargo.html',
  BASE + 'trailers.html',
  BASE + 'dlcs.html',
  BASE + 'css/style.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Remove old cache versions
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));

      // Evict stale Vite JS bundles from the current cache.
      // Vite outputs content-hashed filenames (e.g. main-Ab3Cd4Ef.js), so each
      // deploy produces new URLs. Without cleanup the cache grows unboundedly with
      // bundles from previous deploys that will never be requested again.
      // HTML is served network-first, so on next load the page references new hashed
      // filenames; evicting all hashed JS here ensures those new filenames are fetched
      // fresh rather than hitting a mis-matched stale entry.
      const cache = await caches.open(CACHE_NAME);
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter((req) => new URL(req.url).pathname.match(/\/assets\/.*-[a-zA-Z0-9]{8,}\.js$/))
          .map((req) => cache.delete(req))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests under the base path
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) {
    return;
  }

  // Network-first for HTML pages (so users get fresh content)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Network-first for JSON data files — these change whenever game data is updated,
  // so returning users must receive the latest version rather than a stale cache.
  if (url.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for static assets (CSS, JS, images)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        // Cache successful GET responses for assets
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// Service worker for ETS2 Trucker Advisor — offline caching
// Cache-first for static assets (CSS, JS, JSON), network-first for HTML

const CACHE_NAME = 'trucker-cache-v1';
const BASE = '/trucker/';

// Assets to pre-cache on install
const PRECACHE_URLS = [
  BASE,
  BASE + 'index.html',
  BASE + 'cities.html',
  BASE + 'companies.html',
  BASE + 'cargo.html',
  BASE + 'trailers.html',
  BASE + 'dlcs.html',
  BASE + 'css/style.css',
  BASE + 'data/game-defs.json',
  BASE + 'data/observations.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Remove old cache versions
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
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

  // Cache-first for static assets (CSS, JS, JSON, images)
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

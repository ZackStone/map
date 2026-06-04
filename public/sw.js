/* Service Worker */
const APP_CACHE  = 'map-app-v1';
const TILE_CACHE = 'map-tiles-v1';

const APP_SHELL = ['./', './app.js', './seed.js', './sync.js', './style.css', './leaflet.js', './leaflet.css'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== APP_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Map tiles: cache-first
  const isTile = url.hostname.includes('arcgisonline') ||
                 url.hostname.includes('tile.openstreetmap') ||
                 url.hostname.includes('mt0.google') ||
                 url.hostname.includes('mt1.google') ||
                 url.hostname.includes('mt2.google') ||
                 url.hostname.includes('mt3.google');
  if (isTile) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached || new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // App shell: cache-first, fall back to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          caches.open(APP_CACHE).then(c => c.put(event.request, response.clone()));
        }
        return response;
      });
    })
  );
});

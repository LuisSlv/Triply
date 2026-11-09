// Offline support: the app itself is cached (served from cache, refreshed in the background),
// map tiles you've looked at are kept for offline use, and live data (search, routes) always
// goes to the network.
const VERSION = 'triply-v1';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/leaflet.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'js/app.js',
  'js/util.js',
  'js/store.js',
  'js/categories.js',
  'js/geo.js',
  'js/routing.js',
  'js/schedule.js',
  'js/links.js',
  'js/icons.js',
  'js/ui.js',
  'js/tracker.js',
  'js/mapview.js',
  'js/screens/home.js',
  'js/screens/about.js',
  'js/screens/wizard.js',
  'js/screens/trip.js',
];
const TILE_CACHE = 'triply-tiles';
const MAX_TILES = 2500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Network first (so updates show up immediately), cached copy when offline.
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const key = req.mode === 'navigate' ? 'index.html' : req;
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) cache.put(key, res.clone());
        return res;
      } catch {
        const hit = await cache.match(key, { ignoreSearch: true });
        return hit || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) {
          cache.put(req, res.clone());
          if (Math.random() < 0.05) e.waitUntil(trimTiles());
        }
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
  }
});

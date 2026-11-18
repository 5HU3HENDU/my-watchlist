// Service worker for the My Watchlist Lenses PWA (lenses.html).
// NARROW by design: it only handles the lens page's own URLs. Every other
// request — including Shiva's index.html and his numbered data files — is
// left alone: no respondWith is called, so the browser handles it exactly
// as if no worker existed.
// Strategy is NETWORK-FIRST for everything handled: a cached shell or
// cached data is never served when the network is available (an old cached
// JS + new HTML breaks the page). The cache is only an offline fallback.
// Cache name is versioned with the page version (v8) — bump it when the
// page version bumps, so a page update invalidates the old cache.
var CACHE = 'lenses-v8';
var ALLOW = [
  'lenses.html',
  'manifest.json',
  'icon-192.svg',
  'icon-512.svg',
  'icon-maskable.svg',
  'scripts/lenses-logic.js',
  'market-data.json',
  'fundamentals-v2.json',
  'weekly-prices.json',
  'sectors.json',
  'watchlist.json',
  'final-lists.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  // File path relative to this worker's directory (the repo root).
  var base = self.location.pathname.replace(/\/[^\/]*$/, '/').replace(/^\/+/, '');
  var path = url.pathname.replace(/^\/+/, '');
  if (path.indexOf(base) === 0) path = path.slice(base.length);
  if (ALLOW.indexOf(path) === -1) return; // not ours: pass through untouched
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () { return caches.match(e.request); })
  );
});

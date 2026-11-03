// Offline support. Serves the app from cache at once, then refreshes the cache in the background,
// so an update appears on the next launch. Bump CACHE when the file list changes.

const CACHE = 'diet-v1';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/calc.js',
  'js/charts.js',
  'js/db.js',
  'js/off.js',
  'js/rules.js',
  'js/scanner.js',
  'js/ui.js',
  'js/views/addFood.js',
  'js/views/coach.js',
  'js/views/settings.js',
  'js/views/stats.js',
  'js/views/today.js',
  'vendor/zxing.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Food database lookups go straight to the network.
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
      const refresh = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      });
      if (cached) {
        event.waitUntil(refresh.catch(() => {}));
        return cached;
      }
      return refresh;
    })
  );
});

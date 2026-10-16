// Recipe Box service worker — same approach as Hearth: open instantly from the
// cache, refresh in the background so the next launch has the latest deploy.
// Bump CACHE on every deploy that touches the shell files below.
const CACHE = 'recipe-box-v19';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/supabase-client.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// Third-party files that never change at a given URL (pinned supabase-js on
// jsDelivr, Google Fonts files) or change rarely (the fonts stylesheet).
// Caching them means a launch doesn't wait on a CDN round trip per module.
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the HTTP cache so a new version precaches fresh files,
  // not whatever GitHub Pages' 10-minute cache still holds.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function staleWhileRevalidate(event, cacheKey) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(cacheKey, { ignoreSearch: true });
  const network = fetch(event.request)
    .then((resp) => {
      // opaque (status 0) responses are fine to cache for CDN fonts
      if (resp && (resp.ok || resp.type === 'opaque')) cache.put(cacheKey, resp.clone());
      return resp;
    });
  if (cached) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  return network;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Every navigation is the one-page shell.
    const key = req.mode === 'navigate' ? './index.html' : req;
    e.respondWith(staleWhileRevalidate(e, key).catch(() => caches.match('./index.html')));
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(staleWhileRevalidate(e, req));
  }
  // Supabase API/auth/edge-function calls pass straight through.
});

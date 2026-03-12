const BUILD_HASH = 'naswar-dealer-v1';
const CACHE_NAME = 'app-' + BUILD_HASH;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.css',
  './constants.js',
  './business.js',
  './sync.js',
  './utilities.js',
  './factory.js',
  './customers.js',
  './rep-sales.js',
  './admin-data.js',
  './manifest.json',
  './192.png',
  './512.png'
];
const FIREBASE_CDN_URLS = [
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all([
        cache.addAll(ASSETS_TO_CACHE),
        ...FIREBASE_CDN_URLS.map(url =>
          cache.add(new Request(url, { mode: 'no-cors' })).catch(() => {})
        )
      ])
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }))
    ).then(() => clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => { caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone())); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (FIREBASE_CDN_URLS.includes(url.href)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
        caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
        return res;
      }))
    );
    return;
  }

  const isLocal = url.pathname.endsWith('.js') || url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json') || url.pathname.endsWith('.png') || url.pathname.endsWith('.webp');

  if (isLocal) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        fetch(event.request).then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        }).catch(() => cache.match(event.request))
      )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fresh = fetch(event.request).then((res) => {
        if (res.ok) caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
        return res;
      }).catch(() => null);
      return cached || fresh;
    })
  );
});

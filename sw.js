const BUILD_HASH = 'sarim-v1-20260325';
const CACHE_NAME = 'app-' + BUILD_HASH;

const ASSETS_TO_CACHE = [
  '/sarim/',
  '/sarim/index.html',
  '/sarim/app.css',
  '/sarim/constants.js',
  '/sarim/business.js',
  '/sarim/sync.js',
  '/sarim/utilities.js',
  '/sarim/factory.js',
  '/sarim/customers.js',
  '/sarim/rep-sales.js',
  '/sarim/admin-data.js',
  '/sarim/manifest.json',
  '/sarim/192.png',
  '/sarim/512.png',

  '/sarim/sql-wasm.js',
  '/sarim/sql-wasm.wasm',
  '/sarim/sql.js'
];
const FIREBASE_CDN_URLS = [
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://accounts.google.com/gsi/client',
];

const SQLJS_CDN_ORIGIN = 'https://cdnjs.cloudflare.com';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
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

self.addEventListener('sync', (event) => {
  if (event.tag === 'offline-queue-sync') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clientList) => {
        if (clientList.length > 0) {
          clientList.forEach((client) => client.postMessage({ type: 'PROCESS_QUEUE' }));
        }
      })
    );
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => { caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone())); return res; })
        .catch(() => caches.match('/sarim/index.html'))
    );
    return;
  }

  if (url.origin === SQLJS_CDN_ORIGIN && url.pathname.toLowerCase().includes('sql.js')) {
    return;
  }

  if (FIREBASE_CDN_URLS.includes(url.href)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  const isLocal = url.pathname.endsWith('.js') || url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json') || url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webp') || url.pathname.endsWith('.wasm');

  if (isLocal) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        fetch(event.request).then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        }).catch(() => cache.match(event.request, { ignoreMethod: true }))
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

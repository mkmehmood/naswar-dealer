const CACHE_NAME = 'naswar-dealer-v13';
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
          cache.add(new Request(url, { mode: 'no-cors' })).catch(() => {
            console.warn('[SW] Could not pre-cache Firebase SDK:', url);
          })
        )
      ])
    )
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) return caches.delete(key);
          })
        )
      )
    ]).then(() => {
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
      });
    })
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
        .then((networkResponse) => {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
          return networkResponse;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  const isFirebaseCDN = FIREBASE_CDN_URLS.includes(url.href);
  if (isFirebaseCDN) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
          return networkResponse;
        });
      })
    );
    return;
  }
  const isLocalAsset =
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webp');
  if (isLocalAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.ok) {
              const toStore = networkResponse.clone();
              cache.match(event.request).then((cached) => {
                const newEtag = networkResponse.headers.get('etag') ||
                                networkResponse.headers.get('last-modified');
                const oldEtag = cached
                  ? (cached.headers.get('etag') || cached.headers.get('last-modified'))
                  : null;
                if (!cached || (newEtag && newEtag !== oldEtag)) {
                  cache.put(event.request, toStore);
                  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
                    self.clients.matchAll({ type: 'window' }).then(clients => {
                      clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
                    });
                  }
                }
              });
            }
            return networkResponse;
          })
          .catch(() => cache.match(event.request))
      )
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse.ok) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
        }
        return networkResponse;
      }).catch(() => null);
      return cachedResponse || fetchPromise;
    })
  );
});

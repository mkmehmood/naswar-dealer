const CACHE_NAME = 'naswar-dealer-v3';
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'manifest.json',
  '192.png',
  '512.png'
];

// 1. Install & Offline Support
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => { if (key !== CACHE_NAME) return caches.delete(key); })
    ))
  );
  self.clients.claim();
});

// 2. Fetch Logic (Offline Support)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, response.clone());
          return response;
        });
      });
    }).catch(() => caches.match('index.html'))
  );
});

// 3. Background Sync (Logic for offline data submission)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-sales') {
    console.log('[SW] Background Syncing Sales...');
    // event.waitUntil(yourSyncFunction());
  }
});

// 4. Periodic Sync (Updates content in background)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-inventory') {
    console.log('[SW] Periodic Syncing Inventory...');
    // event.waitUntil(yourUpdateFunction());
  }
});

// 5. Push Notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.text() : 'New Update from Naswar Dealer';
  const options = {
    body: data,
    icon: '192.png',
    badge: '192.png'
  };
  event.waitUntil(self.registration.showNotification('Naswar Dealer', options));
});

// Notification Click Logic
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/naswar-dealer/'));
});

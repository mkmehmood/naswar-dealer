const CACHE_NAME = 'naswar-dealer-v17'; // IMPORTANT: Increment this (v4, v5...) every time you update code!
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './192.png',
  './512.png'
  // Add other local assets like css/js files here if they exist externally
];

// 1. Install & Offline Support
self.addEventListener('install', (event) => {
  // Force this new service worker to become the active one immediately
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 2. Activate & Clean Old Caches
self.addEventListener('activate', (event) => {
  // Take control of all open clients immediately
  event.waitUntil(clients.claim());
  
  // Delete old caches (e.g., delete v3 when v4 activates)
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[SW] Clearing old cache:', key);
          return caches.delete(key);
        }
      })
    ))
  );
});

// 3. Smart Fetch Strategy
self.addEventListener('fetch', (event) => {
  // A. For the Main Page (HTML): Network First, then Cache
  // This ensures the user always gets the latest index.html if online
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone()); // Update cache with new version
            return networkResponse;
          });
        })
        .catch(() => {
          return caches.match(event.request); // If offline, serve cached version
        })
    );
    return;
  }

  // B. For Assets (Images, CSS, JS): Stale-While-Revalidate
  // Serve cached version immediately for speed, but update cache in background
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
        });
        return networkResponse;
      }).catch(err => console.log('Asset fetch failed'));

      return cachedResponse || fetchPromise;
    })
  );
});

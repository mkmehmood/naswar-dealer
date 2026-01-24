const CACHE_NAME = 'naswar-v1';
const ASSETS = [
  '/naswar-dealer/',
  '/naswar-dealer/index.html',
  // Add other CSS or JS files here
];

// Install the service worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Cache and return requests
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

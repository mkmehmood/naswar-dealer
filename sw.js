const CACHE_NAME = 'naswar-dealer-v2';
const ASSETS_TO_CACHE = [
  '/naswar-dealer/',
  'index.html',
  'manifest.json',
  '192.png',
  '512.png',
  // External Libraries used in your HTML
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/dist/umd/supabase.js',
  // Fonts
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;600;700;800&family=Great+Vibes&family=Playfair+Display:wght@400;700&display=swap'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching all: app shell and content');
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[Service Worker] Removing old cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  // Strategy: Cache First, fall back to Network for assets
  // Network Only for Supabase API calls
  
  const url = new URL(event.request.url);

  // If it's a Supabase API call, go straight to network (don't cache data)
  if (url.hostname.includes('supabase.co')) {
    return; 
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      // Return cached response if found
      if (response) {
        return response;
      }
      
      // Otherwise, request from network
      return fetch(event.request).then((networkResponse) => {
        // Check if we received a valid response
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        // Clone the response
        const responseToCache = networkResponse.clone();

        caches.open(CACHE_NAME).then((cache) => {
          // Cache new requests dynamically (excluding API calls handled above)
          if (event.request.method === 'GET') {
             cache.put(event.request, responseToCache);
          }
        });

        return networkResponse;
      });
    })
  );
});

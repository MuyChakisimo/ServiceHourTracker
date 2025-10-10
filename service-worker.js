// A version string for your cache. This is how you update cached files.
const CACHE_NAME = 'service-time-tracker-v1.2.1';

// List of files to cache (the core shell of your app)
const urlsToCache = [
  './', 
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './favicon.ico',
  './images/icon-192.png',
  './images/icon-512.png',
  //'./images/icon-maskable.png'
];

// --- 1. INSTALLATION: Caching the App Shell ---
self.addEventListener('install', (event) => {
  // Wait until the promise is resolved before installing the service worker
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching app shell');
        return cache.addAll(urlsToCache);
      })
  );
});

// --- 2. ACTIVATION: Cleaning up old caches ---
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // If the cache name is not in the whitelist, delete it
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// --- 3. FETCH: Serving assets from cache or network ---
self.addEventListener('fetch', (event) => {
  // Only intercept requests that are not from third-party sources (like Google Fonts)
  if (event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          // Cache hit - return response
          if (response) {
            return response;
          }
          // No match in cache - fetch from network
          return fetch(event.request);
        })
    );
  }
});
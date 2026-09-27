/* Offline support.
 *
 * Every release must bump CACHE_VERSION. A new worker precaches the new files
 * (bypassing the HTTP cache) and then waits; the page shows an "Update" banner
 * and, when tapped, tells the worker to take over and reloads. Old caches are
 * removed on activation, so users are never stuck on an outdated version.
 */
const CACHE_VERSION = 'v5.2.0';
const CACHE_NAME = `service-time-tracker-${CACHE_VERSION}`;
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './manifest.json',
    './favicon.ico',
    './js/theme.js',
    './js/dates.js',
    './js/stats.js',
    './js/storage.js',
    './js/achievements.js',
    './js/layers.js',
    './js/app.js',
    './images/icon-192.png',
    './images/icon-512.png',
    './images/icon-maskable-192.png',
    './images/icon-maskable-512.png',
    './images/apple-touch-icon.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' })))
        )
    );
    // First install: nothing to update from, so take control right away.
    if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(names
                .filter(n => n.startsWith('service-time-tracker-') && n !== CACHE_NAME)
                .map(n => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Cache first for the app shell; page navigations fall back to the cached index.
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    if (req.mode === 'navigate') {
        event.respondWith(
            caches.match(req, { ignoreSearch: true })
                .then(hit => hit || caches.match('./index.html'))
                .then(hit => hit || fetch(req))
        );
        return;
    }
    event.respondWith(
        caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req))
    );
});

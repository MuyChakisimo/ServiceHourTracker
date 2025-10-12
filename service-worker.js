const CACHE_NAME = 'service-time-tracker-v3.5.8'; // Or your latest version
const urlsToCache = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './manifest.json',
    './favicon.ico',
    './images/icon-192.png',
    './images/icon-512.png'
];

// Store app settings in memory for quick access
let appSettings = {};

// Install the service worker, cache files, and activate immediately
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => cache.addAll(urlsToCache))
        .then(() => self.skipWaiting()) // <-- OPTIMIZATION: Activate new worker faster
    );
});

// Activate the service worker and clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Serve cached files first for an offline-first experience
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
});

// Listen for settings updates from the main app
self.addEventListener('message', event => {
    if (event.data && event.data.action === 'updateSettings') {
        appSettings = event.data.settings;
    }
});

// --- NOTIFICATION LOGIC ---

// Listen for the daily periodic sync event
self.addEventListener('periodicsync', event => {
    if (event.tag === 'check-reminder') {
        event.waitUntil(checkAndShowNotification());
    }
});

// Check if a notification should be sent
async function checkAndShowNotification() {
    if (!appSettings?.notifications?.enabled) return;

    const today = new Date();
    // BUG FIX: Use lowercase day names to match the saved data format
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayName = dayNames[today.getDay()];

    const todaySchedule = appSettings.schedule?.[todayName];

    // Exit if today is not an active, scheduled day with a time goal > 0
    if (!todaySchedule || !todaySchedule.active || (todaySchedule.hours === 0 && todaySchedule.minutes === 0)) {
        return;
    }

    const [reminderHour, reminderMinute] = appSettings.notifications.time.split(':').map(Number);

    // Exit if it's not yet time for the reminder
    if (today.getHours() < reminderHour || (today.getHours() === reminderHour && today.getMinutes() < reminderMinute)) {
        return;
    }
    
    // If all checks pass, show the notification
    const options = {
        body: "Don't forget to register your time for today!",
        icon: './images/icon-192.png',
        actions: [{ action: 'add-time', title: 'Add Time' }]
    };

    return self.registration.showNotification('Service Time Reminder', options);
}

// Handle what happens when a user clicks the notification
self.addEventListener('notificationclick', event => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // If the app is already open, focus it and open the modal
            if (clientList.length > 0) {
                const client = clientList[0];
                client.focus();
                client.postMessage({ action: 'open-modal-for-today' });
            } else {
                // Otherwise, open the app
                clients.openWindow('/');
            }
        })
    );
});
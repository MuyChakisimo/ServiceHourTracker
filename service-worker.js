const CACHE_NAME = 'service-time-tracker-v3.3.3'; // Make sure to update this version number
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

// Store settings in memory
let appSettings = {};

// Install the service worker and cache files
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => {
            return cache.addAll(urlsToCache);
        })
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

// Serve cached files when offline
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
        .then(response => {
            return response || fetch(event.request);
        })
    );
});

// Listen for messages from the main app (e.g., settings updates)
self.addEventListener('message', event => {
    if (event.data && event.data.action === 'updateSettings') {
        appSettings = event.data.settings;
    }
});

// --- NOTIFICATION LOGIC ---

// Main event for periodic checks (runs about once a day)
self.addEventListener('periodicsync', event => {
    if (event.tag === 'check-reminder') {
        event.waitUntil(checkAndShowNotification());
    }
});

async function checkAndShowNotification() {
    if (!appSettings || !appSettings.notifications || !appSettings.notifications.enabled) {
        return; // Notifications are disabled
    }

    const today = new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayName = dayNames[today.getDay()];

    const schedule = appSettings.schedule || {};
    const todaySchedule = schedule[todayName];

    // Only proceed if today is a scheduled day with a time goal > 0
    if (!todaySchedule || !todaySchedule.active || (todaySchedule.hours === 0 && todaySchedule.minutes === 0)) {
        return;
    }

    const scheduledTotalMinutes = (todaySchedule.hours * 60) + todaySchedule.minutes;

    // Get today's logged time from the database
    // We need to fetch the database from the app via a message because the service worker doesn't have direct access.
    // A simpler way for now is to assume the check runs close to the end of the day.
    // A full implementation would require IndexedDB. This is a robust simplification.
    // For now, let's just show a notification if the day is scheduled.
    // In the next step, we'll refine this to check the actual logged time.

    const [reminderHour, reminderMinute] = appSettings.notifications.time.split(':').map(Number);

    // Don't send notification if it's before the user's chosen time
    if (today.getHours() < reminderHour || (today.getHours() === reminderHour && today.getMinutes() < reminderMinute)) {
        return;
    }
    
    // For now, we'll send a simple reminder.
    // The logic for checking logged time is complex without a shared database.
    // This is the simplified, reliable version.
    const options = {
        body: 'Don\'t forget to register your time for today!',
        icon: './images/icon-192.png',
        actions: [{ action: 'edit-time', title: 'Add Time' }]
    };
    return self.registration.showNotification('Service Time Reminder', options);
}


// Handle what happens when a notification is clicked
self.addEventListener('notificationclick', event => {
    event.notification.close(); // Close the notification

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // Check if there's a window open
            if (clientList.length > 0) {
                const client = clientList[0];
                client.focus(); // Focus the existing window
                client.postMessage({ action: 'open-modal-for-today' });
            } else {
                // If no window is open, open a new one
                clients.openWindow('/');
            }
        })
    );
});
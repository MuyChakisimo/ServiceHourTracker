# Service Time Tracker

A simple, offline-first app for tracking service time, studies, notes, plans and
monthly and service-year goals, with a permanent Service History.

Open it at <https://muychakisimo.github.io/ServiceHourTracker/> and add it to
your home screen to use it like an app.

## Your data

**Without cloud sync (the default)**
- Everything is saved only on this device.
- No account is needed and the app works without internet.
- Use **Menu → Import / Export Data** to keep a backup file.

**With cloud sync (optional)**
- Go to **Menu → Account & Sync** and connect your own **Google Drive**, **OneDrive** or
  **Dropbox**.
- The app still saves everything on your device first and keeps working offline.
- Changes are copied to a private app folder in *your* cloud account, and your other
  devices connected to the same account receive them.
- If the same day was changed on two devices, the most recent change is kept.
- Your records go only to your own cloud account, never to a server run by this app.
- **Disconnect** at any time and keep your data on the device.
  **Delete Cloud Backup** removes the cloud copy.

Known limitations of sync in the web app:
- Google Drive stays signed in for about an hour and OneDrive for 24 hours. After that,
  sync pauses and your changes wait on the device until you tap **Reconnect**.
  Dropbox stays signed in.
- iCloud is not available in browsers or on Android; it is planned for the
  iPhone/iPad app.
- On iPhone, connect from inside the installed home-screen app. Safari and the
  home-screen app keep separate storage.

## For developers

Plain HTML, CSS and JavaScript. There is no build step.

- Run locally: `npx http-server -p 8765 -c-1`, then open http://localhost:8765/
- Tests: `node tests/run-tests.js && node tests/sync-tests.js && node tests/provider-tests.js`
- Cloud providers: see [CLOUD_SYNC_SETUP.md](CLOUD_SYNC_SETUP.md)
- Releases: bump `CACHE_VERSION` in `service-worker.js` every time you publish.

| File | Purpose |
|---|---|
| `js/dates.js`, `js/stats.js` | Dates, service years, totals, Service History (read-only) |
| `js/storage.js` | Validation, legacy migration, backup files |
| `js/localdb.js` | IndexedDB records, migration from localStorage |
| `js/sync-core.js`, `js/sync-engine.js` | Record merge (last write wins), sync cycle, back-off |
| `js/providers.js`, `js/cloud-config.js` | OAuth, Google Drive / OneDrive / Dropbox adapters, client IDs |
| `js/sync-ui.js` | Account & Sync screen |
| `js/app.js` | Calendar, entries, planning, goals, history, medals, themes |

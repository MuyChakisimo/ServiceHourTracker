# Changelog

## 6.0.0 — Optional cloud sync
- **Account & Sync** (menu):
  - Connect your own Google Drive, OneDrive or Dropbox. It's optional and there's no login on start.
  - Choose Automatic (default) or Manual sync, or use Sync Now.
  - Status, last sync time, Disconnect (keep or remove local data) and Delete Cloud Backup.
- **Local database moved to IndexedDB:**
  - Migrated automatically and verified before switching over.
  - The localStorage keys are kept as a mirror and recovery copy.
- **Sync model:**
  - One record per day, goal, medal and preference, merged by last write wins.
  - Deletions are tombstones, so they are never resurrected.
  - One cloud file per month.
  - Conditional writes; damaged cloud files are set aside instead of being trusted.
- Importing a backup while syncing **merges** it instead of replacing data.
- Sign-in tokens are encrypted on the device and never exported.
- Content-Security-Policy added.
- Fixed a dialog bug: a confirmation shown right after another one could close itself.
- See `CLOUD_SYNC_SETUP.md` for provider setup.

## 5.2.0
- Custom Theme has an **Outlines** colour. Tap **Auto** to go back to outlines matched to your card and text colours.
- New **Status colours** section with pickers for Planned, Missed plan, Below plan and Plan completed, a live preview and a reset button.
  - Status colours are kept when you switch presets.
  - They are included in backups.

## 5.1.0
- New app icon (home screen, maskable, Apple touch icon and favicon).
- The month summary shows **🤔 Planned**: the total planned time for the viewed month.
- Emoji labels throughout:
  - 📝 Notes
  - ✏️ Edit (planning) mode
  - 🎯 Goal
  - ⏱️ Completed time
  - ⏳ Time left
  - 👨🏽‍🏫 Studies
  - 🤔 Planned time (it was 🎯 in calendar cells)

## 5.0.0

**Data safety**
- Logging time no longer erases a day's planned target. Saving an entry only changes time, studies and notes.
- Day keys are now always local dates. Versions 4.x filed entries one day early for users east of UTC. Those keys are migrated once, and the untouched originals are kept in `serviceTimeTrackerPreMigrationBackup`.
- Settings schema v2, migrated automatically. Storage key names are unchanged.
- Corrupt storage is never overwritten.

**Service years & history**
- The service year follows the month on screen, not today's date. The start month is configurable.
- A service year's total counts only entries between its start date and its end date.
- Goals are stored per month and per service year (effective-dated), so a new goal never rewrites earlier periods.
- New **Service History** screen: every service year found in your records, newest first. Tap a year for its month-by-month breakdown, then tap a month to open it in the calendar.
- Medals are awarded only when you save an entry or goal, never while browsing.

**Calendar & UI**
- Adjacent-month days fill the grid (4–6 rows). The week can start on Sunday or Monday.
- New Today button.
- Month navigation can no longer skip months.
- Planning:
  - "Per Month" plans every matching weekday of the month from today on.
  - "Clear Plans" clears only the viewed month, after confirmation.
- The Home screen fits the viewport from 320×568 up, with safe-area support.
- Redesigned menu, modals (native `<dialog>`, Esc and Back close them), goals, medals, and themes (6 presets plus custom colours).
- Removed: Notifications, the unreachable weekly schedule panel, the duplicate `clear-plans-btn`, and the one-button share panel.

**PWA**
- Added the missing maskable icons and an apple-touch icon.
- The service worker precaches all files, bypassing the HTTP cache, and shows an "Update" banner when a new version is ready.
- **Bump `CACHE_VERSION` in `service-worker.js` on every release.**

**Tests**
- `node tests/run-tests.js` runs the unit tests for dates, stats, migration, backups and medals.

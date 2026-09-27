# Cloud Sync Setup

Cloud sync is optional. The app works fully offline without it. When a user
connects **their own** Google Drive, OneDrive or Dropbox account, their tracker
is copied to a private app folder in that account and synchronized between their
devices. There is no central server and no shared database: you (the app owner)
never receive anyone's service records.

Until you add at least one client ID below, the Account & Sync screen tells
users that cloud sync isn't available yet. Nothing else changes.

---

## 1. Provider status

| Provider | Web app (PWA) | Android | iPhone / iPad | Stays signed in (web) |
|---|---|---|---|---|
| Dropbox | Implemented | Implemented (web app); native app: prepared | Implemented (web app); native app: prepared | Yes. Refresh tokens with PKCE, until the user disconnects. |
| OneDrive | Implemented | Same as Dropbox | Same as Dropbox | 24 hours. Microsoft's fixed limit for browser apps; after that, the user taps **Reconnect**. |
| Google Drive | Implemented | Same as Dropbox | Same as Dropbox | About 1 hour. Google gives browser apps without a server no refresh tokens; after that, the user taps **Reconnect**. |
| iCloud | Not supported in browsers | Not supported | Prepared only (needs a native plugin, see §6) | — |

**"Implemented"** means the adapter, sign-in flow, upload, download, merge,
token refresh, disconnect and delete are written and pass automated tests
against simulated provider APIs (`tests/fake-providers.js`). The fakes follow
each provider's documented request and response formats. The adapters have
**not** been run against the live services yet, because that needs your client
IDs. Do a real test with each provider (§7) before announcing it.

---

## 2. Redirect (callback) URLs

Every provider sends the user back to `oauth-callback.html`, next to `index.html`.
Register **exactly** these URLs with each provider (no trailing characters):

| Environment | Redirect URI |
|---|---|
| Production (GitHub Pages) | `https://muychakisimo.github.io/ServiceHourTracker/oauth-callback.html` |
| Local development | `http://localhost:8765/oauth-callback.html` |

Serve locally with `npx http-server -p 8765 -c-1`. Use the same port you
registered; `localhost` and `127.0.0.1` are different URLs to the providers.

Sign-in uses a full-page redirect, not a pop-up, because installed PWAs and iOS
often block pop-ups. The service worker never intercepts `oauth-callback.html`.

---

## 3. Google Drive

Scope: `https://www.googleapis.com/auth/drive.appdata` (a hidden per-app folder;
the app cannot see the user's other Drive files).

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. **APIs & Services → Library**: enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Fill in the app name, support email and privacy policy URL.
   - Add the scope `.../auth/drive.appdata`.
   - While the app is in **Testing** mode, add your testers as test users.
   - Publish the app when ready. Check whether the console lists the scope as needing verification; if it does, complete Google's verification before a public launch.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized JavaScript origins: `https://muychakisimo.github.io` and `http://localhost:8765`.
   - Authorized redirect URIs: both URLs from §2.
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) into
   `js/cloud-config.js` → `google.clientId`. **Do not** copy the client secret anywhere.

**Limitation.** Browser apps use Google's token flow (`response_type=token`), so
sign-in lasts about one hour. Changes keep saving on the device and upload after
the user taps **Reconnect**, which is usually one tap with no password.

To keep users signed in, Google requires the authorization-code flow with a
**client secret**, and that must run on a server. The option would be a tiny
serverless function (Cloudflare Worker, Vercel or Netlify function) that only
exchanges codes and refreshes tokens, and stores nothing. It is not included.
It would be the only server piece, and it would never see tracker data.

---

## 4. Microsoft OneDrive

Scopes: `Files.ReadWrite.AppFolder offline_access openid profile`. The app folder
appears in the user's OneDrive as **Apps/<your app name>**.

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) (or Azure portal) → **App registrations → New registration**.
2. **Supported account types**:
   - **Accounts in any organizational directory and personal Microsoft accounts**, which matches `tenant: 'common'`.
   - Or **Personal Microsoft accounts only**, then set `tenant: 'consumers'`.
3. **Redirect URI**: platform **Single-page application (SPA)**; add both URLs from §2.
   The SPA platform is required: it enables CORS for the token endpoint and PKCE without a secret.
4. **API permissions → Add → Microsoft Graph → Delegated**: add `Files.ReadWrite.AppFolder`,
   `offline_access`, `openid` and `profile`. Do **not** create a client secret.
5. Copy the **Application (client) ID** into `js/cloud-config.js` → `onedrive.clientId`,
   and set `tenant`.

Notes:
- Microsoft limits refresh tokens for browser apps to 24 hours. After that the user taps **Reconnect**.
- Work and school accounts may need their administrator to consent to the app. Personal accounts work without that.
- Browser apps cannot revoke Microsoft tokens; disconnecting deletes them from the device, and they expire on their own. Users can also remove the app at account.live.com/consent.

---

## 5. Dropbox

1. [Dropbox App Console](https://www.dropbox.com/developers/apps) → **Create app**:
   - Access: **Scoped access**.
   - Type: **App folder**. It appears to the user as **Apps/<app name>**.
2. **Permissions** tab: enable `files.metadata.read`, `files.content.read` and
   `files.content.write` (`account_info.read` is included automatically). Click **Submit**.
3. **Settings** tab:
   - **OAuth 2 → Redirect URIs**: add both URLs from §2.
   - **Allow public clients (Implicit Grant & PKCE)**: **Allow**.
4. Copy the **App key** into `js/cloud-config.js` → `dropbox.clientId`. Never use the app secret.
5. New Dropbox apps start in *development* status (a limited number of users). Apply for
   production in the App Console before a wide launch.

---

## 6. iCloud and the native apps

**iCloud in browsers and on Android is not offered.** There is no iCloud Drive file
API suitable for this app outside Apple's native apps. The option is hidden
unless the native plugin below is present.

(Apple's CloudKit JS does exist for the web. It is a different, record-based
database that needs an Apple Developer account and Apple sign-in, and it is not
implemented.)

### Capacitor (recommended for the iOS and Android apps)

Capacitor wraps the existing HTML, CSS and JavaScript unchanged. No rewrite is
needed. Nothing native is generated in this repository yet, because that needs
Xcode, the Android SDK and your developer accounts. The next steps:

1. Create the native projects:
   ```bash
   npm init -y
   npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android @capacitor/app @capacitor/browser
   npx cap init "Service Time Tracker" com.yourname.servicetimetracker --web-dir www
   ```
2. Copy the web files into `www/` (see `.gitignore`), then run `npx cap add ios` and `npx cap add android`.
3. **Sign-in inside native apps.** Register a native redirect URI with each provider
   (a custom scheme such as `com.yourname.servicetimetracker:/oauth`, or an https
   universal/app link). Then:
   - Set `STT.cloudConfig.redirectUri` to it.
   - Open the authorize URL with `@capacitor/browser`.
   - In `App.addListener('appUrlOpen', e => STT.providers.acceptCallbackUrl(e.url))`, hand the result to the app. The rest of the flow is identical.
   - Google needs separate **iOS** and **Android** OAuth client IDs, which allow the code flow with PKCE and refresh tokens natively. The Google adapter currently implements only the web token flow; adding a native code flow is a small change in `js/providers.js`.
4. **Secure token storage.** Before the app starts, set
   `STT.native = { secureStorage: { get, set, remove } }` backed by the Keychain
   (iOS) or Keystore (Android), for example with a secure-storage Capacitor plugin.
   `js/providers.js` then stores tokens there instead of IndexedDB.
5. **iCloud (iOS only).** Enable the iCloud → iCloud Documents capability and a container in
   Xcode (Apple Developer Program required). Implement a Capacitor plugin named
   `ICloudDocuments` with:
   - `isSignedIn() → {signedIn}`
   - `list({dir}) → {files:[{path, rev, modified}]}`
   - `read({path}) → {text} | null`
   - `write({path, text}) → {rev, modified}`
   - `removeDir({path})`

   The iCloud option then appears automatically on iOS.

The cloud file format is identical on all platforms, so a phone app and the web
app can share the same Google Drive, OneDrive or Dropbox account.

---

## 7. Checklist before enabling a provider

1. Register the app (§3–5), add the client ID to `js/cloud-config.js`, and bump
   `CACHE_VERSION` in `service-worker.js`.
2. Deploy. Then, in the browser and in the installed app on Android and iPhone:
   1. Connect.
   2. Check that the existing-data prompt appears.
   3. Upload.
   4. Connect a second device and check that the data downloads.
   5. Edit on both devices.
   6. Test offline edits.
   7. Disconnect and reconnect.
   8. Delete Cloud Backup.
3. On iPhone, test the **installed home-screen app** specifically. iOS runs installed web
   apps in their own storage, and the sign-in redirect must return to the installed app.
   If it does not, see the "known limitations" in the README.

---

## 8. How it works (for maintainers)

- **Local first.** `js/localdb.js` stores every day, goal, medal and preference as its own
  record in IndexedDB, with `u` (edit time), `d` (device id) and `dirty` (not yet uploaded).
  The old localStorage keys are kept as a readable mirror and a recovery copy.
- **Cloud layout.** Paths are relative to the provider's private app folder:
  ```
  tracker/manifest.json          format, schemaVersion, datasetId
  tracker/prefs.json             goals (per month / per service year), medals, preferences
  tracker/entries/YYYY-MM.json   one file per month
  tracker/quarantine/…           damaged files set aside (never deleted automatically)
  ```
- **Merge.** Last write wins per record (`js/sync-core.js`). Ties are broken deterministically.
  - Deletions are tombstones, kept for 180 days.
  - Unsynced local edits that lose are kept as "conflict copies" and included in exports.
  - Writes are conditional (Dropbox revisions, OneDrive eTags, create-only), so concurrent
    writes are re-merged rather than lost. Google Drive duplicates are detected and merged.
- **Clock skew.** Device clocks are corrected with the provider's server timestamps
  (`c` keeps the raw device time for diagnostics).
- **Settings synced.** Service-year start month, week start, goals and theme (so all
  devices look the same).
- **Device-only.** Device id, tokens, sync state and log.
- **Tests.**
  ```bash
  node tests/run-tests.js       # dates, stats, migration, backups, medals
  node tests/sync-tests.js      # merge rules and scenarios A–F
  node tests/provider-tests.js  # Drive / Graph / Dropbox adapters vs. fakes
  ```

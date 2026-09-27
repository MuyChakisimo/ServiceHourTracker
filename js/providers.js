/* Cloud providers: OAuth sign-in, token storage and storage adapters.
 *
 * Each provider keeps the tracker in its private app area, never in the
 * user's normal folders:
 *   Google Drive  appDataFolder (hidden)        scope drive.appdata
 *   OneDrive      Apps/<app name> (approot)     scope Files.ReadWrite.AppFolder
 *   Dropbox       Apps/<app name> (App folder)  scoped app, files.content.*
 *   iCloud        native iOS app only (plugin), not available in browsers
 *
 * Sign-in uses full-page redirects (not pop-ups, which installed PWAs and iOS
 * often block). No client secrets are used anywhere; client IDs are public.
 * Tokens are encrypted with a non-extractable WebCrypto key before being
 * stored in IndexedDB, and are never written to localStorage or backups.
 */
(function (root) {
    const STT = root.STT = root.STT || {};
    const { SyncError } = STT.syncCore;

    const PENDING_KEY = 'stt.oauth.pending';
    const RESULT_KEY = 'stt.oauth.result';
    const SESSION_KEY = 'providerSession';
    const PREFIX = 'tracker';
    const cfg = () => STT.cloudConfig || {};

    /* ---------- Small helpers ---------- */
    const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const randomString = (n = 32) => { const b = new Uint8Array(n); root.crypto.getRandomValues(b); return b64url(b); };
    async function pkcePair() {
        const verifier = randomString(48);
        const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
        return { verifier, challenge: b64url(digest) };
    }
    const form = obj => new URLSearchParams(obj).toString();
    const qs = obj => Object.entries(obj).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

    function redirectUri() {
        // Native apps set an absolute redirectUri (custom scheme or universal link) in cloud-config.js.
        if (cfg().redirectUri) return cfg().redirectUri;
        const u = new URL(cfg().redirectPath || 'oauth-callback.html', root.location.href);
        u.search = ''; u.hash = '';
        return u.href;
    }

    function jwtPayload(token) {
        try {
            const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(decodeURIComponent(escape(atob(part))));
        } catch (e) { return {}; }
    }

    /* ---------- HTTP with error mapping ---------- */
    async function http(url, { method = 'GET', headers = {}, body, token, expect = 'json' } = {}) {
        let res;
        try {
            res = await root.fetch(url, { method, headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers, body });
        } catch (e) {
            throw new SyncError('offline', 'Could not reach the cloud provider. Changes are saved on this device.');
        }
        if (res.ok) {
            if (expect === 'none' || res.status === 204) return null;
            return expect === 'text' ? res.text() : res.json();
        }
        const text = await res.text().catch(() => '');
        throw httpError(res.status, text, res.headers.get('Retry-After'));
    }

    function httpError(status, text, retryAfter) {
        const t = (text || '').toLowerCase();
        const extra = { status, retryAfter: retryAfter ? Number(retryAfter) || 60 : undefined };
        // Dropbox reports most failures as HTTP 409 with a JSON error_summary.
        try { const j = JSON.parse(text); if (j && typeof j.error_summary === 'string') extra.summary = j.error_summary; } catch (e) { /* not JSON */ }
        if (status === 401) return new SyncError('auth', 'Sign-in expired. Reconnect to keep syncing.', extra);
        if (status === 429 || /ratelimit|rate_limit|too_many/.test(t)) return new SyncError('rate', 'The provider asked us to slow down. Sync will retry automatically.', extra);
        if (status === 507 || /quota|insufficient_space|storagequota/.test(t)) return new SyncError('quota', 'Your cloud storage is full.', extra);
        if (status === 403) return new SyncError('denied', 'The provider refused access. Reconnect and allow access to the app folder.', extra);
        if (status === 404) return new SyncError('notfound', 'Not found', extra);
        if (status === 409 || status === 412) return new SyncError('conflict', 'The cloud file changed during sync.', extra);
        if (status >= 500) return new SyncError('server', 'The cloud provider is having problems. Sync will retry automatically.', extra);
        return new SyncError('unknown', `Unexpected response from the provider (${status}).`, extra);
    }

    /* ---------- Token vault ---------- */
    function vault(local) {
        const native = STT.native && STT.native.secureStorage; // Keychain / Keystore in the native apps
        async function key() {
            let k = await local.kvGet('vaultKey');
            if (!k) {
                k = await root.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
                await local.kvSet('vaultKey', k);
            }
            return k;
        }
        return {
            async save(session) {
                const text = JSON.stringify(session);
                if (native) return native.set(SESSION_KEY, text);
                const iv = root.crypto.getRandomValues(new Uint8Array(12));
                const ct = await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(text));
                await local.kvSet(SESSION_KEY, { iv, ct });
            },
            async load() {
                try {
                    if (native) { const t = await native.get(SESSION_KEY); return t ? JSON.parse(t) : null; }
                    const rec = await local.kvGet(SESSION_KEY);
                    if (!rec) return null;
                    const pt = await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, await key(), rec.ct);
                    return JSON.parse(new TextDecoder().decode(pt));
                } catch (e) { return null; }
            },
            async clear() {
                if (native) await native.remove(SESSION_KEY);
                await local.kvDel(SESSION_KEY);
            }
        };
    }

    /* ---------- Redirect hand-off ---------- */
    function savePending(p) { root.localStorage.setItem(PENDING_KEY, JSON.stringify({ ...p, at: Date.now() })); }

    /** Reads the result the callback page left behind (if any) and validates it. */
    function takeRedirectResult() {
        let pending, result;
        try {
            pending = JSON.parse(root.localStorage.getItem(PENDING_KEY) || 'null');
            result = JSON.parse(root.localStorage.getItem(RESULT_KEY) || 'null');
        } catch (e) { pending = result = null; }
        if (!result) {
            // An abandoned sign-in: forget its one-time state after 15 minutes.
            if (pending && Date.now() - pending.at > 15 * 60e3) root.localStorage.removeItem(PENDING_KEY);
            return null;
        }
        root.localStorage.removeItem(RESULT_KEY);
        root.localStorage.removeItem(PENDING_KEY);
        const params = new URLSearchParams((result.hash || '').replace(/^#/, ''));
        new URLSearchParams((result.query || '').replace(/^\?/, '')).forEach((v, k) => { if (!params.has(k)) params.set(k, v); });
        if (!pending || Date.now() - pending.at > 15 * 60e3) return { error: 'The sign-in took too long or was started elsewhere. Please try again.' };
        if (params.get('state') !== pending.state) return { error: 'The sign-in response did not match this request, so it was ignored for your security.' };
        if (params.get('error')) {
            const denied = /access_denied|consent_required|interaction_required|user_cancel/.test(params.get('error'));
            return { provider: pending.provider, reconnect: pending.reconnect, error: denied ? 'Access was not granted.' : `Sign-in failed (${params.get('error')}).` };
        }
        return { provider: pending.provider, reconnect: pending.reconnect, params, verifier: pending.verifier };
    }

    /* ---------- Shared token handling ---------- */
    function makeAuth(def, local, session) {
        const v = vault(local);
        let refreshing = null;
        async function refresh() {
            if (!def.refresh || !session.refreshToken) throw new SyncError('auth', `${def.name} sign-in expired. Reconnect to keep syncing.`);
            if (session.refreshExpiresAt && Date.now() > session.refreshExpiresAt) throw new SyncError('auth', `${def.name} sign-in expired. Reconnect to keep syncing.`);
            if (!refreshing) {
                refreshing = def.refresh(session).then(async next => {
                    session = { ...session, ...next };
                    await v.save(session);
                    return session;
                }).finally(() => { refreshing = null; });
            }
            return refreshing;
        }
        return {
            get session() { return session; },
            async token(force = false) {
                if (!force && session.accessToken && Date.now() < session.expiresAt) return session.accessToken;
                await refresh();
                return session.accessToken;
            },
            /** Runs a request, refreshing the token once if the provider says it expired. */
            async call(fn) {
                try { return await fn(await this.token()); } catch (e) {
                    if (e.code !== 'auth' || !def.refresh || !session.refreshToken) throw e;
                    return fn(await this.token(true));
                }
            },
            ensure: async () => { await (session.accessToken && Date.now() < session.expiresAt ? null : refresh()); }
        };
    }

    /* =====================================================================
       Google Drive (appDataFolder)
       Browser apps without a server only get 1-hour access tokens (no refresh
       tokens), so after an hour sync pauses until the user taps Reconnect.
       ===================================================================== */
    const GOOGLE = {
        id: 'google', name: 'Google Drive',
        platforms: 'web, Android and iPhone',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        api: 'https://www.googleapis.com/drive/v3',
        upload: 'https://www.googleapis.com/upload/drive/v3',
        scope: 'https://www.googleapis.com/auth/drive.appdata',
        configured: () => !!(cfg().google && cfg().google.clientId),
        available: () => true,
        async authorizeUrl({ state, reconnect, loginHint }) {
            return { url: `${this.authUrl}?${qs({
                client_id: cfg().google.clientId, redirect_uri: redirectUri(), response_type: 'token',
                scope: this.scope, state, include_granted_scopes: 'false',
                prompt: reconnect ? undefined : 'select_account', login_hint: loginHint
            })}` };
        },
        async finish(params) {
            const token = params.get('access_token');
            if (!token) throw new SyncError('denied', 'Google did not return an access token.');
            if (!(params.get('scope') || '').split(' ').includes(this.scope)) {
                throw new SyncError('denied', 'Permission to store app data in Google Drive was not granted. Reconnect and allow it.');
            }
            const session = { provider: 'google', accessToken: token, expiresAt: Date.now() + (Number(params.get('expires_in')) || 3600) * 1000 - 60e3 };
            let account = { label: 'Google account', id: null };
            try {
                const about = await http(`${this.api}/about?fields=user(displayName,emailAddress,permissionId)`, { token });
                account = { label: about.user.emailAddress || about.user.displayName || account.label, id: about.user.permissionId || about.user.emailAddress || null };
            } catch (e) { /* account label is optional */ }
            return { ...session, account };
        },
        refresh: null,
        async revoke(session) {
            await http(`https://oauth2.googleapis.com/revoke?${qs({ token: session.accessToken })}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, expect: 'none' });
        },
        storage(auth) {
            const api = this.api, up = this.upload;
            let cache = new Map(); // path -> { id, dupIds }
            const nameOf = p => `${PREFIX}/${p}`;
            async function listAll() {
                const files = [];
                let pageToken;
                do {
                    const url = `${api}/files?${qs({ spaces: 'appDataFolder', q: 'trashed = false', pageSize: 1000, pageToken, fields: 'nextPageToken,files(id,name,version,modifiedTime)' })}`;
                    const res = await auth.call(t => http(url, { token: t }));
                    files.push(...res.files);
                    pageToken = res.nextPageToken;
                } while (pageToken);
                return files;
            }
            async function list() {
                const byName = new Map();
                for (const f of await listAll()) {
                    if (!f.name.startsWith(PREFIX + '/')) continue;
                    const path = f.name.slice(PREFIX.length + 1);
                    if (!byName.has(path)) byName.set(path, []);
                    byName.get(path).push(f);
                }
                const out = new Map();
                cache = new Map();
                for (const [path, fs] of byName) {
                    fs.sort((a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime));
                    cache.set(path, { id: fs[0].id, dupIds: fs.slice(1).map(f => f.id) });
                    out.set(path, { rev: String(fs[0].version), modified: fs[0].modifiedTime, duplicates: fs.length > 1 ? fs.length - 1 : 0 });
                }
                return out;
            }
            const download = id => auth.call(t => http(`${api}/files/${id}?alt=media`, { token: t, expect: 'text' }));
            return {
                list,
                async read(path) {
                    if (!cache.has(path)) await list();
                    const c = cache.get(path);
                    if (!c) return null;
                    try {
                        const text = await download(c.id);
                        const duplicateTexts = [];
                        for (const id of c.dupIds) { try { duplicateTexts.push(await download(id)); } catch (e) { if (e.code !== 'notfound') throw e; } }
                        return { text, duplicateTexts };
                    } catch (e) { if (e.code === 'notfound') return null; throw e; }
                },
                async write(path, text) {
                    const c = cache.get(path);
                    let meta;
                    if (c) {
                        meta = await auth.call(t => http(`${up}/files/${c.id}?uploadType=media&fields=id,version,modifiedTime`, {
                            method: 'PATCH', token: t, headers: { 'Content-Type': 'application/json' }, body: text
                        }));
                    } else {
                        const boundary = 'stt' + randomString(12);
                        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
                            JSON.stringify({ name: nameOf(path), parents: ['appDataFolder'], mimeType: 'application/json' }) +
                            `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
                        meta = await auth.call(t => http(`${up}/files?uploadType=multipart&fields=id,version,modifiedTime`, {
                            method: 'POST', token: t, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
                        }));
                        cache.set(path, { id: meta.id, dupIds: [] });
                    }
                    return { rev: String(meta.version), modified: meta.modifiedTime };
                },
                async removeDuplicates(path) {
                    const c = cache.get(path);
                    if (!c) return;
                    for (const id of c.dupIds) { try { await auth.call(t => http(`${api}/files/${id}`, { method: 'DELETE', token: t, expect: 'none' })); } catch (e) { if (e.code !== 'notfound') throw e; } }
                    c.dupIds = [];
                },
                async removeAll() {
                    for (const f of await listAll()) {
                        if (!f.name.startsWith(PREFIX + '/')) continue;
                        try { await auth.call(t => http(`${api}/files/${f.id}`, { method: 'DELETE', token: t, expect: 'none' })); } catch (e) { if (e.code !== 'notfound') throw e; }
                    }
                    cache = new Map();
                }
            };
        }
    };

    /* =====================================================================
       Microsoft OneDrive (app folder via Microsoft Graph)
       Auth code + PKCE with a "Single-page application" redirect URI. Microsoft
       limits browser refresh tokens to 24 hours, then the user must reconnect.
       ===================================================================== */
    const ONEDRIVE = {
        id: 'onedrive', name: 'OneDrive',
        platforms: 'web, Android and iPhone',
        graph: 'https://graph.microsoft.com/v1.0/me/drive/special/approot',
        scope: 'openid profile offline_access Files.ReadWrite.AppFolder',
        authority: () => `https://login.microsoftonline.com/${(cfg().onedrive && cfg().onedrive.tenant) || 'common'}/oauth2/v2.0`,
        configured: () => !!(cfg().onedrive && cfg().onedrive.clientId),
        available: () => true,
        async authorizeUrl({ state, reconnect, loginHint }) {
            const { verifier, challenge } = await pkcePair();
            return { verifier, url: `${this.authority()}/authorize?${qs({
                client_id: cfg().onedrive.clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
                scope: this.scope, state, code_challenge: challenge, code_challenge_method: 'S256',
                prompt: reconnect ? undefined : 'select_account', login_hint: loginHint
            })}` };
        },
        async finish(params, verifier) {
            const tok = await http(`${this.authority()}/token`, {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form({ client_id: cfg().onedrive.clientId, grant_type: 'authorization_code', code: params.get('code'), redirect_uri: redirectUri(), code_verifier: verifier, scope: this.scope })
            });
            const idt = jwtPayload(tok.id_token || '');
            return {
                provider: 'onedrive',
                accessToken: tok.access_token,
                expiresAt: Date.now() + (tok.expires_in || 3600) * 1000 - 60e3,
                refreshToken: tok.refresh_token,
                refreshExpiresAt: Date.now() + 24 * 3600e3 - 5 * 60e3, // fixed lifetime for browser apps
                account: { label: idt.preferred_username || idt.email || idt.name || 'Microsoft account', id: idt.oid || idt.sub || null }
            };
        },
        async refresh(session) {
            const tok = await http(`${this.authority()}/token`, {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form({ client_id: cfg().onedrive.clientId, grant_type: 'refresh_token', refresh_token: session.refreshToken, scope: this.scope })
            }).catch(e => { if (e.code === 'unknown' || e.code === 'denied' || e.code === 'conflict') throw new SyncError('auth', 'OneDrive sign-in expired. Reconnect to keep syncing.'); throw e; });
            // New refresh tokens inherit the original 24-hour limit.
            return { accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in || 3600) * 1000 - 60e3, refreshToken: tok.refresh_token || session.refreshToken };
        },
        async revoke() { /* Browser apps cannot revoke Microsoft tokens; they expire within 24 hours. */ },
        storage(auth) {
            const base = this.graph;
            const enc = p => p.split('/').map(encodeURIComponent).join('/');
            const item = p => `${base}:/${PREFIX}/${enc(p)}`;
            let foldersReady = false;
            async function children(folder, prefix, out) {
                let url = `${base}:/${enc(folder)}:/children?$select=name,eTag,lastModifiedDateTime,file,folder&$top=999`;
                while (url) {
                    let res;
                    try { res = await auth.call(t => http(url, { token: t })); } catch (e) { if (e.code === 'notfound') return; throw e; }
                    for (const it of res.value) if (it.file) out.set(prefix + it.name, { rev: it.eTag, modified: it.lastModifiedDateTime });
                    url = res['@odata.nextLink'];
                }
            }
            async function ensureFolders() {
                if (foldersReady) return;
                for (const [parent, name] of [['', PREFIX], [PREFIX, 'entries'], [PREFIX, 'quarantine']]) {
                    const url = parent ? `${base}:/${parent}:/children` : `${base}/children`;
                    try {
                        await auth.call(t => http(url, { method: 'POST', token: t, headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) }));
                    } catch (e) { if (e.code !== 'conflict') throw e; } // already exists
                }
                foldersReady = true;
            }
            return {
                async list() {
                    const out = new Map();
                    await children(PREFIX, '', out);
                    await children(`${PREFIX}/entries`, 'entries/', out);
                    return out;
                },
                async read(path) {
                    try {
                        const meta = await auth.call(t => http(`${item(path)}?$select=id,eTag,@microsoft.graph.downloadUrl`, { token: t }));
                        const text = await http(meta['@microsoft.graph.downloadUrl'], { expect: 'text' });
                        return { text, rev: meta.eTag };
                    } catch (e) { if (e.code === 'notfound') return null; throw e; }
                },
                async write(path, text, { ifRev, create } = {}) {
                    await ensureFolders();
                    const headers = { 'Content-Type': 'application/json' };
                    if (ifRev) headers['If-Match'] = ifRev;
                    const q = create ? '?@microsoft.graph.conflictBehavior=fail' : '';
                    const put = () => auth.call(t => http(`${item(path)}:/content${q}`, { method: 'PUT', token: t, headers, body: text }));
                    let meta;
                    try { meta = await put(); } catch (e) {
                        if (e.code !== 'notfound') throw e;
                        // The app folder was removed (e.g. from another device): recreate it once.
                        foldersReady = false;
                        await ensureFolders();
                        meta = await put();
                    }
                    return { rev: meta.eTag, modified: meta.lastModifiedDateTime };
                },
                async removeAll() {
                    try { await auth.call(t => http(`${base}:/${PREFIX}`, { method: 'DELETE', token: t, expect: 'none' })); } catch (e) { if (e.code !== 'notfound') throw e; }
                    foldersReady = false;
                }
            };
        }
    };

    /* =====================================================================
       Dropbox (App folder)
       Auth code + PKCE with offline access: refresh tokens without a secret,
       so the user stays connected until they disconnect.
       ===================================================================== */
    const DROPBOX = {
        id: 'dropbox', name: 'Dropbox',
        platforms: 'web, Android and iPhone',
        api: 'https://api.dropboxapi.com',
        content: 'https://content.dropboxapi.com',
        configured: () => !!(cfg().dropbox && cfg().dropbox.clientId),
        available: () => true,
        async authorizeUrl({ state }) {
            const { verifier, challenge } = await pkcePair();
            return { verifier, url: `https://www.dropbox.com/oauth2/authorize?${qs({
                client_id: cfg().dropbox.clientId, response_type: 'code', redirect_uri: redirectUri(), state,
                code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline'
            })}` };
        },
        async finish(params, verifier) {
            const tok = await http(`${this.api}/oauth2/token`, {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form({ code: params.get('code'), grant_type: 'authorization_code', code_verifier: verifier, client_id: cfg().dropbox.clientId, redirect_uri: redirectUri() })
            });
            let account = { label: 'Dropbox account', id: tok.account_id || null };
            try {
                const a = await http(`${this.api}/2/users/get_current_account`, { method: 'POST', token: tok.access_token, headers: { 'Content-Type': 'application/json' }, body: 'null' });
                account = { label: a.email || (a.name && a.name.display_name) || account.label, id: a.account_id || account.id };
            } catch (e) { /* optional */ }
            return { provider: 'dropbox', accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in || 14400) * 1000 - 60e3, refreshToken: tok.refresh_token, account };
        },
        async refresh(session) {
            const tok = await http(`${this.api}/oauth2/token`, {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form({ grant_type: 'refresh_token', refresh_token: session.refreshToken, client_id: cfg().dropbox.clientId })
            }).catch(e => { if (e.status === 400) throw new SyncError('auth', 'Dropbox access was removed. Reconnect to keep syncing.'); throw e; });
            return { accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in || 14400) * 1000 - 60e3 };
        },
        async revoke(session) {
            await http(`${this.api}/2/auth/token/revoke`, { method: 'POST', token: session.accessToken, expect: 'none' });
        },
        storage(auth) {
            const api = this.api, content = this.content;
            const full = p => `/${PREFIX}/${p}`;
            const rpc = (path, args) => auth.call(t => http(`${api}/2/${path}`, { method: 'POST', token: t, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) }));
            // Dropbox reports most failures as HTTP 409 with an error summary.
            const notFound = e => e.code === 'conflict' && e.status === 409 && e.summary && /not_found/.test(e.summary);
            const wrap = async fn => {
                try { return await fn(); } catch (e) {
                    if (e.status === 409 && /insufficient_space/.test(e.summary || '')) throw new SyncError('quota', 'Your Dropbox is full.');
                    throw e;
                }
            };
            return {
                async list() {
                    const out = new Map();
                    let res;
                    try { res = await wrap(() => rpc('files/list_folder', { path: `/${PREFIX}`, recursive: true })); } catch (e) { if (notFound(e)) return out; throw e; }
                    for (;;) {
                        for (const en of res.entries) {
                            if (en['.tag'] !== 'file') continue;
                            out.set(en.path_display.slice(PREFIX.length + 2), { rev: en.rev, modified: en.server_modified });
                        }
                        if (!res.has_more) break;
                        res = await rpc('files/list_folder/continue', { cursor: res.cursor });
                    }
                    return out;
                },
                async read(path) {
                    try {
                        const text = await wrap(() => auth.call(t => http(`${content}/2/files/download`, { method: 'POST', token: t, headers: { 'Dropbox-API-Arg': JSON.stringify({ path: full(path) }) }, expect: 'text' })));
                        return { text };
                    } catch (e) { if (notFound(e)) return null; throw e; }
                },
                async write(path, text, { ifRev, create } = {}) {
                    const mode = ifRev ? { '.tag': 'update', update: ifRev } : create ? { '.tag': 'add' } : { '.tag': 'overwrite' };
                    const arg = { path: full(path), mode, autorename: false, mute: true, strict_conflict: !!(ifRev || create) };
                    const meta = await wrap(() => auth.call(t => http(`${content}/2/files/upload`, {
                        method: 'POST', token: t, headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify(arg) }, body: text
                    })));
                    return { rev: meta.rev, modified: meta.server_modified };
                },
                async removeAll() {
                    try { await wrap(() => rpc('files/delete_v2', { path: `/${PREFIX}` })); } catch (e) { if (!notFound(e)) throw e; }
                }
            };
        }
    };

    /* =====================================================================
       iCloud: prepared for the native iOS app only.
       Browsers and Android have no iCloud Drive file API that fits this app,
       so the option is hidden unless the native plugin is present.
       Expected plugin (Capacitor): ICloudDocuments with
         isSignedIn() -> {signedIn}, list({dir}) -> {files:[{path, rev, modified}]},
         read({path}) -> {text}|null, write({path, text}) -> {rev, modified},
         removeDir({path})
       ===================================================================== */
    const plugin = () => root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.ICloudDocuments;
    const ICLOUD = {
        id: 'icloud', name: 'iCloud',
        platforms: 'the iPhone and iPad app',
        configured: () => !!plugin(),
        available: () => !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform() &&
            root.Capacitor.getPlatform && root.Capacitor.getPlatform() === 'ios' && plugin()),
        native: true,
        async connectNative() {
            const s = await plugin().isSignedIn();
            if (!s || !s.signedIn) throw new SyncError('denied', 'Sign in to iCloud in Settings on this device first.');
            return { provider: 'icloud', accessToken: 'native', expiresAt: Number.MAX_SAFE_INTEGER, account: { label: 'iCloud', id: 'icloud' } };
        },
        refresh: null,
        async revoke() { },
        storage() {
            const p = plugin();
            return {
                async list() {
                    const out = new Map();
                    const res = await p.list({ dir: PREFIX });
                    (res.files || []).forEach(f => out.set(f.path, { rev: f.rev, modified: f.modified }));
                    return out;
                },
                async read(path) { const r = await p.read({ path: `${PREFIX}/${path}` }); return r ? { text: r.text } : null; },
                async write(path, text) { return p.write({ path: `${PREFIX}/${path}`, text }); },
                async removeAll() { await p.removeDir({ path: PREFIX }); }
            };
        }
    };

    const DEFS = { google: GOOGLE, onedrive: ONEDRIVE, dropbox: DROPBOX, icloud: ICLOUD };

    /* ---------- Public API ---------- */
    function describe() {
        return Object.values(DEFS).map(d => ({ id: d.id, name: d.name, platforms: d.platforms, configured: d.configured(), available: d.available(), native: !!d.native }));
    }

    /** Starts sign-in. Browser providers leave the page and come back via oauth-callback.html. */
    async function beginConnect(id, { reconnect = false, loginHint } = {}) {
        const def = DEFS[id];
        if (!def || !def.configured()) throw new SyncError('config', `${def ? def.name : id} is not set up in this copy of the app.`);
        if (def.native) return { native: true };
        const state = randomString(24);
        const { url, verifier } = await def.authorizeUrl({ state, reconnect, loginHint });
        savePending({ provider: id, state, verifier, reconnect });
        root.location.assign(url);
        return { redirected: true };
    }

    /** Completes a sign-in (redirect result or native provider) and stores the session. */
    async function completeConnect(local, result) {
        const def = DEFS[result.provider];
        if (!def) throw new SyncError('config', 'Unknown provider');
        const session = def.native ? await def.connectNative() : await def.finish(result.params, result.verifier);
        await vault(local).save(session);
        return session;
    }

    /** Builds a storage adapter for the saved session (null if there is none). */
    async function restore(local, providerId) {
        const session = await vault(local).load();
        const def = DEFS[providerId];
        if (!def) return null;
        return adapterFor(def, local, session || { provider: providerId, accessToken: null, expiresAt: 0 });
    }

    function adapterFor(def, local, session) {
        const auth = makeAuth(def, local, session);
        const store = def.storage(auth);
        return {
            ...store,
            id: def.id,
            name: def.name,
            get session() { return auth.session; },
            async ensureAuth() {
                if (!auth.session.accessToken && !auth.session.refreshToken) throw new SyncError('auth', `Reconnect ${def.name} to keep syncing.`);
                await auth.ensure();
            },
            async signOut() {
                try { if (auth.session.accessToken) await def.revoke(auth.session); } catch (e) { /* best effort */ }
                await vault(local).clear();
            }
        };
    }

    /* ---------- In-memory provider (tests and diagnostics) ---------- */
    function createMemoryCloud() {
        const files = new Map(); // path -> { text, rev, modified }
        let rev = 0;
        return {
            files,
            adapter({ failWith = null, clock = () => Date.now() } = {}) {
                const ctl = { failWith, calls: [] };
                const guard = (op) => { ctl.calls.push(op); if (ctl.failWith) { const f = ctl.failWith; if (f.once) ctl.failWith = null; throw new SyncError(f.code, f.message || f.code, f); } };
                return {
                    id: 'memory', name: 'Test cloud', ctl,
                    async ensureAuth() { guard('auth'); },
                    async list() { guard('list'); const m = new Map(); for (const [p, f] of files) m.set(p, { rev: f.rev, modified: f.modified }); return m; },
                    async read(p) { guard('read'); const f = files.get(p); return f ? { text: f.text, rev: f.rev } : null; },
                    async write(p, text, { ifRev, create } = {}) {
                        guard('write');
                        const cur = files.get(p);
                        if (ifRev && cur && cur.rev !== ifRev) throw new SyncError('conflict', 'changed');
                        if (create && cur) throw new SyncError('conflict', 'exists');
                        const f = { text, rev: 'r' + (++rev), modified: new Date(clock()).toISOString() };
                        files.set(p, f);
                        return { rev: f.rev, modified: f.modified };
                    },
                    async removeAll() { guard('removeAll'); files.clear(); },
                    async signOut() { }
                };
            }
        };
    }

    /** Native apps: pass the URL the provider redirected to (e.g. from Capacitor's appUrlOpen). */
    function acceptCallbackUrl(url) {
        const u = new URL(url);
        root.localStorage.setItem(RESULT_KEY, JSON.stringify({ query: u.search, hash: u.hash, at: Date.now() }));
        root.dispatchEvent(new Event('stt-oauth-result'));
    }

    STT.providers = { acceptCallbackUrl, DEFS, describe, beginConnect, completeConnect, takeRedirectResult, restore, redirectUri, http, createMemoryCloud, vault };
})(typeof self !== 'undefined' ? self : globalThis);

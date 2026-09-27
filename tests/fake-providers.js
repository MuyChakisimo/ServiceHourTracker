/* Fake HTTP back ends for Google Drive, Microsoft Graph/identity and Dropbox,
 * used by tests/provider-tests.js and the browser tests. They implement only
 * the endpoints the app calls, following each provider's documented request
 * and response shapes, and enforce auth headers, PKCE and conditional writes.
 * They are NOT the real services.
 */
'use strict';
const crypto = require('crypto');

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const s256 = v => b64url(crypto.createHash('sha256').update(v).digest());
const json = (status, obj, headers = {}) => new Response(obj === null ? null : JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const text = (status, body) => new Response(body, { status, headers: { 'Content-Type': 'application/octet-stream' } });

function createFakeProviders() {
    let seq = 0;
    const tokens = new Map();       // access token -> { provider, exp }
    const refreshTokens = new Map(); // refresh token -> { provider, revoked }
    const codes = new Map();        // code -> { provider, challenge, redirect }
    const log = [];
    const issue = (provider, life = 3600e3) => { const t = `${provider}-at-${++seq}`; tokens.set(t, { provider, exp: Date.now() + life }); return t; };
    const authOk = (req, provider) => {
        const h = req.headers.get('Authorization') || '';
        const t = tokens.get(h.replace(/^Bearer /, ''));
        return t && t.provider === provider && t.exp > Date.now();
    };

    /* ---- consent screens: return the redirect the provider would send ---- */
    function consent(authUrl) {
        const u = new URL(authUrl);
        const p = u.searchParams;
        const redirect = p.get('redirect_uri');
        if (u.host === 'accounts.google.com') {
            if (p.get('response_type') !== 'token' || p.get('scope') !== 'https://www.googleapis.com/auth/drive.appdata') throw new Error('bad google authorize request');
            const t = issue('google');
            return `${redirect}#access_token=${t}&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent(p.get('scope'))}&state=${p.get('state')}`;
        }
        const code = `code-${++seq}`;
        if (u.host === 'login.microsoftonline.com') {
            if (p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256' || !/Files\.ReadWrite\.AppFolder/.test(p.get('scope')) || !/offline_access/.test(p.get('scope'))) throw new Error('bad microsoft authorize request');
            codes.set(code, { provider: 'onedrive', challenge: p.get('code_challenge'), redirect });
        } else if (u.host === 'www.dropbox.com') {
            if (p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256' || p.get('token_access_type') !== 'offline') throw new Error('bad dropbox authorize request');
            codes.set(code, { provider: 'dropbox', challenge: p.get('code_challenge'), redirect });
        } else throw new Error('unknown authorize host ' + u.host);
        return `${redirect}?code=${code}&state=${p.get('state')}`;
    }

    function exchange(form, provider) {
        if (form.get('grant_type') === 'authorization_code') {
            const c = codes.get(form.get('code'));
            if (!c || c.provider !== provider || s256(form.get('code_verifier') || '') !== c.challenge || c.redirect !== form.get('redirect_uri')) return json(400, { error: 'invalid_grant' });
            if (form.get('client_secret')) return json(400, { error: 'client secret must not be sent by a public client' });
            codes.delete(form.get('code'));
            const rt = `${provider}-rt-${++seq}`;
            refreshTokens.set(rt, { provider });
            const at = issue(provider, provider === 'dropbox' ? 14400e3 : 3600e3);
            if (provider === 'dropbox') return json(200, { access_token: at, token_type: 'bearer', expires_in: 14400, refresh_token: rt, account_id: 'dbid:1' });
            const idt = ['e30', b64url(JSON.stringify({ preferred_username: 'user@outlook.com', oid: 'oid-1' })), 'sig'].join('.');
            return json(200, { access_token: at, token_type: 'Bearer', expires_in: 3600, refresh_token: rt, id_token: idt, scope: form.get('scope') });
        }
        if (form.get('grant_type') === 'refresh_token') {
            const r = refreshTokens.get(form.get('refresh_token'));
            if (!r || r.revoked || r.provider !== provider) return json(400, { error: 'invalid_grant' });
            const at = issue(provider);
            if (provider === 'dropbox') return json(200, { access_token: at, token_type: 'bearer', expires_in: 14400 });
            const rt = `${provider}-rt-${++seq}`; refreshTokens.set(rt, { provider });
            return json(200, { access_token: at, expires_in: 3600, refresh_token: rt });
        }
        return json(400, { error: 'unsupported_grant_type' });
    }

    /* ---- Google Drive appDataFolder ---- */
    const drive = new Map(); // id -> { name, content, version, modifiedTime }
    async function google(req, u) {
        if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') { tokens.delete(u.searchParams.get('token')); return json(200, {}); }
        if (!authOk(req, 'google')) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
        const m = /^\/(upload\/)?drive\/v3\/(files|about)(?:\/([^/]+))?$/.exec(u.pathname);
        if (!m) return json(404, { error: 'no route' });
        const [, isUpload, kind, id] = m;
        if (kind === 'about') return json(200, { user: { emailAddress: 'user@gmail.com', displayName: 'User', permissionId: 'perm1' } });
        const stamp = f => ({ id: f.id, name: f.name, version: String(f.version), modifiedTime: f.modifiedTime });
        if (req.method === 'GET' && !id) {
            if (u.searchParams.get('spaces') !== 'appDataFolder') return json(403, { error: 'only appDataFolder allowed with drive.appdata' });
            const all = [...drive.values()].sort((a, b) => a.id.localeCompare(b.id));
            const size = 5; // small pages to exercise pagination
            const start = Number(u.searchParams.get('pageToken') || 0);
            const page = all.slice(start, start + size);
            return json(200, { files: page.map(stamp), ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) });
        }
        if (req.method === 'GET' && id) {
            const f = drive.get(id);
            if (!f) return json(404, { error: 'notFound' });
            return u.searchParams.get('alt') === 'media' ? text(200, f.content) : json(200, stamp(f));
        }
        if (req.method === 'DELETE') { if (!drive.delete(id)) return json(404, { error: 'notFound' }); return new Response(null, { status: 204 }); }
        if (isUpload && req.method === 'PATCH' && id) {
            const f = drive.get(id);
            if (!f) return json(404, { error: 'notFound' });
            f.content = await req.text(); f.version++; f.modifiedTime = new Date().toISOString();
            return json(200, stamp(f));
        }
        if (isUpload && req.method === 'POST' && u.searchParams.get('uploadType') === 'multipart') {
            const boundary = /boundary=(.+)$/.exec(req.headers.get('Content-Type'))[1];
            const parts = (await req.text()).split(`--${boundary}`).slice(1, -1).map(p => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
            const meta = JSON.parse(parts[0]);
            if (!meta.parents || meta.parents[0] !== 'appDataFolder') return json(403, { error: 'must be in appDataFolder' });
            const f = { id: `gf${++seq}`, name: meta.name, content: parts[1], version: 1, modifiedTime: new Date().toISOString() };
            drive.set(f.id, f);
            return json(200, stamp(f));
        }
        return json(400, { error: 'unsupported' });
    }

    /* ---- Microsoft Graph approot ---- */
    const od = new Map(); // path ('tracker', 'tracker/entries', 'tracker/prefs.json') -> { folder, content, etag, modified }
    const odDownloads = new Map();
    async function graph(req, u) {
        if (u.host === 'fake-download.onedrive.test') { const c = odDownloads.get(u.pathname); return c === undefined ? json(404, {}) : text(200, c); }
        if (!authOk(req, 'onedrive')) return json(401, { error: { code: 'InvalidAuthenticationToken' } });
        const root = '/v1.0/me/drive/special/approot';
        let p = decodeURIComponent(u.pathname);
        if (!p.startsWith(root)) return json(404, {});
        p = p.slice(root.length);
        const notFound = () => json(404, { error: { code: 'itemNotFound' } });
        const now = () => new Date().toISOString();
        let m;
        if ((m = /^:\/(.+?):\/children$/.exec(p)) || p === '/children') {
            const parent = m ? m[1] : '';
            if (parent && !(od.get(parent) || {}).folder) return notFound();
            if (req.method === 'GET') {
                const kids = [...od.entries()].filter(([k]) => k.startsWith(parent ? parent + '/' : '') && !k.slice(parent ? parent.length + 1 : 0).includes('/'));
                return json(200, { value: kids.map(([k, v]) => ({ name: k.split('/').pop(), eTag: v.etag, lastModifiedDateTime: v.modified, ...(v.folder ? { folder: {} } : { file: {} }) })) });
            }
            const body = await req.json();
            const key = parent ? `${parent}/${body.name}` : body.name;
            if (od.has(key)) return json(409, { error: { code: 'nameAlreadyExists' } });
            od.set(key, { folder: true, etag: `"f${++seq}"`, modified: now() });
            return json(201, { name: body.name, folder: {} });
        }
        if ((m = /^:\/(.+):\/content$/.exec(p)) && req.method === 'PUT') {
            const key = m[1];
            const parent = key.split('/').slice(0, -1).join('/');
            if (parent && !(od.get(parent) || {}).folder) return notFound();
            const cur = od.get(key);
            const ifMatch = req.headers.get('If-Match');
            if (ifMatch && (!cur || cur.etag !== ifMatch)) return json(412, { error: { code: 'preconditionFailed' } });
            if (u.searchParams.get('@microsoft.graph.conflictBehavior') === 'fail' && cur) return json(409, { error: { code: 'nameAlreadyExists' } });
            const item = { content: await req.text(), etag: `"e${++seq}"`, modified: now() };
            od.set(key, item);
            return json(cur ? 200 : 201, { name: key.split('/').pop(), eTag: item.etag, lastModifiedDateTime: item.modified, file: {} });
        }
        if ((m = /^:\/(.+)$/.exec(p))) {
            const key = m[1];
            const it = od.get(key);
            if (req.method === 'DELETE') {
                if (!it) return notFound();
                for (const k of [...od.keys()]) if (k === key || k.startsWith(key + '/')) od.delete(k);
                return new Response(null, { status: 204 });
            }
            if (!it || it.folder) return notFound();
            const dl = `/dl/${++seq}`;
            odDownloads.set(dl, it.content);
            return json(200, { id: key, eTag: it.etag, '@microsoft.graph.downloadUrl': `https://fake-download.onedrive.test${dl}` });
        }
        return json(400, {});
    }

    /* ---- Dropbox app folder ---- */
    const dbx = new Map(); // '/tracker/prefs.json' -> { content, rev, modified }
    async function dropbox(req, u) {
        if (u.host === 'api.dropboxapi.com' && u.pathname === '/oauth2/token') return exchange(new URLSearchParams(await req.text()), 'dropbox');
        if (!authOk(req, 'dropbox')) return json(401, { error_summary: 'expired_access_token/', error: { '.tag': 'expired_access_token' } });
        const err = s => json(409, { error_summary: s, error: {} });
        const meta = (path, f) => ({ '.tag': 'file', name: path.split('/').pop(), path_display: path, path_lower: path.toLowerCase(), rev: f.rev, server_modified: f.modified });
        const route = u.pathname;
        if (route === '/2/users/get_current_account') return json(200, { account_id: 'dbid:1', email: 'user@dropbox.test', name: { display_name: 'User' } });
        if (route === '/2/auth/token/revoke') { tokens.delete((req.headers.get('Authorization') || '').slice(7)); return json(200, null); }
        if (route === '/2/files/list_folder' || route === '/2/files/list_folder/continue') {
            const args = await req.json();
            const base = route.endsWith('continue') ? JSON.parse(Buffer.from(args.cursor, 'base64').toString()).path : args.path;
            const start = route.endsWith('continue') ? JSON.parse(Buffer.from(args.cursor, 'base64').toString()).start : 0;
            const all = [...dbx.entries()].filter(([k]) => k.startsWith(base + '/')).sort();
            if (!all.length && !start) return err('path/not_found/');
            const page = all.slice(start, start + 4);
            const more = start + 4 < all.length;
            return json(200, { entries: page.map(([k, f]) => meta(k, f)), has_more: more, cursor: Buffer.from(JSON.stringify({ path: base, start: start + 4 })).toString('base64') });
        }
        if (route === '/2/files/delete_v2') {
            const { path } = await req.json();
            const keys = [...dbx.keys()].filter(k => k === path || k.startsWith(path + '/'));
            if (!keys.length) return err('path_lookup/not_found/');
            keys.forEach(k => dbx.delete(k));
            return json(200, { metadata: { path_display: path } });
        }
        if (route === '/2/files/download') {
            const { path } = JSON.parse(req.headers.get('Dropbox-API-Arg'));
            const f = dbx.get(path);
            if (!f) return err('path/not_found/');
            return new Response(f.content, { status: 200, headers: { 'Dropbox-API-Result': JSON.stringify(meta(path, f)) } });
        }
        if (route === '/2/files/upload') {
            const arg = JSON.parse(req.headers.get('Dropbox-API-Arg'));
            const cur = dbx.get(arg.path);
            const tag = arg.mode['.tag'];
            if (tag === 'add' && cur) return err('path/conflict/file/');
            if (tag === 'update' && (!cur || cur.rev !== arg.mode.update)) return err('path/conflict/file/');
            const f = { content: await req.text(), rev: `0${(++seq).toString(16)}abc`, modified: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
            dbx.set(arg.path, f);
            return json(200, meta(arg.path, f));
        }
        return json(400, {});
    }

    async function fetchImpl(input, init = {}) {
        const req = new Request(input, init);
        const u = new URL(req.url);
        log.push(`${req.method} ${u.host}${u.pathname}`);
        if (u.host === 'login.microsoftonline.com') return exchange(new URLSearchParams(await req.text()), 'onedrive');
        if (u.host.endsWith('googleapis.com')) return google(req, u);
        if (u.host === 'graph.microsoft.com' || u.host === 'fake-download.onedrive.test') return graph(req, u);
        if (u.host.endsWith('dropboxapi.com')) return dropbox(req, u);
        return json(404, { error: 'unknown host ' + u.host });
    }

    return {
        fetch: fetchImpl, consent, log,
        stores: { google: drive, onedrive: od, dropbox: dbx },
        expireAccessTokens: () => { for (const t of tokens.values()) t.exp = 0; },
        revokeRefreshTokens: () => { for (const r of refreshTokens.values()) r.revoked = true; },
        wipe: provider => { const s = { google: drive, onedrive: od, dropbox: dbx }[provider]; s.clear(); },
        corruptOne: provider => {
            if (provider === 'google') { const f = [...drive.values()].find(x => /entries\//.test(x.name)); f.content = '{bad'; f.version++; }
            if (provider === 'onedrive') { const k = [...od.keys()].find(x => x.startsWith('tracker/entries/') && !od.get(x).folder); od.get(k).content = '{bad'; od.get(k).etag = '"bad"'; }
            if (provider === 'dropbox') { const k = [...dbx.keys()].find(x => x.includes('/entries/')); dbx.get(k).content = '{bad'; dbx.get(k).rev = '0bad'; }
        }
    };
}

module.exports = { createFakeProviders };

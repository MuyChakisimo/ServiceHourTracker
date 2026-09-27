/* Provider adapter tests against fake Google Drive, Microsoft Graph and Dropbox
 * back ends (tests/fake-providers.js). They check that each adapter speaks its
 * provider's API correctly: sign-in, upload, download, merge, token refresh,
 * expiry, missing and damaged cloud data, cloud deletion and disconnect.
 * Real-service testing still needs your own client IDs (see CLOUD_SYNC_SETUP.md).
 * Run:  node tests/provider-tests.js
 */
'use strict';
const path = require('path');
const assert = require('assert');
const { createFakeProviders } = require('./fake-providers');

const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), clear: () => mem.clear() };
globalThis.location = { href: 'https://example.github.io/ServiceHourTracker/index.html', assign() {} };
for (const f of ['theme', 'dates', 'stats', 'storage', 'achievements', 'sync-core', 'localdb', 'sync-engine', 'providers']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { storage: Store, localdb: LDB, syncEngine: SE, providers: P } = globalThis.STT;
globalThis.STT.cloudConfig = { google: { clientId: 'g-client' }, onedrive: { clientId: 'm-client', tenant: 'common' }, dropbox: { clientId: 'd-appkey' } };

const eq = assert.deepStrictEqual;
let passed = 0, failed = 0;

async function signIn(fake, provider, local) {
    let authUrl;
    globalThis.location.assign = url => { authUrl = url; };
    await P.beginConnect(provider);
    const back = new URL(fake.consent(authUrl));
    eq(back.origin + back.pathname, 'https://example.github.io/ServiceHourTracker/oauth-callback.html');
    // What oauth-callback.html does:
    localStorage.setItem('stt.oauth.result', JSON.stringify({ query: back.search, hash: back.hash, at: Date.now() }));
    const result = P.takeRedirectResult();
    assert.ok(result && !result.error, result && result.error);
    return P.completeConnect(local, result);
}

async function device(fake, provider, legacy) {
    const local = LDB.createLocalStore({ backend: LDB.memoryBackend(), mirror: false });
    await local.open(legacy || { database: {}, settings: Store.defaultSettings(), medals: Store.defaultMedals() });
    const session = await signIn(fake, provider, local);
    const engine = SE.createSyncEngine({ local, isOnline: () => true });
    const adapter = await P.restore(local, provider);
    await engine.connect(adapter, { provider, account: session.account, choice: 'merge' });
    await engine.sync('connect');
    const edit = async fn => { const s = structuredClone(local.state); fn(s); await local.save(s); };
    return { local, engine, adapter, session, edit, state: () => local.state };
}

(async () => {
    for (const provider of ['google', 'onedrive', 'dropbox']) {
        const t = async (name, fn) => {
            try { await fn(); passed++; } catch (e) { failed++; console.error(`✗ [${provider}] ${name}\n  ${e.stack}`); }
        };
        const fake = createFakeProviders();
        globalThis.fetch = fake.fetch;
        let A, B;
        const db = { '2026-09-10': { time: 120, studies: 1, notes: 'Door to door', plannedTime: 120 }, '2026-10-02': { time: 60 }, '2027-08-31': { plannedTime: 90 } };

        await t('sign-in, account label and initial upload', async () => {
            A = await device(fake, provider, { database: db, settings: { ...Store.defaultSettings(), yearGoals: { '2026-09': 600, '2027-09': 650 } }, medals: Store.defaultMedals() });
            eq(A.engine.status.phase, 'idle', JSON.stringify(A.engine.status.error));
            assert.ok(/@/.test(A.session.account.label), 'account label ' + A.session.account.label);
            eq(A.local.pendingCount(), 0);
            const names = [...fake.stores[provider].keys()].map(String).join(' ');
            if (provider !== 'google') assert.ok(/manifest\.json/.test(names) && /prefs\.json/.test(names) && /2026-09\.json/.test(names), names);
            else assert.ok([...fake.stores.google.values()].some(f => f.name === 'tracker/entries/2026-09.json'));
        });
        await t('token is stored encrypted, not in localStorage', async () => {
            const raw = await A.local.kvGet('providerSession');
            assert.ok(raw && raw.ct && raw.iv && !JSON.stringify(raw).includes(A.session.accessToken));
            assert.ok(![...mem.values()].some(v => v.includes(A.session.accessToken)));
        });
        await t('second device downloads everything', async () => {
            B = await device(fake, provider);
            eq(B.state().database, db);
            eq(B.state().settings.yearGoals, { '2026-09': 600, '2027-09': 650 });
        });
        await t('subsequent upload and download, per-record merge', async () => {
            await A.edit(s => { s.database['2026-09-11'] = { time: 30 }; });
            await new Promise(r => setTimeout(r, 5));
            await B.edit(s => { s.database['2026-09-10'] = { ...s.database['2026-09-10'], notes: 'edited on B' }; });
            await A.engine.sync(); await B.engine.sync(); await A.engine.sync();
            for (const d of [A, B]) {
                eq(d.state().database['2026-09-10'].notes, 'edited on B');
                eq(d.state().database['2026-09-11'].time, 30);
            }
        });
        await t('expired access token', async () => {
            fake.expireAccessTokens();
            await A.edit(s => { s.database['2026-09-12'] = { time: 15 }; });
            await A.engine.sync();
            if (provider === 'google') {
                eq(A.engine.status.phase, 'auth'); // no refresh tokens for browser apps
                eq(A.local.pendingCount() > 0, true);
                A.session = await signIn(fake, provider, A.local); // "Reconnect"
                A.adapter = await P.restore(A.local, provider);
                await A.engine.attach(A.adapter);
                await A.engine.sync();
            }
            eq(A.engine.status.phase, 'idle', JSON.stringify(A.engine.status.error));
            eq(A.local.pendingCount(), 0);
        });
        if (provider !== 'google') {
            await t('revoked refresh token asks to reconnect', async () => {
                fake.expireAccessTokens(); fake.revokeRefreshTokens();
                await B.engine.sync();
                eq(B.engine.status.phase, 'auth');
                B.session = await signIn(fake, provider, B.local);
                B.adapter = await P.restore(B.local, provider);
                await B.engine.attach(B.adapter);
                await B.engine.sync();
                eq(B.engine.status.phase, 'idle');
                eq(B.state().database['2026-09-12'].time, 15);
                // The fake revoked every token, so device A reconnects too.
                A.session = await signIn(fake, provider, A.local);
                A.adapter = await P.restore(A.local, provider);
                await A.engine.attach(A.adapter);
            });
        } else {
            B.session = await signIn(fake, provider, B.local);
            B.adapter = await P.restore(B.local, provider);
            await B.engine.attach(B.adapter);
            await B.engine.sync();
        }
        await t('damaged cloud file does not affect local data', async () => {
            fake.corruptOne(provider);
            await A.engine.syncNow();
            eq(A.engine.status.phase, 'idle', JSON.stringify(A.engine.status.error));
            eq(A.state().database['2026-09-10'].notes, 'edited on B');
            await B.engine.syncNow();
            eq(B.state().database, A.state().database);
        });
        await t('missing cloud data is rebuilt from the device', async () => {
            fake.wipe(provider);
            await A.engine.syncNow();
            eq(A.engine.status.phase, 'idle', JSON.stringify(A.engine.status.error));
            await B.engine.syncNow();
            eq(B.state().database, A.state().database);
            eq(Object.keys(B.state().database).length, 5);
        });
        await t('delete cloud backup, local untouched', async () => {
            await A.engine.deleteCloudData();
            const left = [...fake.stores[provider].keys()];
            eq(left.length, 0, left.join(','));
            eq(Object.keys(A.state().database).length, 5);
        });
        await t('disconnect clears the token (and revokes it where possible)', async () => {
            await A.engine.disconnect();
            eq(await A.local.kvGet('providerSession'), undefined);
            eq(Object.keys(A.state().database).length, 5);
            if (provider !== 'onedrive') assert.ok(fake.log.some(l => /revoke/.test(l)));
        });
        await t('state mismatch is rejected', async () => {
            localStorage.setItem('stt.oauth.pending', JSON.stringify({ provider, state: 'expected', at: Date.now() }));
            localStorage.setItem('stt.oauth.result', JSON.stringify({ query: '?code=x&state=evil', hash: '' }));
            const r = P.takeRedirectResult();
            assert.ok(r.error && /did not match/.test(r.error));
        });
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();

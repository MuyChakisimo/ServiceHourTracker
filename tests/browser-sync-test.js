/* Browser end-to-end test of cloud sync in the real app (Chromium via Playwright).
 * Provider sign-in pages and APIs are replaced by tests/fake-providers.js.
 * Needs Playwright (npm i -D playwright) and the app served on port 8765:
 *   npx http-server -p 8765 -c-1 &   node tests/browser-sync-test.js
 */
const { chromium } = require('playwright');
const assert = require('assert');
const { createFakeProviders } = require('./fake-providers.js');
const SP = process.argv[2] || require('os').tmpdir();
const URL0 = 'http://localhost:8765/index.html';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓', m); };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Dropbox-API-Arg, If-Match', 'Access-Control-Expose-Headers': 'Dropbox-API-Result' };

async function wire(ctx, fake) {
  await ctx.route('**/js/cloud-config.js', r => r.fulfill({ contentType: 'application/javascript', body: `(function(){ (self.STT=self.STT||{}).cloudConfig = { redirectPath:'oauth-callback.html', google:{clientId:'g'}, onedrive:{clientId:'m', tenant:'common'}, dropbox:{clientId:'d'} }; })();` }));
  const authorize = async route => {
    const loc = fake.consent(route.request().url());
    await route.fulfill({ status: 302, headers: { Location: loc } });
  };
  await ctx.route('https://accounts.google.com/**', authorize);
  await ctx.route('https://www.dropbox.com/oauth2/authorize**', authorize);
  await ctx.route(/https:\/\/(login\.microsoftonline\.com|graph\.microsoft\.com|[a-z0-9.]*googleapis\.com|[a-z.]*dropboxapi\.com|fake-download\.onedrive\.test)\/.*/, async route => {
    const req = route.request();
    if (req.url().includes('/oauth2/v2.0/authorize')) return authorize(route);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const res = await fake.fetch(req.url(), { method: req.method(), headers: req.headers(), body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() });
    const headers = { ...CORS }; res.headers.forEach((v, k) => { headers[k] = v; });
    await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
  });
}

async function newDevice(browser, fake, seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await wire(ctx, fake);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(URL0);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  if (seed) {
    await page.evaluate(seed => { localStorage.clear(); indexedDB.deleteDatabase('ServiceTimeTracker'); for (const k in seed) localStorage.setItem(k, JSON.stringify(seed[k])); }, seed);
    await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  }
  return { ctx, page };
}
const openSync = async page => { await page.click('#menu-btn'); await page.click('[data-open="sync-panel"]'); await page.waitForSelector('#sync-panel[open]'); };
const st = page => page.evaluate(() => STT.debug.state);
const status = page => page.evaluate(() => STT.sync.status);
const waitIdle = page => page.waitForFunction(() => STT.sync && STT.sync.status.phase === 'idle' && STT.sync.status.lastSyncAt, null, { timeout: 15000 });

(async () => {
  const browser = await chromium.launch();

  console.log('Migration of existing 5.x data to IndexedDB');
  const fake0 = createFakeProviders();
  const seed = {
    serviceTimeTrackerDB: { '2026-09-10': { time: 150, studies: 2, notes: 'Return visit', plannedTime: 120 }, '2026-10-05': { time: 60 }, '2027-08-31': { time: 90, plannedTime: 90 } },
    serviceTimeTrackerSettings: { schemaVersion: 2, monthGoal: 50, yearGoal: 600, monthGoals: {}, yearGoals: { '2027-09': 650 }, serviceYearStartMonth: 8, weekStartsOn: 1, theme: { preset: 'blue' } },
    serviceTimeTrackerMedals: { completedMonths: ['2026-09'], completedYears: [] }
  };
  const A = await newDevice(browser, fake0, seed);
  const mig = await A.page.evaluate(async () => {
    const recs = STT.debug.local.records();
    return { backend: STT.debug.local.backendKind, n: recs.length, ids: recs.map(r => r.id).sort(), ls: !!localStorage.getItem('serviceTimeTrackerDB'), flag: localStorage.getItem('serviceTimeTrackerStorage'), db: STT.debug.state.db, ys: STT.debug.state.settings.yearGoals };
  });
  ok(mig.backend === 'indexeddb' && mig.flag === 'indexeddb', 'data now lives in IndexedDB');
  ok(JSON.stringify(mig.db) === JSON.stringify(seed.serviceTimeTrackerDB) && mig.ys['2027-09'] === 650, 'entries and historical goals preserved');
  ok(mig.ls, 'localStorage copy kept (not deleted)');
  ok(mig.ids.includes('p:weekStartsOn') && mig.ids.includes('p:theme') && mig.ids.includes('mm:2026-09') && !mig.ids.includes('p:monthGoal'), 'records created for real choices, not untouched defaults');
  await A.page.reload(); await A.page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  ok((await A.page.evaluate(() => STT.debug.local.records().length)) === mig.n, 'no second migration on reload');
  await A.ctx.close();

  console.log('Local-only use and Account & Sync (no providers configured)');
  const plain = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const pp = await plain.newPage();
  await pp.goto(URL0); await pp.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await openSync(pp);
  const txt = await pp.textContent('#sync-body');
  ok(/stored only on this device/.test(txt) && /isn’t available in this copy/.test(txt) && !(await pp.$('.provider-row')), 'no-provider build explains itself, offers no broken buttons');
  ok(/iCloud will be available in the iPhone and iPad app/.test(txt) && !(await pp.$('[data-provider="icloud"]')), 'iCloud hidden in browsers');
  await plain.close();

  for (const provider of ['dropbox', 'google', 'onedrive']) {
    console.log(`Provider: ${provider}`);
    const fake = createFakeProviders();
    const dA = await newDevice(browser, fake, seed);
    await openSync(dA.page);
    await dA.page.waitForTimeout(300);
    if (provider === 'dropbox') await dA.page.screenshot({ path: `${SP}/sync-disconnected.png` });
    await Promise.all([dA.page.waitForURL(/index\.html/), dA.page.click(`[data-provider="${provider}"]`)]);
    await dA.page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    await dA.page.waitForSelector('#choice-modal[open]', { timeout: 10000 });
    const msg = await dA.page.textContent('#choice-message');
    ok(/Existing data found/.test(await dA.page.textContent('#choice-title')) && /3 service entries/.test(msg) && /1 note/.test(msg) && /2 planned days/.test(msg), `A: existing-data prompt (${msg.split('\n')[0]})`);
    await dA.page.click('#choice-buttons button:has-text("Upload & Sync")');
    await waitIdle(dA.page);
    const sA = await status(dA.page);
    ok(sA.connected && sA.pending === 0 && /@/.test(sA.account.label), `A: connected as ${sA.account.label}, all uploaded`);
    ok([...fake.stores[provider].values()].length > 0, 'A: files in the provider app folder');
    ok(await dA.page.evaluate(() => !localStorage.getItem('stt.oauth.result') && !localStorage.getItem('stt.oauth.pending')), 'A: sign-in hand-off cleaned up');
    ok(await dA.page.evaluate(() => !Object.values(localStorage).some(v => /-at-\d/.test(v))), 'A: no access token in localStorage');
    if (provider === 'dropbox') { await dA.page.waitForTimeout(200); await dA.page.screenshot({ path: `${SP}/sync-connected.png` }); }

    const dB = await newDevice(browser, fake);
    await openSync(dB.page);
    await Promise.all([dB.page.waitForURL(/index\.html/), dB.page.click(`[data-provider="${provider}"]`)]);
    await dB.page.waitForSelector('#choice-modal[open]', { timeout: 10000 });
    ok(/Tracker data found/.test(await dB.page.textContent('#choice-title')), 'B: cloud-data prompt');
    await dB.page.click('#choice-buttons button:has-text("Download & Sync")');
    await waitIdle(dB.page);
    const sB = await st(dB.page);
    ok(JSON.stringify(sB.db) === JSON.stringify(seed.serviceTimeTrackerDB) && sB.settings.weekStartsOn === 1 && sB.settings.yearGoals['2027-09'] === 650 && sB.settings.theme.preset === 'blue', 'B: data, goals and preferences downloaded');
    ok((await dB.page.$$eval('.weekday', w => w[0].textContent)) === 'Mon', 'B: calendar re-rendered with synced week start');

    // Edit on B, automatic sync, Sync Now on A
    await dB.page.evaluate(() => STT.layers.closeAll()); await dB.page.waitForTimeout(150);


    const todayKey = await dB.page.evaluate(() => STT.debug.state.today);
    await dB.page.click(`.day[data-key="${todayKey}"]`);
    await dB.page.fill('#entry-hours', '2'); await dB.page.fill('#entry-notes', `from B ${provider}`);
    await dB.page.click('#entry-form button[type=submit]');
    await dB.page.waitForFunction(() => STT.sync.status.pending === 0 && STT.sync.status.phase === 'idle', null, { timeout: 15000 });
    ok(true, 'B: automatic sync after Save');
    await dA.page.evaluate(() => STT.sync.syncNow());
    await waitIdle(dA.page);
    ok((await st(dA.page)).db[todayKey].notes === `from B ${provider}`, 'A: receives B\'s change');

    // Offline on A
    await dA.ctx.setOffline(true);
    await dA.page.evaluate(() => STT.layers.closeAll()); await dA.page.waitForTimeout(150);
    const k2 = await dA.page.evaluate(() => STT.dates.addDays(STT.debug.state.today, -1));
    await dA.page.evaluate(k => { const cell = document.querySelector(`.day[data-key="${k}"]`); cell.click(); }, k2);
    await dA.page.fill('#entry-hours', '1'); await dA.page.click('#entry-form button[type=submit]');
    await dA.page.waitForFunction(() => STT.sync.status.phase === 'offline' || STT.sync.status.pending > 0);
    await dA.page.evaluate(() => STT.sync.sync());
    const off = await status(dA.page);
    ok(off.phase === 'offline' && off.pending === 1 && (await st(dA.page)).db[k2].time === 60, 'A offline: saved locally, 1 change waiting');
    ok(!(await dA.page.isHidden('#sync-dot')), 'A offline: subtle badge on the menu button');
    await dA.ctx.setOffline(false);
    await dA.page.waitForFunction(() => STT.sync.status.phase === 'idle' && STT.sync.status.pending === 0, null, { timeout: 15000 });
    ok(true, 'A: back online, pending change uploaded automatically');
    await dB.page.evaluate(() => STT.sync.syncNow()); await waitIdle(dB.page);
    ok((await st(dB.page)).db[k2].time === 60, 'B: receives the offline edit');

    // Delete on A is not resurrected by B
    await dA.page.evaluate(k => { document.querySelector(`.day[data-key="${k}"]`).click(); }, k2);
    await dA.page.fill('#entry-hours', ''); await dA.page.click('#entry-form button[type=submit]');
    await dA.page.waitForFunction(() => STT.sync.status.pending === 0 && STT.sync.status.phase === 'idle', null, { timeout: 15000 });
    await dB.page.evaluate(() => STT.sync.syncNow()); await waitIdle(dB.page);
    ok(!(await st(dB.page)).db[k2], 'B: deletion arrives (tombstone)');

    // Google: token expiry -> Reconnect
    if (provider === 'google') {
      fake.expireAccessTokens();
      await dA.page.evaluate(() => STT.sync.syncNow());
      await dA.page.waitForFunction(() => STT.sync.status.phase === 'auth');
      await openSync(dA.page);
      ok(/Sign-in expired/.test(await dA.page.textContent('#sync-body')), 'A: expired Google sign-in shown with Reconnect');
      await Promise.all([dA.page.waitForURL(/index\.html/), dA.page.click('#sync-reconnect-btn')]);
      await dA.page.waitForFunction(() => document.documentElement.dataset.ready === '1');
      await dA.page.waitForFunction(() => STT.sync && STT.sync.status.phase === 'idle' && STT.sync.status.connected, null, { timeout: 15000 });
      ok(!(await dA.page.$('#choice-modal[open]')), 'A: reconnect resumes without re-asking');
    }

    // Import while syncing merges
    await dA.page.evaluate(() => STT.layers.closeAll()); await dA.page.waitForTimeout(150);
    await dA.page.click('#menu-btn'); await dA.page.click('[data-open="data-panel"]');
    require('fs').writeFileSync(`${SP}/import-${provider}.json`, JSON.stringify({ database: { '2025-01-15': { time: 30 } }, settings: { monthGoal: 50, yearGoal: 600 } }));
    await dA.page.setInputFiles('#import-file-input', `${SP}/import-${provider}.json`);
    await dA.page.waitForSelector('#alert-modal[open]');
    ok(/merged, not replace/.test(await dA.page.textContent('#alert-message')), 'import while syncing offers a merge');
    await dA.page.click('#alert-ok-btn'); await dA.page.waitForTimeout(300);
    await dA.page.click('#alert-ok-btn').catch(() => {});
    const afterImport = await st(dA.page);
    ok(afterImport.db['2025-01-15'] && afterImport.db['2026-09-10'] && afterImport.db[todayKey], 'import merged, nothing removed');
    await dA.page.waitForFunction(() => STT.sync.status.pending === 0 && STT.sync.status.phase === 'idle', null, { timeout: 15000 });

    // Disconnect keeping local copy
    await dA.page.evaluate(() => STT.layers.closeAll()); await dA.page.waitForTimeout(150);
    await openSync(dA.page);
    await dA.page.click('#sync-disconnect-btn');
    await dA.page.waitForSelector('#choice-modal[open]');
    await dA.page.click('#choice-buttons button:has-text("Keep a local copy")');
    await dA.page.waitForFunction(() => !STT.sync.status.connected);
    ok(Object.keys((await st(dA.page)).db).length >= 4 && [...fake.stores[provider].values()].length > 0, 'disconnect: local copy kept, cloud untouched');
    ok(!(await dA.page.evaluate(() => STT.debug.local.kvGet('providerSession'))), 'disconnect: token removed');

    // Delete cloud backup from B (Google: B's token expired in the step above, so it reconnects first)
    if (provider === 'google') {
      await dB.page.evaluate(() => STT.sync.syncNow());
      await dB.page.waitForFunction(() => STT.sync.status.phase === 'auth');
      await openSync(dB.page);
      await Promise.all([dB.page.waitForURL(/index\.html/), dB.page.click('#sync-reconnect-btn')]);
      await dB.page.waitForFunction(() => document.documentElement.dataset.ready === '1');
      await dB.page.waitForFunction(() => STT.sync && STT.sync.status.phase === 'idle' && STT.sync.status.connected, null, { timeout: 15000 });
      await dB.page.evaluate(() => STT.layers.closeAll()); await dB.page.waitForTimeout(150);
    }
    await openSync(dB.page);
    await dB.page.click('#sync-delete-cloud-btn');
    await dB.page.waitForSelector('#alert-modal[open]'); await dB.page.click('#alert-ok-btn');
    await dB.page.waitForTimeout(400); await dB.page.click('#alert-ok-btn');
    await dB.page.waitForFunction(() => !STT.sync.status.connected, null, { timeout: 10000 });
    const leftover = [...fake.stores[provider].entries()].filter(([k, v]) => !(v && v.folder));
    ok(leftover.length === 0 && Object.keys((await st(dB.page)).db).length >= 3, 'delete cloud backup: cloud empty, B keeps its data');

    ok(dA.page.errors.length === 0 && dB.page.errors.length === 0, 'no console errors ' + [...dA.page.errors, ...dB.page.errors].join(' | '));
    await dA.ctx.close(); await dB.ctx.close();
  }
  console.log(n + ' checks passed');
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });

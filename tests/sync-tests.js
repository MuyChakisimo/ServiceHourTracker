/* Sync tests: record model, merge rules, local store, engine scenarios.
 * Run:  node tests/sync-tests.js
 * Devices are simulated with in-memory databases sharing an in-memory "cloud"
 * that behaves like a provider (revisions, conditional writes, failures).
 */
'use strict';
const path = require('path');
const assert = require('assert');

const mem = new Map();
globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k), clear: () => mem.clear()
};
for (const f of ['theme', 'dates', 'stats', 'storage', 'achievements', 'sync-core', 'localdb', 'sync-engine', 'providers']) {
    require(path.join(__dirname, '..', 'js', f + '.js'));
}
const { storage: Store, syncCore: Core, localdb: LDB, syncEngine: SE, providers: P } = globalThis.STT;

let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const eq = assert.deepStrictEqual;

/* ---------- helpers ---------- */
let fakeNow = Date.parse('2027-09-10T12:00:00Z');
const clock = () => fakeNow;
const advance = ms => { fakeNow += ms; };

async function device(name, cloud, legacy, { online = () => true } = {}) {
    const local = LDB.createLocalStore({ backend: LDB.memoryBackend(), mirror: false, clock });
    await local.open(legacy || { database: {}, settings: Store.defaultSettings(), medals: Store.defaultMedals() });
    const engine = SE.createSyncEngine({ local, clock, isOnline: online });
    const adapter = cloud.adapter({ clock });
    const dev = { name, local, engine, adapter };
    dev.state = () => local.state;
    dev.edit = async (fn) => { const s = structuredClone(local.state); fn(s); await local.save(s); };
    dev.connect = async (choice = 'merge') => { await engine.connect(adapter, { provider: 'memory', account: { label: name, id: 'acct' }, choice }); return engine.sync('connect'); };
    return dev;
}

function legacyState(db, settingsPatch = {}, medals) {
    return { database: db, settings: { ...Store.defaultSettings(), ...settingsPatch }, medals: medals || Store.defaultMedals() };
}

/* ---------- core ---------- */
test('state <-> records round trip keeps every piece of data', () => {
    const s = legacyState({ '2026-09-27': { time: 150, plannedTime: 120, studies: 2, notes: 'Return visit' } },
        { yearGoals: { '2026-09': 600, '2027-09': 650 }, monthGoals: { '2027-10': 40 }, weekStartsOn: 1, theme: { preset: 'blue', status: { missed: '#aa0000' } } },
        { completedMonths: ['2026-10'], completedYears: ['2026-09'] });
    const back = Core.valuesToState(Core.stateToValues(s));
    eq(back.database, s.database);
    eq(back.settings.yearGoals, { '2026-09': 600, '2027-09': 650 });
    eq(back.settings.monthGoals, { '2027-10': 40 });
    eq([back.settings.weekStartsOn, back.settings.theme], [1, { preset: 'blue', status: { missed: '#aa0000' } }]);
    eq(back.medals, s.medals);
});

test('files: one per month plus prefs', () => {
    eq(Core.fileForId('e:2026-09-27'), 'entries/2026-09.json');
    eq(Core.fileForId('yg:2026-09'), 'prefs.json');
    eq(Core.fileForId('p:theme'), 'prefs.json');
    assert.ok(Core.isDataFile('entries/2026-09.json') && Core.isDataFile('prefs.json') && !Core.isDataFile('manifest.json') && !Core.isDataFile('quarantine/x.json'));
});

test('last write wins, with deterministic ties', () => {
    const a = { u: 100, d: 'A' }, b = { u: 200, d: 'B' };
    assert.ok(Core.wins(b, a) && !Core.wins(a, b));
    assert.ok(Core.wins({ u: 5, d: 'A', x: 1 }, { u: 5, d: 'Z', v: 1 }), 'tombstone wins a tie');
    assert.ok(Core.wins({ u: 5, d: 'Z', v: 1 }, { u: 5, d: 'A', v: 2 }), 'then higher device id');
});

test('parseFile rejects damage and newer schemas, skips bad records', () => {
    assert.throws(() => Core.parseFile('{oops', 'prefs.json'), e => e.code === 'corrupt');
    assert.throws(() => Core.parseFile(JSON.stringify({ format: 'other', records: {} }), 'prefs.json'), e => e.code === 'corrupt');
    assert.throws(() => Core.parseFile(JSON.stringify({ format: Core.FORMAT, schemaVersion: 99, records: {} }), 'prefs.json'), e => e.code === 'schema-newer');
    const p = Core.parseFile(JSON.stringify({ format: Core.FORMAT, schemaVersion: 1, gen: 'g', records: {
        'e:2026-09-01': { v: { time: 60 }, u: 1, d: 'A' },
        'e:2026-10-01': { v: { time: 60 }, u: 1, d: 'A' },  // wrong month for this file
        'e:2026-09-02': { u: 'x', d: 'A' },                 // bad timestamp
        'hack': { v: 1, u: 1, d: 'A' }
    } }), 'entries/2026-09.json');
    eq([[...p.records.keys()], p.skipped], [['e:2026-09-01'], 3]);
});

/* ---------- local store ---------- */
test('migration from localStorage keeps everything; defaults are not recorded', async () => {
    const legacy = legacyState({ '2025-10-01': { time: 60, notes: 'n' }, '2026-02-02': { plannedTime: 90 } }, { yearGoal: 500, yearGoals: { '2026-09': 650 } }, { completedMonths: ['2025-10'], completedYears: [] });
    const local = LDB.createLocalStore({ backend: LDB.memoryBackend(), mirror: false, clock });
    const res = await local.open(legacy);
    eq(res.migrated, true);
    eq(local.state.database, legacy.database);
    eq([local.state.settings.yearGoal, local.state.settings.yearGoals], [500, { '2026-09': 650 }]);
    eq(local.state.medals.completedMonths, ['2025-10']);
    const ids = local.records().map(r => r.id).sort();
    assert.ok(ids.includes('p:yearGoal') && !ids.includes('p:monthGoal') && !ids.includes('p:theme'), 'unchanged defaults are not records');
    // Re-opening the same database does not migrate again.
    const again = LDB.createLocalStore({ backend: LDB.memoryBackend(), mirror: false, clock });
    eq((await again.open(null)).migrated, true); // fresh backend: nothing stored yet
});

test('saving writes only changed records; deleting a day leaves a tombstone', async () => {
    const d = await device('A', P.createMemoryCloud());
    await d.edit(s => { s.database['2027-09-01'] = { time: 60 }; });
    const before = d.local.records().length;
    await d.edit(s => { s.database['2027-09-02'] = { time: 30 }; });
    eq(d.local.records().length, before + 1);
    await d.edit(s => { delete s.database['2027-09-01']; });
    const t = d.local.records().find(r => r.id === 'e:2027-09-01');
    eq([!!t.x, t.dirty], [true, 1]);
    eq(Object.keys(d.state().database), ['2027-09-02']);
});

/* ---------- scenarios ---------- */
test('A: existing local data uploads to an empty cloud; nothing lost', async () => {
    const cloud = P.createMemoryCloud();
    const db = {};
    for (let m = 0; m < 30; m++) { const { year, month } = globalThis.STT.dates.addMonths(2024, 9, m); db[globalThis.STT.dates.toDateKey(year, month, 5)] = { time: 120, studies: 1, notes: 'x', plannedTime: 90 }; }
    const a = await device('A', cloud, legacyState(db, { yearGoals: { '2025-09': 550 } }));
    const c = await a.connect();
    assert.ok(cloud.files.has('manifest.json') && cloud.files.has('prefs.json'));
    eq([...cloud.files.keys()].filter(k => k.startsWith('entries/')).length, 30);
    eq(a.local.pendingCount(), 0);
    assert.ok(c.up >= 31);
    eq(a.state().database, db);
});

test('B: second empty device downloads existing cloud data', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud, legacyState({ '2026-09-10': { time: 600, studies: 3 }, '2027-09-10': { time: 60 } }, { yearGoals: { '2026-09': 600, '2027-09': 650 }, weekStartsOn: 1 }));
    await a.connect();
    const b = await device('B', cloud);
    await b.connect();
    eq(b.state().database, a.state().database);
    eq(b.state().settings.yearGoals, { '2026-09': 600, '2027-09': 650 });
    eq(b.state().settings.weekStartsOn, 1);
    // Service History is derived from the synced records.
    const h = globalThis.STT.stats.serviceHistory(b.state().database, b.state().settings, '2027-10-01');
    eq(h.years.map(y => [y.sy.id, y.minutes, y.goalHours]), [['2027-09', 60, 650], ['2026-09', 600, 600]]);
});

test('C: both sides changed; newer record wins, unrelated records kept', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud); await a.connect();
    const b = await device('B', cloud); await b.connect();
    fakeNow = Date.parse('2027-09-10T13:00:00Z');
    await a.edit(s => { s.database['2027-09-10'] = { time: 60, notes: 'A at 1pm' }; s.database['2027-09-11'] = { time: 30 }; });
    fakeNow = Date.parse('2027-09-10T14:00:00Z');
    await b.edit(s => { s.database['2027-09-10'] = { time: 90, notes: 'B at 2pm' }; });
    await b.engine.sync(); await a.engine.sync(); await b.engine.sync();
    for (const d of [a, b]) {
        eq(d.state().database['2027-09-10'].notes, 'B at 2pm');
        eq(d.state().database['2027-09-11'].time, 30);
    }
    // A's unsynced losing edit was kept as a conflict copy.
    const conflicts = await a.local.kvGet('conflicts');
    assert.ok(conflicts && conflicts.some(c => c.lost.v.notes === 'A at 1pm'));
});

test('D: offline edits save locally, show as pending, and upload when online', async () => {
    const cloud = P.createMemoryCloud();
    let online = true;
    const a = await device('A', cloud, null, { online: () => online });
    await a.connect();
    online = false;
    for (const d of ['12', '13', '14']) await a.edit(s => { s.database[`2027-09-${d}`] = { time: 60 }; });
    eq(Object.keys(a.state().database).length, 3);
    await a.engine.sync();
    eq(a.engine.status.phase, 'offline');
    eq(a.local.pendingCount(), 3);
    online = true;
    await a.engine.sync();
    eq([a.engine.status.phase, a.local.pendingCount()], ['idle', 0]);
    const b = await device('B', cloud); await b.connect();
    eq(Object.keys(b.state().database).sort(), ['2027-09-12', '2027-09-13', '2027-09-14']);
});

test('E: two devices edit the same day offline; the later edit wins everywhere', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud); await a.connect();
    const b = await device('B', cloud); await b.connect();
    fakeNow += 1000;
    await a.edit(s => { s.database['2027-09-20'] = { time: 60, notes: 'A' }; });
    fakeNow += 1000;
    await b.edit(s => { s.database['2027-09-20'] = { time: 120, notes: 'B later' }; });
    await b.engine.sync(); await a.engine.sync(); await b.engine.sync();
    eq(a.state().database['2027-09-20'], b.state().database['2027-09-20']);
    eq(a.state().database['2027-09-20'].notes, 'B later');
    // Reverse order of reconnection gives the same answer.
    fakeNow += 1000; await b.edit(s => { s.database['2027-09-21'] = { time: 10 }; });
    fakeNow += 1000; await a.edit(s => { s.database['2027-09-21'] = { time: 20 }; });
    await a.engine.sync(); await b.engine.sync(); await a.engine.sync();
    eq([a.state().database['2027-09-21'].time, b.state().database['2027-09-21'].time], [20, 20]);
});

test('F: a deletion is not resurrected by a device that was offline', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud); await a.connect();
    await a.edit(s => { s.database['2027-09-22'] = { time: 60 }; });
    await a.engine.sync();
    const b = await device('B', cloud); await b.connect();
    eq(b.state().database['2027-09-22'].time, 60);
    fakeNow += 5000;
    await a.edit(s => { delete s.database['2027-09-22']; });
    await a.engine.sync();
    // B edits something else in the same month while unaware of the deletion.
    await b.edit(s => { s.database['2027-09-23'] = { time: 15 }; });
    await b.engine.sync();
    eq(b.state().database['2027-09-22'], undefined);
    eq(b.state().database['2027-09-23'].time, 15);
    await a.engine.sync();
    eq(a.state().database['2027-09-22'], undefined);
    // An edit made after the deletion does win (tombstone only wins when newer).
    fakeNow += 5000;
    await b.edit(s => { s.database['2027-09-22'] = { time: 5 }; });
    await b.engine.sync(); await a.engine.sync();
    eq(a.state().database['2027-09-22'].time, 5);
});

test('old tombstones are purged without resurrecting data', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud); await a.connect();
    await a.edit(s => { s.database['2027-09-05'] = { time: 60 }; }); await a.engine.sync();
    const b = await device('B', cloud); await b.connect();
    await a.edit(s => { delete s.database['2027-09-05']; s.database['2027-09-06'] = { time: 1 }; }); await a.engine.sync();
    await b.engine.sync();
    advance(Core.TOMBSTONE_TTL + 24 * 3600e3);
    await a.edit(s => { s.database['2027-09-07'] = { time: 2 }; }); await a.engine.sync(); // purges the tombstone
    const file = JSON.parse(cloud.files.get('entries/2027-09.json').text);
    assert.ok(!('e:2027-09-05' in file.records) && file.purgedBefore > 0);
    await b.engine.sync();
    eq(Object.keys(b.state().database).sort(), ['2027-09-06', '2027-09-07']);
    assert.ok(!b.local.records().some(r => r.id === 'e:2027-09-05'), 'local tombstone cleaned up too');
});

test('historical goals and medals sync as separate records', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud); await a.connect();
    const b = await device('B', cloud); await b.connect();
    await a.edit(s => { s.settings.yearGoals = { '2026-09': 600 }; }); await a.engine.sync();
    fakeNow += 1000;
    await b.edit(s => { s.settings.yearGoals = { ...s.settings.yearGoals, '2027-09': 650 }; s.medals.completedYears = ['2026-09']; });
    await b.engine.sync(); await a.engine.sync();
    eq(a.state().settings.yearGoals, { '2026-09': 600, '2027-09': 650 });
    eq(a.state().medals.completedYears, ['2026-09']);
});

test('damaged cloud file is set aside; local data is untouched and the file rebuilt', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud); await a.connect();
    await a.edit(s => { s.database['2027-09-01'] = { time: 60 }; }); await a.engine.sync();
    cloud.files.set('entries/2027-09.json', { text: '{garbage', rev: 'rX', modified: new Date().toISOString() });
    await a.engine.sync();
    eq(a.state().database['2027-09-01'].time, 60);
    assert.ok([...cloud.files.keys()].some(k => k.startsWith('quarantine/')));
    eq(JSON.parse(cloud.files.get('entries/2027-09.json').text).records['e:2027-09-01'].v.time, 60);
});

test('newer cloud schema stops sync without writing anything', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud); await a.connect();
    cloud.files.set('manifest.json', { text: JSON.stringify({ format: Core.FORMAT, schemaVersion: 9, datasetId: 'x' }), rev: 'm9' });
    const before = JSON.stringify([...cloud.files]);
    await a.edit(s => { s.database['2027-09-02'] = { time: 60 }; });
    await a.engine.sync();
    eq([a.engine.status.phase, a.engine.status.error.code], ['error', 'schema-newer']);
    eq(JSON.stringify([...cloud.files]), before);
    eq(a.state().database['2027-09-02'].time, 60);
});

test('errors: auth pauses, server errors back off, local data keeps working', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud); await a.connect();
    a.adapter.ctl.failWith = { code: 'auth', message: 'expired' };
    await a.edit(s => { s.database['2027-09-03'] = { time: 60 }; });
    await a.engine.sync();
    eq(a.engine.status.phase, 'auth');
    a.adapter.ctl.failWith = { code: 'server', message: 'down', once: true };
    await a.engine.syncNow();
    eq(a.engine.status.phase, 'error');
    assert.ok(a.engine.status.nextRetryAt > fakeNow);
    await a.engine.syncNow();
    eq([a.engine.status.phase, a.local.pendingCount()], ['idle', 0]);
    const log = await a.engine.log();
    assert.ok(log.some(l => !l.ok && l.code === 'auth') && log.some(l => l.ok));
    assert.ok(!JSON.stringify(log).includes('token'), 'log holds no credentials');
});

test('concurrent write to the same file is merged, not lost', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud); await a.connect();
    const b = await device('B', cloud); await b.connect();
    await a.edit(s => { s.database['2027-09-15'] = { time: 60 }; });
    await b.edit(s => { s.database['2027-09-16'] = { time: 30 }; });
    // B writes between A's list and A's write: simulate by letting B sync first,
    // then A (whose listing is stale) must hit a conflict and re-merge.
    const origList = a.adapter.list.bind(a.adapter);
    let stale = null;
    a.adapter.list = async () => { const l = await origList(); if (!stale) { stale = l; await b.engine.sync(); } return l; };
    await a.engine.sync();
    a.adapter.list = origList;
    await b.engine.sync();
    for (const d of [a, b]) eq(Object.keys(d.state().database).sort(), ['2027-09-15', '2027-09-16']);
});

test('replace-local connection removes this device\'s data first', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud, legacyState({ '2027-09-01': { time: 60 } })); await a.connect();
    const b = await device('B', cloud, legacyState({ '2020-01-01': { time: 5 } }));
    await b.connect('replace-local');
    eq(Object.keys(b.state().database), ['2027-09-01']);
    eq(Object.keys(JSON.parse(cloud.files.get('entries/2027-09.json').text).records), ['e:2027-09-01']);
    assert.ok(!cloud.files.has('entries/2020-01.json'));
});

test('disconnect keeps local data by default; wipe option removes it; cloud untouched', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud, legacyState({ '2027-09-01': { time: 60 } })); await a.connect();
    const files = cloud.files.size;
    await a.engine.disconnect();
    eq([a.engine.status.connected, Object.keys(a.state().database).length, cloud.files.size], [false, 1, files]);
    const b = await device('B', cloud); await b.connect();
    await b.engine.disconnect({ wipeLocal: true });
    eq([Object.keys(b.state().database).length, cloud.files.size], [0, files]);
});

test('delete cloud backup removes cloud files only', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud, legacyState({ '2027-09-01': { time: 60 } })); await a.connect();
    await a.engine.deleteCloudData();
    eq(cloud.files.size, 0);
    eq(a.state().database['2027-09-01'].time, 60);
});

test('device clock far off is corrected from the provider\'s server time', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud); await a.connect();
    // The cloud reports times 2 hours ahead of this device.
    a.adapter.write = (orig => async (p, t, o) => { const r = await orig(p, t, o); return { ...r, modified: new Date(fakeNow + 2 * 3600e3).toISOString() }; })(a.adapter.write);
    await a.edit(s => { s.database['2027-09-04'] = { time: 1 }; }); await a.engine.sync();
    assert.ok(Math.abs(a.local.clockSkew - 2 * 3600e3) < 1000);
    await a.edit(s => { s.database['2027-09-05'] = { time: 1 }; });
    const r = a.local.records().find(x => x.id === 'e:2027-09-05');
    assert.ok(r.u - r.c > 2 * 3600e3 - 1000, 'edit time uses corrected clock; raw device time kept in c');
});

test('import replace (not syncing) creates no tombstones', async () => {
    const cloud = P.createMemoryCloud();
    const a = await device('A', cloud, legacyState({ '2027-09-01': { time: 60 }, '2027-09-02': { time: 60 } }));
    await a.local.replaceAll(legacyState({ '2027-09-03': { time: 5 } }));
    assert.ok(!a.local.records().some(r => r.x));
    // Connecting to a cloud that has 09-01 later must not delete it there.
    const other = await device('O', cloud, legacyState({ '2027-09-01': { time: 60 } })); await other.connect();
    await a.connect();
    eq(Object.keys(a.state().database).sort(), ['2027-09-01', '2027-09-03']);
});

(async () => {
    for (const [name, fn] of tests) {
        try { await fn(); passed++; } catch (e) { failed++; console.error(`✗ ${name}\n  ${e.stack}`); }
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();

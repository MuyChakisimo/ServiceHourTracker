/* Unit tests for the pure modules (dates, stats, storage/migration, achievements).
 * Run:  node tests/run-tests.js
 * Also run under other timezones, e.g.  TZ=Asia/Tokyo node tests/run-tests.js
 */
'use strict';
const path = require('path');
const assert = require('assert');

// Minimal localStorage for storage.load().
const mem = new Map();
globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
    clear: () => mem.clear()
};
for (const f of ['theme', 'dates', 'stats', 'storage', 'achievements']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { dates: D, stats: S, storage: Store, achievements: A } = globalThis.STT;

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; } catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); }
}
const eq = assert.deepStrictEqual;

/* ---------------- dates ---------------- */
test('date keys are local and zero padded', () => {
    eq(D.toDateKey(2026, 0, 5), '2026-01-05');
    eq(D.dateToKey(new Date(2026, 8, 30)), '2026-09-30');
    eq(D.parseDateKey('2026-02-29'), null); // not a leap year
    eq(D.parseDateKey('2028-02-29'), { year: 2028, month: 1, day: 29 });
    eq(D.isValidDateKey('2026-13-01'), false);
    eq(D.isValidDateKey('abc'), false);
});

test('addDays crosses month/year/leap boundaries', () => {
    eq(D.addDays('2026-12-31', 1), '2027-01-01');
    eq(D.addDays('2028-02-28', 1), '2028-02-29');
    eq(D.addDays('2027-02-28', 1), '2027-03-01');
    eq(D.addDays('2026-03-01', -1), '2026-02-28');
});

test('addMonths never skips months (the Date.setMonth overflow bug)', () => {
    eq(D.addMonths(2026, 0, 1), { year: 2026, month: 1 });
    eq(D.addMonths(2026, 11, 1), { year: 2027, month: 0 });
    eq(D.addMonths(2026, 0, -1), { year: 2025, month: 11 });
    eq(D.addMonths(2026, 2, -14), { year: 2025, month: 0 });
});

test('service year follows the viewed month (Sep start)', () => {
    const sy = (y, m) => D.serviceYearFor(y, m, 8);
    eq(sy(2027, 7).label, 'Service Year 26/27');   // Aug 2027
    eq(sy(2027, 8).label, 'Service Year 27/28');   // Sep 2027
    eq(sy(2026, 7).label, 'Service Year 25/26');   // Aug 2026
    eq(sy(2028, 0).label, 'Service Year 27/28');   // Jan 2028
    eq([sy(2027, 7).startKey, sy(2027, 7).endKey], ['2026-09-01', '2027-08-31']);
    eq([sy(2028, 0).startKey, sy(2028, 0).endKey], ['2027-09-01', '2028-08-31']);
    eq(sy(2027, 7).id, '2026-09');
});

test('configurable service year start month', () => {
    const oct = D.serviceYearFor(2027, 8, 9); // Sep 2027, Oct start
    eq([oct.startKey, oct.endKey, oct.label], ['2026-10-01', '2027-09-30', 'Service Year 26/27']);
    const jan = D.serviceYearFor(2027, 5, 0);
    eq([jan.startKey, jan.endKey, jan.label], ['2027-01-01', '2027-12-31', 'Service Year 2027']);
    const mar = D.serviceYearFor(2028, 1, 2); // Feb 2028, Mar start: ends Feb 29 2028
    eq(mar.endKey, '2028-02-29');
});

test('month grid: adjacent days, week start and 4/5/6 rows', () => {
    // September 2026 starts on Tuesday.
    const sun = D.buildMonthGrid(2026, 8, 0);
    eq(sun.cells.slice(0, 3).map(c => [c.key, c.inMonth]), [['2026-08-30', false], ['2026-08-31', false], ['2026-09-01', true]]);
    eq(sun.rows, 5);
    eq(sun.cells[sun.cells.length - 1].key, '2026-10-03');
    const mon = D.buildMonthGrid(2026, 8, 1);
    eq(mon.cells[0].key, '2026-08-31');
    eq(mon.cells[1].key, '2026-09-01');
    eq(mon.cells[0].weekday, 1);
    // Every row starts on the configured weekday.
    for (const g of [sun, mon]) g.cells.forEach((c, i) => { if (i % 7 === 0) assert.strictEqual(c.weekday, g === sun ? 0 : 1); });
    eq(D.buildMonthGrid(2026, 1, 0).rows, 4);  // Feb 2026 starts Sunday, 28 days
    eq(D.buildMonthGrid(2026, 1, 1).rows, 5);
    eq(D.buildMonthGrid(2026, 7, 0).rows, 6);  // Aug 2026 starts Saturday, 31 days
    eq(D.buildMonthGrid(2026, 10, 1).rows, 6); // Nov 2026 starts Sunday -> 6 rows Monday-first
    eq(D.weekdayHeaders(1).map(h => h.short).join(' '), 'Mon Tue Wed Thu Fri Sat Sun');
    eq(D.weekdayHeaders(0).map(h => h.short).join(' '), 'Sun Mon Tue Wed Thu Fri Sat');
});

test('every in-month cell appears exactly once, in order', () => {
    for (let y = 2024; y <= 2028; y++) for (let m = 0; m < 12; m++) for (const ws of [0, 1]) {
        const g = D.buildMonthGrid(y, m, ws);
        const inMonth = g.cells.filter(c => c.inMonth).map(c => c.day);
        eq(inMonth, Array.from({ length: D.daysInMonth(y, m) }, (_, i) => i + 1));
        assert.ok(g.rows >= 4 && g.rows <= 6);
        assert.ok(!g.cells.slice(-7).every(c => !c.inMonth), 'no fully empty trailing week');
    }
});

/* ---------------- stats ---------------- */
test('duration formatting', () => {
    eq(S.formatDuration(120), '2h');
    eq(S.formatDuration(90), '1h 30m');
    eq(S.formatDuration(90, true), '1h30m');
    eq(S.formatDuration(45), '45m');
    eq(S.formatDuration(0), '0h');
    eq(S.formatDuration(-5), '0h');
});

function historyFixture() {
    // Sep 2025 .. Oct 2027, 10h each month on the 5th, 1 study each.
    const db = {};
    for (let i = 0; i < 26; i++) {
        const { year, month } = D.addMonths(2025, 8, i);
        db[D.toDateKey(year, month, 5)] = { time: 600, studies: 1 };
    }
    return db;
}

test('service-year totals have a start AND an end', () => {
    const db = historyFixture();
    const idx = S.buildMonthIndex(db);
    const y2526 = S.serviceYearTotals(idx, D.serviceYearFromId('2025-09'));
    const y2627 = S.serviceYearTotals(idx, D.serviceYearFromId('2026-09'));
    const y2728 = S.serviceYearTotals(idx, D.serviceYearFromId('2027-09'));
    eq([y2526.minutes, y2627.minutes, y2728.minutes], [7200, 7200, 1200]);
    eq([y2526.studies, y2627.studies, y2728.studies], [12, 12, 2]);
});

test('Service History discovers years, newest first, current flagged', () => {
    const db = historyFixture();
    const settings = Store.defaultSettings();
    const h = S.serviceHistory(db, settings, '2027-10-20');
    eq(h.years.map(y => y.sy.label), ['Service Year 27/28', 'Service Year 26/27', 'Service Year 25/26']);
    eq(h.years.map(y => y.phase), ['current', 'past', 'past']);
    eq(h.years[1].minutes, 7200);
    eq(h.years[1].remaining, 36000 - 7200);
    assert.ok(Math.abs(h.years[1].percent - 20) < 1e-9);
    // Gap years still appear.
    const gap = { '2022-10-01': { time: 60 } };
    eq(S.serviceHistory(gap, settings, '2026-09-27').years.map(y => y.sy.id), ['2026-09', '2025-09', '2024-09', '2023-09', '2022-09']);
    // Empty install
    const empty = S.serviceHistory({}, settings, '2026-09-27');
    eq([empty.hasData, empty.years.length, empty.years[0].phase], [false, 1, 'current']);
    // Plans alone are not "history".
    eq(S.serviceHistory({ '2020-01-01': { plannedTime: 60 } }, settings, '2026-09-27').hasData, false);
});

test('year detail: 12 months with correct totals', () => {
    const d = S.serviceYearDetail(historyFixture(), Store.defaultSettings(), D.serviceYearFromId('2026-09'), '2027-10-20');
    eq(d.months.length, 12);
    eq(d.months[0].key, '2026-09');
    eq(d.months[11].key, '2027-08');
    assert.ok(d.months.every(m => m.minutes === 600 && m.studies === 1 && m.phase === 'past'));
});

test('effective-dated goals: later goals do not rewrite earlier years', () => {
    let s = Store.defaultSettings(); // base 600 / 50
    s.yearGoals = S.setEffectiveGoal(s.yearGoals, '2027-09', '2028-09', 650, s.yearGoal, 'forward');
    eq(S.yearGoalHours(s, '2026-09'), 600);
    eq(S.yearGoalHours(s, '2027-09'), 650);
    eq(S.yearGoalHours(s, '2029-09'), 650);
    // "only" keeps the following year at its previous value
    s.yearGoals = S.setEffectiveGoal(s.yearGoals, '2025-09', '2026-09', 500, s.yearGoal, 'only');
    eq([S.yearGoalHours(s, '2024-09'), S.yearGoalHours(s, '2025-09'), S.yearGoalHours(s, '2026-09'), S.yearGoalHours(s, '2027-09')], [600, 500, 600, 650]);
    // Monthly goals
    s.monthGoals = S.setEffectiveGoal(s.monthGoals, '2027-10', '2027-11', 30, s.monthGoal, 'only');
    eq([S.monthGoalHours(s, 2026, 9), S.monthGoalHours(s, 2027, 9), S.monthGoalHours(s, 2027, 10)], [50, 30, 50]);
});

test('progress never goes negative or over 100% on the bar', () => {
    const p = S.progress(617 * 60, 600);
    eq([p.remaining, p.exceededBy, p.barPercent, p.reached], [0, 17 * 60, 100, true]);
    assert.ok(Math.abs(p.percent - 102.8333) < 0.001);
    const q = S.progress(583 * 60, 600);
    eq([q.remaining, q.exceededBy, q.reached], [17 * 60, 0, false]);
    eq(S.progress(100, 0).percent, 0);
});

test('day status: plan vs actual, future never red', () => {
    const t = '2026-09-27';
    eq(S.dayStatus({ plannedTime: 120, time: 120 }, '2026-09-20', t), 'complete');
    eq(S.dayStatus({ plannedTime: 120, time: 90 }, '2026-09-20', t), 'under');
    eq(S.dayStatus({ plannedTime: 120 }, '2026-09-20', t), 'missed');
    eq(S.dayStatus({ plannedTime: 120 }, t, t), 'planned');
    eq(S.dayStatus({ plannedTime: 120, time: 30 }, t, t), 'under');
    eq(S.dayStatus({ plannedTime: 120 }, '2026-10-01', t), 'planned');
    eq(S.dayStatus({ time: 60 }, '2026-09-20', t), null);
});

/* ---------------- storage / migration ---------------- */
test('v1 migration keeps goals, drops notifications, keeps schedule inert, converts medals', () => {
    const v1 = {
        database: {},
        settings: { monthGoal: 30, yearGoal: 360, schedule: { monday: { active: true, hours: 2, minutes: 0 } }, notifications: { enabled: true, time: '12:00' },
            customTheme: { '--text-color': '#e0aaff', '--card-bg-color': '#240046', '--border-color': '#5a189a', '--background-color': '#000000' } },
        medals: { completedMonths: ['2025-10'], completedYears: [2024] }
    };
    const m = Store.migrateBundle(v1);
    eq([m.settings.monthGoal, m.settings.yearGoal, m.settings.serviceYearStartMonth, m.settings.weekStartsOn], [30, 360, 8, 0]);
    eq(m.settings.notifications, undefined);
    eq(m.settings.customTheme, undefined);
    eq(m.settings.theme, { preset: 'purple' });
    eq(m.settings.legacy.schedule.monday.hours, 2);
    eq(m.medals, { completedMonths: ['2025-10'], completedYears: ['2024-09'] });
    eq(m.settings.schemaVersion, 2);
});

test('v1 migration keeps a custom theme', () => {
    const m = Store.migrateBundle({ database: {}, settings: { customTheme: { '--text-color': '#ffffff', '--card-bg-color': '#112233', '--border-color': '#445566', '--background-color': '#000000' } } });
    eq(m.settings.theme, { preset: 'custom', colors: { background: '#000000', card: '#112233', accent: '#445566', border: '#445566', text: '#ffffff' } });
});

test('legacy UTC keys are shifted to the local day only where they were wrong', () => {
    // Recreate exactly what v1 wrote for local Oct 5 2026 in this process's timezone.
    const v1Key = new Date(2026, 9, 5).toISOString().split('T')[0];
    eq(Store.legacyKeyToLocal(v1Key), '2026-10-05');
    const v1Month = new Date(2026, 9, 1).toISOString().split('T')[0];
    eq(Store.legacyKeyToLocal(v1Month), '2026-10-01');
    // Every day of a year round-trips (covers DST switches).
    for (let i = 0; i < 366; i++) {
        const d = new Date(2026, 0, 1 + i);
        eq(Store.legacyKeyToLocal(d.toISOString().split('T')[0]), D.dateToKey(d));
    }
});

test('theme: outline override, status colours, presets keep status', () => {
    const T = globalThis.STT.theme;
    const auto = T.cssVars({ preset: 'custom', colors: { background: '#000000', card: '#222222', accent: '#ff0000', text: '#ffffff' } });
    const set = T.cssVars({ preset: 'custom', colors: { background: '#000000', card: '#222222', accent: '#ff0000', text: '#ffffff', border: '#00ff00' } });
    assert.notStrictEqual(auto['--border'], '#00ff00');
    eq(set['--border'], '#00ff00');
    eq(T.cssVars({ preset: 'dark' })['--plan'], '#3b8cf6');
    const st = T.cssVars({ preset: 'dark', status: { planned: '#123456', missed: 'bad' } });
    eq([st['--plan'], st['--bad'], st['--ok']], ['#123456', '#ef4444', '#22c55e']);
    // Storage keeps only non-default status colours and never keeps an outline on a preset.
    eq(Store.sanitizeSettings({ schemaVersion: 2, theme: { preset: 'blue', status: { planned: '#3B8CF6', missed: '#AA0000' } } }).theme, { preset: 'blue', status: { missed: '#aa0000' } });
    eq(Store.sanitizeSettings({ schemaVersion: 2, theme: { preset: 'custom', colors: { background: '#000000', card: '#111111', accent: '#222222', text: '#ffffff', border: '#333333' } } }).theme.colors.border, '#333333');
});

test('entries keep plannedTime alongside actual values through sanitising', () => {
    eq(Store.sanitizeEntry({ time: 90, studies: 1, notes: 'x', plannedTime: 120 }), { time: 90, studies: 1, notes: 'x', plannedTime: 120 });
    eq(Store.sanitizeEntry({ time: -5, studies: 'abc', plannedTime: 99999 }), { plannedTime: 1440 });
    eq(Store.sanitizeEntry({}), null);
    eq(Store.sanitizeEntry('nope'), null);
});

test('backup round trip regenerates identical Service History', () => {
    const db = historyFixture();
    db['2026-01-10'] = { time: 30, plannedTime: 60, notes: 'Cart witnessing' };
    const settings = Store.defaultSettings();
    settings.yearGoals = { '2027-09': 650 };
    settings.weekStartsOn = 1;
    const medals = { completedMonths: ['2026-01'], completedYears: [] };
    const text = JSON.stringify(Store.buildBackup(db, settings, medals));
    const back = Store.parseBackup(text);
    eq(back.database, db);
    eq(back.settings, Store.sanitizeSettings(settings));
    eq(back.medals, medals);
    eq(S.serviceHistory(back.database, back.settings, '2027-10-20'), S.serviceHistory(db, settings, '2027-10-20'));
});

test('import rejects junk and skips invalid keys', () => {
    assert.throws(() => Store.parseBackup('not json'), /not valid JSON/);
    assert.throws(() => Store.parseBackup('{"foo":1}'), /does not look like/);
    const r = Store.parseBackup(JSON.stringify({ app: 'ServiceTimeTracker', backupVersion: 2, database: { '2026-02-30': { time: 5 }, 'x': {}, '2026-02-01': { time: 60 } }, settings: { schemaVersion: 2, weekStartsOn: 'banana', monthGoal: -1 } }));
    eq(Object.keys(r.database), ['2026-02-01']);
    eq(r.skipped, 2);
    eq([r.settings.weekStartsOn, r.settings.monthGoal], [0, 50]);
});

test('old 4.x backup (no version) imports and migrates', () => {
    const v1Key = new Date(2026, 9, 5).toISOString().split('T')[0];
    const r = Store.parseBackup(JSON.stringify({ database: { [v1Key]: { time: 60, studies: 0, notes: '' } }, settings: { monthGoal: 40, yearGoal: 480, schedule: {}, notifications: {} }, medals: { completedMonths: [], completedYears: [2025] } }));
    eq(r.database, { '2026-10-05': { time: 60 } });
    eq([r.settings.monthGoal, r.settings.yearGoal], [40, 480]);
    eq(r.medals.completedYears, ['2025-09']);
});

test('load(): fresh install, v1 upgrade with pre-migration copy, idempotent reload', () => {
    mem.clear();
    const fresh = Store.load();
    eq([fresh.migrated, Object.keys(fresh.database).length], [false, 0]);
    eq(mem.size, 0); // nothing written until the user saves

    mem.clear();
    const v1Key = new Date(2026, 9, 5).toISOString().split('T')[0];
    mem.set(Store.KEYS.db, JSON.stringify({ [v1Key]: { time: 60, studies: 1, notes: 'hi', plannedTime: 90 } }));
    mem.set(Store.KEYS.settings, JSON.stringify({ monthGoal: 50, yearGoal: 600, notifications: { enabled: true } }));
    const up = Store.load();
    eq(up.migrated, true);
    eq(up.database, { '2026-10-05': { time: 60, studies: 1, notes: 'hi', plannedTime: 90 } });
    assert.ok(mem.has(Store.KEYS.preMigration));
    eq(JSON.parse(mem.get(Store.KEYS.preMigration)).db, JSON.stringify({ [v1Key]: { time: 60, studies: 1, notes: 'hi', plannedTime: 90 } }));
    const again = Store.load();
    eq([again.migrated, again.database], [false, up.database]); // second load must not shift again

    mem.clear();
    mem.set(Store.KEYS.db, '{broken');
    const bad = Store.load();
    eq(bad.corrupt, true);
    eq(mem.get(Store.KEYS.db), '{broken'); // never overwritten
});

test('changing the start month remaps year goals and trophies', () => {
    eq(Store.remapYearId('2026-09', 9), '2026-10');
    eq(Store.remapYearId('2026-09', 0), '2027-01');
    eq(Store.remapYearGoals({ '2025-09': 600, '2026-09': 650 }, 9), { '2025-10': 600, '2026-10': 650 });
    eq(Store.remapYearIds(['2026-09'], 8, 0), ['2027-01']);
});

/* ---------------- achievements ---------------- */
test('medals: awarded only for the edited period, removed only by that edit', () => {
    const settings = Store.defaultSettings(); // month goal 50h
    const medals = Store.defaultMedals();
    const before = { '2026-09-01': { time: 49 * 60 } };
    const after = { '2026-09-01': { time: 49 * 60 }, '2026-09-02': { time: 60, plannedTime: 60 } };
    const r = A.afterEntryChange(medals, before, after, settings, '2026-09-02');
    eq(r.medals.completedMonths, ['2026-09']);
    eq(r.awarded.map(a => a.type), ['month']);
    // Typo correction removes it.
    const r2 = A.afterEntryChange(r.medals, after, before, settings, '2026-09-02');
    eq(r2.medals.completedMonths, []);
    // Editing a day in another month does not touch an existing medal.
    const r3 = A.afterEntryChange({ completedMonths: ['2020-01'], completedYears: [] }, {}, { '2026-09-03': { notes: 'x' } }, settings, '2026-09-03');
    eq(r3.medals.completedMonths, ['2020-01']);
    // Inputs are not mutated.
    eq(medals, Store.defaultMedals());
});

test('month summary totals planned time for the month only', () => {
    const db = { '2026-09-01': { plannedTime: 120, time: 60 }, '2026-09-15': { plannedTime: 90 }, '2026-10-01': { plannedTime: 300 }, '2026-08-31': { plannedTime: 45 } };
    const ms = S.monthSummary(db, Store.defaultSettings(), 2026, 8);
    eq([ms.planned, ms.minutes], [210, 60]);
    eq(S.monthSummary({}, Store.defaultSettings(), 2026, 8).planned, 0);
});

test('rendering calculations do not mutate inputs', () => {
    const db = historyFixture();
    const settings = Store.defaultSettings();
    const snapshot = JSON.stringify({ db, settings });
    S.serviceHistory(db, settings, '2027-10-20');
    S.serviceYearDetail(db, settings, D.serviceYearFromId('2026-09'), '2027-10-20');
    S.monthSummary(db, settings, 2026, 9);
    eq(JSON.stringify({ db, settings }), snapshot);
});

console.log(`${passed} passed, ${failed} failed (TZ=${process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone})`);
process.exit(failed ? 1 : 0);

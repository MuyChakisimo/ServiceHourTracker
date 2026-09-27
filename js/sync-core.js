/* Sync model: records, cloud file format and last-write-wins merge.
 *
 * Pure functions only (no storage, no network) so they can be unit tested.
 *
 * The app's state ({database, settings, medals}) is split into small,
 * independently editable RECORDS, each identified by an id:
 *   e:YYYY-MM-DD   one calendar day (time, studies, notes, plannedTime)
 *   mg:YYYY-MM     monthly goal effective from that month
 *   yg:YYYY-MM     service-year goal (id = first month of the service year)
 *   mm:YYYY-MM     monthly medal         my:YYYY-MM  service-year trophy
 *   p:<name>       preference (monthGoal, yearGoal, serviceYearStartMonth,
 *                  weekStartsOn, theme, legacy)
 * A record is { id, v, u, c, d } or a tombstone { id, x: 1, u, c, d }:
 *   v  value            x  deleted marker (tombstone)
 *   u  edit time (ms, device clock corrected by the provider's server time)
 *   c  raw device clock at edit time (diagnostics only)
 *   d  device id of the editor
 *
 * Cloud layout (identical for every provider and platform):
 *   manifest.json            { format, schemaVersion, datasetId, createdAt }
 *   prefs.json               all p:, mg:, yg:, mm:, my: records
 *   entries/YYYY-MM.json     the e: records of one month
 * so editing one day re-uploads only that month's file.
 */
(function (root) {
    const STT = root.STT = root.STT || {};
    const Store = STT.storage;

    const FORMAT = 'service-time-tracker-sync';
    const SCHEMA_VERSION = 1;
    const TOMBSTONE_TTL = 180 * 24 * 3600 * 1000; // deleted markers are kept 180 days
    const PREF_KEYS = ['monthGoal', 'yearGoal', 'serviceYearStartMonth', 'weekStartsOn', 'theme', 'legacy'];

    /* ---------- Canonical JSON (stable key order) ---------- */
    function canon(v) {
        if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
        if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
        return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
            .map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    }
    const sameValue = (a, b) => canon(a) === canon(b);

    /* ---------- State <-> record values ---------- */
    function stateToValues({ database, settings, medals }) {
        const out = new Map();
        for (const k of Object.keys(database)) {
            const e = Store.sanitizeEntry(database[k]);
            if (e) out.set('e:' + k, e);
        }
        for (const k of PREF_KEYS) if (settings[k] !== undefined) out.set('p:' + k, settings[k]);
        for (const k of Object.keys(settings.monthGoals || {})) out.set('mg:' + k, settings.monthGoals[k]);
        for (const k of Object.keys(settings.yearGoals || {})) out.set('yg:' + k, settings.yearGoals[k]);
        for (const k of medals.completedMonths || []) out.set('mm:' + k, 1);
        for (const k of medals.completedYears || []) out.set('my:' + k, 1);
        return out;
    }

    /** Rebuilds app state from live record values; missing preferences use defaults. */
    function valuesToState(values) {
        const database = {};
        const settings = { schemaVersion: Store.SCHEMA_VERSION, monthGoals: {}, yearGoals: {} };
        const medals = { completedMonths: [], completedYears: [] };
        for (const [id, v] of values) {
            const i = id.indexOf(':');
            const kind = id.slice(0, i), key = id.slice(i + 1);
            if (kind === 'e') database[key] = v;
            else if (kind === 'p') settings[key] = v;
            else if (kind === 'mg') settings.monthGoals[key] = v;
            else if (kind === 'yg') settings.yearGoals[key] = v;
            else if (kind === 'mm') medals.completedMonths.push(key);
            else if (kind === 'my') medals.completedYears.push(key);
        }
        return {
            database: Store.sanitizeDatabase(database).db,
            settings: Store.sanitizeSettings(settings),
            medals: Store.sanitizeMedals(medals)
        };
    }

    /* ---------- Record ids and files ---------- */
    const ID_RE = /^(e:\d{4}-\d{2}-\d{2}|(mg|yg|mm|my):\d{4}-\d{2}|p:[A-Za-z]{1,40})$/;
    const isValidId = id => typeof id === 'string' && ID_RE.test(id);

    function fileForId(id) {
        return id.startsWith('e:') ? `entries/${id.slice(2, 9)}.json` : 'prefs.json';
    }
    const isDataFile = p => p === 'prefs.json' || /^entries\/\d{4}-\d{2}\.json$/.test(p);

    function groupByFile(records) {
        const out = new Map();
        for (const r of records) {
            const f = fileForId(r.id);
            if (!out.has(f)) out.set(f, new Map());
            out.get(f).set(r.id, r);
        }
        return out;
    }

    /* ---------- Last write wins ----------
     * Newer edit time wins. Exact ties are broken deterministically so every
     * device picks the same winner: a deletion beats an edit, then the higher
     * device id wins.
     */
    function wins(a, b) {
        if (a.u !== b.u) return a.u > b.u;
        const ax = a.x ? 1 : 0, bx = b.x ? 1 : 0;
        if (ax !== bx) return ax > bx;
        return String(a.d) > String(b.d);
    }

    const cloudForm = r => (r.x ? { x: 1, u: r.u, c: r.c, d: r.d } : { v: r.v, u: r.u, c: r.c, d: r.d });
    const sameRecord = (a, b) => a.u === b.u && String(a.d) === String(b.d) && !!a.x === !!b.x && (a.x || sameValue(a.v, b.v));

    /* ---------- File format ---------- */
    function buildFile(path, records, meta) {
        const recs = {};
        [...records.keys()].sort().forEach(id => { recs[id] = cloudForm(records.get(id)); });
        return JSON.stringify({
            format: FORMAT,
            schemaVersion: SCHEMA_VERSION,
            file: path,
            gen: meta.gen,
            purgedBefore: meta.purgedBefore || 0,
            records: recs
        });
    }

    class SyncError extends Error {
        constructor(code, message, extra) { super(message || code); this.code = code; Object.assign(this, extra || {}); }
    }

    /** Parses and validates a cloud data file. Throws SyncError('corrupt'|'schema-newer'). */
    function parseFile(text, path) {
        let data;
        try { data = JSON.parse(text); } catch (e) { throw new SyncError('corrupt', `${path} is not valid JSON`); }
        if (!data || data.format !== FORMAT || typeof data.records !== 'object' || data.records === null) {
            throw new SyncError('corrupt', `${path} is not a tracker sync file`);
        }
        if (!(Number(data.schemaVersion) >= 1)) throw new SyncError('corrupt', `${path} has no schema version`);
        if (data.schemaVersion > SCHEMA_VERSION) throw new SyncError('schema-newer', 'The cloud data was written by a newer version of the app. Update this app to keep syncing.');
        const records = new Map();
        let skipped = 0;
        for (const id of Object.keys(data.records)) {
            const r = data.records[id];
            const valid = isValidId(id) && fileForId(id) === path && r && typeof r === 'object' &&
                Number.isFinite(r.u) && typeof r.d === 'string' && (r.x === 1 || 'v' in r);
            if (!valid) { skipped++; continue; }
            records.set(id, r.x ? { id, x: 1, u: r.u, c: r.c, d: r.d } : { id, v: r.v, u: r.u, c: r.c, d: r.d });
        }
        return { records, gen: typeof data.gen === 'string' ? data.gen : null, purgedBefore: Number(data.purgedBefore) || 0, skipped };
    }

    function buildManifest(datasetId, now) {
        return JSON.stringify({ format: FORMAT, schemaVersion: SCHEMA_VERSION, datasetId, createdAt: new Date(now).toISOString(), app: 'Service Time Tracker' });
    }

    function parseManifest(text) {
        let m;
        try { m = JSON.parse(text); } catch (e) { throw new SyncError('corrupt', 'manifest.json is not valid JSON'); }
        if (!m || m.format !== FORMAT || typeof m.datasetId !== 'string') throw new SyncError('corrupt', 'manifest.json is not a tracker manifest');
        if (m.schemaVersion > SCHEMA_VERSION) throw new SyncError('schema-newer', 'The cloud data was written by a newer version of the app. Update this app to keep syncing.');
        return m;
    }

    /* ---------- Merge one file ----------
     * local:  Map id -> local record (with optional dirty flag) for this file
     * cloud:  parsed cloud file or null when it does not exist / is unreadable
     * sameGen: true when this is the same cloud file this device synced before
     * Returns what to change locally and the merged file contents.
     * Nothing is ever removed locally unless the cloud file explicitly says a
     * tombstone for it was purged (purgedBefore) from the same file generation.
     */
    function mergeFile({ local, cloud, sameGen, now }) {
        const cloudRecs = cloud ? cloud.records : new Map();
        const purged = cloud ? cloud.purgedBefore : 0;
        const out = new Map();
        const localUpdates = [], localDeletes = [], conflicts = [];
        let uploadNeeded = !cloud;

        const ids = new Set([...local.keys(), ...cloudRecs.keys()]);
        for (const id of ids) {
            const L = local.get(id), C = cloudRecs.get(id);
            if (L && C) {
                if (sameRecord(L, C)) out.set(id, C);
                else if (wins(L, C)) { out.set(id, L); uploadNeeded = true; }
                else {
                    out.set(id, C);
                    localUpdates.push(C);
                    // An unsynced local edit lost to a newer one: keep a copy of it.
                    if (L.dirty && !L.x && !(C.v !== undefined && sameValue(L.v, C.v))) conflicts.push({ id, lost: cloudForm(L), keptAt: now });
                }
            } else if (L) {
                if (sameGen && !L.dirty && L.u < purged) localDeletes.push(id); // deletion elsewhere, tombstone since purged
                else { out.set(id, L); uploadNeeded = true; }
            } else {
                out.set(id, C);
                localUpdates.push(C);
            }
        }

        // Purge tombstones older than the retention period.
        let purgedBefore = purged;
        const cutoff = now - TOMBSTONE_TTL;
        for (const [id, r] of out) {
            if (r.x && r.u < cutoff) {
                out.delete(id);
                purgedBefore = Math.max(purgedBefore, r.u + 1);
                uploadNeeded = true;
                if (local.has(id)) localDeletes.push(id);
            }
        }
        return { fileRecords: out, purgedBefore, uploadNeeded, localUpdates, localDeletes, conflicts };
    }

    /** Merges duplicate copies of one cloud file (possible on Google Drive) into one. */
    function combineParsed(list) {
        const records = new Map();
        let purgedBefore = 0;
        for (const p of list) {
            purgedBefore = Math.max(purgedBefore, p.purgedBefore);
            for (const [id, r] of p.records) if (!records.has(id) || wins(r, records.get(id))) records.set(id, r);
        }
        return { records, gen: list[0].gen, purgedBefore, skipped: list.reduce((s, p) => s + p.skipped, 0) };
    }

    /** Human summary of a set of live values, for the connect dialog. */
    function summarize(values) {
        const state = valuesToState(values);
        const keys = Object.keys(state.database);
        const S = STT.stats;
        return {
            entries: keys.filter(k => S.hasActual(state.database[k])).length,
            notes: keys.filter(k => state.database[k].notes).length,
            planned: keys.filter(k => state.database[k].plannedTime).length,
            years: S.discoverServiceYears(state.database, state.settings.serviceYearStartMonth, STT.dates.todayKey()).hasData
                ? S.serviceHistory(state.database, state.settings, STT.dates.todayKey()).years.filter(y => y.minutes > 0 || y.studies > 0).length
                : 0
        };
    }

    function uuid() {
        if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
        const b = new Uint8Array(16);
        root.crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }

    STT.syncCore = {
        FORMAT, SCHEMA_VERSION, TOMBSTONE_TTL, SyncError,
        canon, sameValue, stateToValues, valuesToState, isValidId, fileForId, isDataFile, groupByFile,
        wins, sameRecord, cloudForm, buildFile, parseFile, buildManifest, parseManifest, mergeFile, combineParsed,
        summarize, uuid
    };
})(typeof self !== 'undefined' ? self : globalThis);

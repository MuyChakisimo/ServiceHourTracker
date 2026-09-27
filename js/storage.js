/* Persistence, validation, schema migration and backups.
 *
 * localStorage keys are unchanged from earlier versions:
 *   serviceTimeTrackerDB        { "YYYY-MM-DD": { time, studies, notes, plannedTime } }  (minutes)
 *   serviceTimeTrackerSettings  goals, preferences, theme (schemaVersion 2+)
 *   serviceTimeTrackerMedals    { completedMonths: ["YYYY-MM"], completedYears: ["YYYY-MM"] }
 * Before the first migration the raw v1 values are copied to
 * serviceTimeTrackerPreMigrationBackup so nothing can be lost by the upgrade.
 */
(function (root) {
    const STT = root.STT = root.STT || {};
    const D = STT.dates;

    const KEYS = {
        db: 'serviceTimeTrackerDB',
        settings: 'serviceTimeTrackerSettings',
        medals: 'serviceTimeTrackerMedals',
        preMigration: 'serviceTimeTrackerPreMigrationBackup'
    };
    const SCHEMA_VERSION = 2;
    const MAX_DAY_MINUTES = 24 * 60;

    function defaultSettings() {
        return {
            schemaVersion: SCHEMA_VERSION,
            monthGoal: 50,          // base monthly goal (hours) for months before any explicit goal
            yearGoal: 600,          // base service-year goal (hours)
            monthGoals: {},         // "YYYY-MM" -> hours, effective from that month on
            yearGoals: {},          // service-year id -> hours, effective from that year on
            serviceYearStartMonth: 8, // 0-based; 8 = September
            weekStartsOn: 0,        // 0 = Sunday, 1 = Monday
            theme: { preset: STT.theme.DEFAULT_PRESET }
        };
    }

    function defaultMedals() {
        return { completedMonths: [], completedYears: [] };
    }

    /* ---------- Validation ---------- */
    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

    function toInt(v, min, max) {
        const n = typeof v === 'string' ? Number(v.trim()) : v;
        if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
        return Math.min(max, Math.max(min, Math.round(n)));
    }

    function toHours(v, fallback) {
        const n = typeof v === 'string' ? Number(v) : v;
        return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10000 ? Math.round(n * 100) / 100 : fallback;
    }

    /** Returns a clean entry or null when it holds nothing worth keeping. */
    function sanitizeEntry(e) {
        if (!isObj(e)) return null;
        const out = {};
        const time = toInt(e.time, 0, MAX_DAY_MINUTES);
        const studies = toInt(e.studies, 0, 999);
        const planned = toInt(e.plannedTime, 0, MAX_DAY_MINUTES);
        const notes = typeof e.notes === 'string' ? e.notes.slice(0, 5000) : '';
        if (time) out.time = time;
        if (studies) out.studies = studies;
        if (notes.trim()) out.notes = notes;
        if (planned) out.plannedTime = planned;
        return Object.keys(out).length ? out : null;
    }

    function sanitizeDatabase(db) {
        const out = {};
        let skipped = 0;
        if (!isObj(db)) return { db: out, skipped };
        for (const key of Object.keys(db)) {
            if (!D.isValidDateKey(key)) { skipped++; continue; }
            const e = sanitizeEntry(db[key]);
            if (e) out[key] = e;
        }
        return { db: out, skipped };
    }

    function sanitizeGoalMap(map, keyValid) {
        const out = {};
        if (!isObj(map)) return out;
        for (const k of Object.keys(map)) {
            const h = toHours(map[k], null);
            if (keyValid(k) && h !== null) out[k] = h;
        }
        return out;
    }

    const isMonthKey = k => D.parseMonthKey(k) !== null;

    function sanitizeTheme(theme) {
        if (!isObj(theme)) return { preset: STT.theme.DEFAULT_PRESET };
        const out = theme.preset !== 'custom' && STT.theme.PRESETS[theme.preset]
            ? { preset: theme.preset }
            : { preset: 'custom', colors: STT.theme.colorsFor({ preset: 'custom', colors: theme.colors }) };
        // Only keep status colours that differ from the defaults.
        if (isObj(theme.status)) {
            const st = {};
            for (const k of Object.keys(STT.theme.DEFAULT_STATUS)) {
                const v = theme.status[k];
                if (STT.theme.isHex(v) && v.toLowerCase() !== STT.theme.DEFAULT_STATUS[k]) st[k] = v.toLowerCase();
            }
            if (Object.keys(st).length) out.status = st;
        }
        return out;
    }

    /** Normalises a v2 settings object (fills defaults, drops invalid values). */
    function sanitizeSettings(s) {
        const d = defaultSettings();
        if (!isObj(s)) return d;
        const startMonth = toInt(s.serviceYearStartMonth ?? d.serviceYearStartMonth, 0, 11);
        const out = {
            schemaVersion: SCHEMA_VERSION,
            monthGoal: toHours(s.monthGoal, d.monthGoal),
            yearGoal: toHours(s.yearGoal, d.yearGoal),
            monthGoals: sanitizeGoalMap(s.monthGoals, isMonthKey),
            yearGoals: sanitizeGoalMap(s.yearGoals, isMonthKey),
            serviceYearStartMonth: startMonth,
            weekStartsOn: s.weekStartsOn === 1 || s.weekStartsOn === '1' ? 1 : 0,
            theme: sanitizeTheme(s.theme)
        };
        // Year-goal ids must start on the configured month; remap any that do not.
        const matching = {}, mismatched = {};
        for (const id of Object.keys(out.yearGoals)) {
            (D.parseMonthKey(id).month === startMonth ? matching : mismatched)[id] = out.yearGoals[id];
        }
        out.yearGoals = { ...remapYearGoals(mismatched, startMonth), ...matching };
        if (isObj(s.legacy)) out.legacy = s.legacy;
        return out;
    }

    function sanitizeMedals(m) {
        const out = defaultMedals();
        if (!isObj(m)) return out;
        const uniq = arr => [...new Set(arr)].sort();
        if (Array.isArray(m.completedMonths)) out.completedMonths = uniq(m.completedMonths.filter(k => typeof k === 'string' && isMonthKey(k)));
        if (Array.isArray(m.completedYears)) out.completedYears = uniq(m.completedYears.filter(k => typeof k === 'string' && isMonthKey(k)));
        return out;
    }

    /* ---------- v1 -> v2 migration ----------
     * v1 (<= 4.6.1) created day keys with Date#toISOString() on local midnight.
     * East of UTC that is the previous UTC day, so every entry was filed one day
     * early (the calendar still looked right because it used the same buggy key,
     * but month and service-year totals near boundaries were wrong). Shift those
     * keys back to the local day they were created for. West of UTC / at UTC the
     * keys were already correct and are left alone.
     */
    function legacyKeyToLocal(key) {
        const next = D.addDays(key, 1);
        const p = D.parseDateKey(next);
        const utcOfNextMidnight = new Date(p.year, p.month, p.day).toISOString().slice(0, 10);
        return utcOfNextMidnight === key ? next : key;
    }

    function migrateLegacyKeys(db) {
        const out = {};
        let shifted = 0;
        for (const key of Object.keys(db).sort()) {
            const nk = legacyKeyToLocal(key);
            if (nk !== key) shifted++;
            // Collisions cannot happen with one consistent offset; merge defensively if they do.
            out[nk] = out[nk] ? { ...db[key], ...out[nk] } : db[key];
        }
        return { db: out, shifted };
    }

    /** Converts v1 settings to v2. The old global goals become the base goals. */
    function migrateSettingsV1(s) {
        const d = defaultSettings();
        const src = isObj(s) ? s : {};
        const out = {
            ...d,
            monthGoal: toHours(src.monthGoal, d.monthGoal),
            yearGoal: toHours(src.yearGoal, d.yearGoal),
            theme: STT.theme.fromLegacy(src.customTheme)
        };
        // The weekly schedule had no UI left in 4.6.1 but is user data; keep it inert.
        if (isObj(src.schedule) && Object.keys(src.schedule).length) out.legacy = { schedule: src.schedule };
        // `notifications` and `customTheme` are intentionally dropped.
        return out;
    }

    function migrateMedalsV1(m) {
        const out = defaultMedals();
        if (!isObj(m)) return out;
        if (Array.isArray(m.completedMonths)) out.completedMonths = m.completedMonths.filter(k => typeof k === 'string');
        // v1 stored the service-year start year as a number and always started in September.
        if (Array.isArray(m.completedYears)) {
            out.completedYears = m.completedYears
                .map(y => (typeof y === 'number' || /^\d{4}$/.test(String(y)) ? `${y}-09` : String(y)));
        }
        return sanitizeMedals(out);
    }

    /** Migrates a {database, settings, medals} bundle of any known version to v2. */
    function migrateBundle(bundle) {
        const version = isObj(bundle.settings) && Number(bundle.settings.schemaVersion) || 1;
        let db = isObj(bundle.database) ? bundle.database : {};
        let settings, medals, shifted = 0;
        if (version < 2) {
            const m = migrateLegacyKeys(db);
            db = m.db;
            shifted = m.shifted;
            settings = migrateSettingsV1(bundle.settings);
            medals = migrateMedalsV1(bundle.medals);
        } else {
            settings = bundle.settings;
            medals = bundle.medals;
        }
        const clean = sanitizeDatabase(db);
        settings = sanitizeSettings(settings);
        // Year medals must use ids that match the configured start month.
        medals = sanitizeMedals(medals);
        medals.completedYears = remapYearIds(medals.completedYears, 8, settings.serviceYearStartMonth, true);
        return { database: clean.db, settings, medals, fromVersion: version, shifted, skipped: clean.skipped };
    }

    /* ---------- Service-year start month changes ----------
     * When the start month changes, each stored service-year id maps to the new
     * service year containing the old year's midpoint (the year it mostly overlaps).
     */
    function remapYearId(id, newStart) {
        const sy = D.serviceYearFromId(id);
        if (!sy) return null;
        const mid = D.addMonths(sy.startYear, sy.startMonth, 6);
        return D.serviceYearFor(mid.year, mid.month, newStart).id;
    }

    function remapYearIds(ids, _oldStart, newStart, onlyMismatched = false) {
        const out = new Set();
        for (const id of ids) {
            const sy = D.serviceYearFromId(id);
            if (!sy) continue;
            if (onlyMismatched && sy.startMonth === newStart) out.add(id);
            else out.add(remapYearId(id, newStart));
        }
        return [...out].sort();
    }

    function remapYearGoals(map, newStart) {
        const out = {};
        for (const id of Object.keys(map || {}).sort()) {
            const nid = remapYearId(id, newStart);
            if (nid && !(nid in out)) out[nid] = map[id];
        }
        return out;
    }

    /* ---------- localStorage ---------- */
    function readJson(key) {
        const raw = root.localStorage.getItem(key);
        if (raw === null) return { raw: null, value: null };
        try { return { raw, value: JSON.parse(raw) }; } catch (e) { return { raw, value: null, corrupt: true }; }
    }

    function load() {
        const db = readJson(KEYS.db), s = readJson(KEYS.settings), m = readJson(KEYS.medals);
        const corrupt = db.corrupt || s.corrupt || m.corrupt;
        const isFresh = db.raw === null && s.raw === null && m.raw === null;
        const bundle = { database: db.value, settings: s.value, medals: m.value };
        const needsMigration = !isFresh && !(isObj(s.value) && Number(s.value.schemaVersion) >= SCHEMA_VERSION);

        if ((needsMigration || corrupt) && !root.localStorage.getItem(KEYS.preMigration)) {
            // Keep the untouched originals (including unreadable ones) before rewriting anything.
            try {
                root.localStorage.setItem(KEYS.preMigration, JSON.stringify({
                    savedAt: new Date().toISOString(), db: db.raw, settings: s.raw, medals: m.raw
                }));
            } catch (e) { /* storage full: continue, migration below is still lossless for valid data */ }
        }

        const result = isFresh
            ? { database: {}, settings: defaultSettings(), medals: defaultMedals(), fromVersion: SCHEMA_VERSION, shifted: 0, skipped: 0 }
            : migrateBundle(bundle);
        // Never overwrite a value we could not parse; it stays in storage untouched.
        if (!isFresh && (needsMigration || corrupt)) {
            if (!db.corrupt) save(KEYS.db, result.database);
            if (!s.corrupt) save(KEYS.settings, result.settings);
            if (!m.corrupt) save(KEYS.medals, result.medals);
        }
        return { ...result, migrated: needsMigration, corrupt };
    }

    function save(key, value) {
        try {
            root.localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.error('Could not save', key, e);
            return false;
        }
    }

    /* ---------- Backups ---------- */
    function buildBackup(database, settings, medals, now = new Date()) {
        return {
            app: 'ServiceTimeTracker',
            backupVersion: SCHEMA_VERSION,
            exportedAt: now.toISOString(),
            database,
            settings,
            medals
        };
    }

    /** Parses backup text. Throws Error with a user-facing message when invalid. */
    function parseBackup(text) {
        let data;
        try { data = JSON.parse(text); } catch (e) { throw new Error('This file is not valid JSON.'); }
        if (!isObj(data) || !isObj(data.database)) throw new Error('This file does not look like a Service Time Tracker backup.');
        // Backups from 4.x have no version and their settings have no schemaVersion.
        const settings = isObj(data.settings) ? data.settings : {};
        const bundle = migrateBundle({ database: data.database, settings, medals: data.medals });
        return { ...bundle, exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null };
    }

    STT.storage = {
        KEYS, SCHEMA_VERSION, defaultSettings, defaultMedals, sanitizeEntry, sanitizeDatabase,
        sanitizeSettings, sanitizeMedals, legacyKeyToLocal, migrateLegacyKeys, migrateBundle,
        remapYearId, remapYearIds, remapYearGoals, load, save, buildBackup, parseBackup
    };
})(typeof self !== 'undefined' ? self : globalThis);

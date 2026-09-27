/* Local data store (IndexedDB) and migration from localStorage.
 *
 * The device database is the source of truth for the app; cloud sync is an
 * optional layer on top. Every save is written here first.
 *
 * IndexedDB "ServiceTimeTracker" v1:
 *   records  { id, v | x, u, c, d, dirty }  one per day / goal / medal / preference
 *   kv       { k, v }  device id, sync state, sync log, encrypted tokens, migration info
 *
 * The previous localStorage keys (serviceTimeTrackerDB / Settings / Medals) are
 * kept as a readable MIRROR, rewritten after every change. They let earlier app
 * versions still open the data, give theme.js its pre-paint colours, and act as
 * a recovery copy if the browser ever evicts IndexedDB.
 * If IndexedDB is unavailable (some private-browsing modes) the app keeps
 * working from localStorage exactly as before; only cloud sync is disabled.
 */
(function (root) {
    const STT = root.STT = root.STT || {};
    const Store = STT.storage, Core = STT.syncCore;

    const DB_NAME = 'ServiceTimeTracker';
    const DB_VERSION = 1;
    const STORAGE_FLAG = 'serviceTimeTrackerStorage';
    const DEVICE_KEY = 'serviceTimeTrackerDeviceId';

    /* ---------- Backends ---------- */
    const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

    function openIdb(name = DB_NAME) {
        return new Promise((resolve, reject) => {
            if (!root.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
            let r;
            try { r = root.indexedDB.open(name, DB_VERSION); } catch (e) { reject(e); return; }
            r.onupgradeneeded = () => {
                const db = r.result;
                if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
            };
            r.onsuccess = () => resolve(idbBackend(r.result));
            r.onerror = () => reject(r.error);
            r.onblocked = () => reject(new Error('IndexedDB blocked'));
        });
    }

    function idbBackend(db) {
        // Let another tab (or a newer version of the app) upgrade or delete the database.
        db.onversionchange = () => db.close();
        const tx = (stores, mode, fn) => new Promise((resolve, reject) => {
            const t = db.transaction(stores, mode);
            let out;
            Promise.resolve(fn(t)).then(v => { out = v; });
            t.oncomplete = () => resolve(out);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error || new Error('Transaction aborted'));
        });
        return {
            kind: 'indexeddb',
            getAll: () => tx(['records'], 'readonly', t => req(t.objectStore('records').getAll())),
            put: (recs) => tx(['records'], 'readwrite', t => { const s = t.objectStore('records'); recs.forEach(r => s.put(r)); }),
            del: (ids) => tx(['records'], 'readwrite', t => { const s = t.objectStore('records'); ids.forEach(id => s.delete(id)); }),
            clear: () => tx(['records'], 'readwrite', t => { t.objectStore('records').clear(); }),
            kvGet: (k) => tx(['kv'], 'readonly', t => req(t.objectStore('kv').get(k))).then(r => (r ? r.v : undefined)),
            kvSet: (k, v) => tx(['kv'], 'readwrite', t => { t.objectStore('kv').put({ k, v }); }),
            kvDel: (k) => tx(['kv'], 'readwrite', t => { t.objectStore('kv').delete(k); })
        };
    }

    function memoryBackend(kind = 'memory') {
        const recs = new Map(), kv = new Map();
        const clone = v => (v === undefined ? v : structuredClone(v));
        return {
            kind,
            getAll: async () => [...recs.values()].map(clone),
            put: async (list) => { list.forEach(r => recs.set(r.id, clone(r))); },
            del: async (ids) => { ids.forEach(id => recs.delete(id)); },
            clear: async () => { recs.clear(); },
            kvGet: async (k) => clone(kv.get(k)),
            kvSet: async (k, v) => { kv.set(k, clone(v)); },
            kvDel: async (k) => { kv.delete(k); }
        };
    }

    /* ---------- Store ---------- */
    function createLocalStore({ backend, mirror = true, clock = () => Date.now() }) {
        const records = new Map();           // id -> record, in memory
        let lastValues = new Map();          // live values of the last committed state
        let state = null;
        let deviceId = null;
        let skew = 0;                        // provider server time minus device time
        let lastU = 0;
        let chain = Promise.resolve();
        const listeners = { commit: new Set(), remote: new Set() };
        const emit = (ev, payload) => listeners[ev].forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });

        // All mutations run one after another.
        const exclusive = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

        const now = () => {
            let t = clock() + skew;
            if (t <= lastU) t = lastU + 1; // strictly increasing per device
            lastU = t;
            return t;
        };

        function liveValues() {
            const m = new Map();
            for (const r of records.values()) if (!r.x) m.set(r.id, r.v);
            return m;
        }

        function writeMirror() {
            if (!mirror) return;
            try {
                Store.save(Store.KEYS.db, state.database);
                Store.save(Store.KEYS.settings, state.settings);
                Store.save(Store.KEYS.medals, state.medals);
            } catch (e) { /* mirror is best effort */ }
        }

        function rebuild() {
            const values = liveValues();
            state = Core.valuesToState(values);
            lastValues = Core.stateToValues(state);
            return state;
        }

        /** Records for a legacy state. Unchanged default preferences are not recorded,
         *  so they can never override real choices from another device. */
        function recordsFromState(s, u) {
            const defaults = Core.stateToValues({ database: {}, settings: Store.defaultSettings(), medals: Store.defaultMedals() });
            const out = [];
            for (const [id, v] of Core.stateToValues(s)) {
                if (id.startsWith('p:') && defaults.has(id) && Core.sameValue(defaults.get(id), v)) continue;
                out.push({ id, v, u, c: clock(), d: deviceId, dirty: 1 });
            }
            return out;
        }

        async function loadDeviceId() {
            let id = await backend.kvGet('deviceId');
            let ls = null;
            try { ls = root.localStorage.getItem(DEVICE_KEY); } catch (e) { /* ignore */ }
            id = id || ls || Core.uuid();
            await backend.kvSet('deviceId', id);
            try { root.localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* ignore */ }
            return id;
        }

        /**
         * Opens the store. `legacy` is the result of STT.storage.load() (the
         * localStorage data, already migrated to schema v2 in memory).
         */
        async function open(legacy) {
            deviceId = await loadDeviceId();
            skew = (await backend.kvGet('clockSkew')) || 0;
            const schema = await backend.kvGet('schema');
            const stored = await backend.getAll();
            stored.forEach(r => { records.set(r.id, r); lastU = Math.max(lastU, r.u || 0); });
            let migrated = false, recovered = false;

            const legacyHasData = !!legacy && !isDefault(legacy);
            if (!schema || (!records.size && legacyHasData && flagSaysIdb())) {
                // First run on IndexedDB, or IndexedDB was cleared by the browser: import localStorage.
                recovered = !!schema;
                const recs = recordsFromState(legacy || { database: {}, settings: Store.defaultSettings(), medals: Store.defaultMedals() }, now());
                await backend.put(recs);
                // Verify before switching over: read everything back and compare.
                const check = await backend.getAll();
                const back = Core.valuesToState(new Map(check.filter(r => !r.x).map(r => [r.id, r.v])));
                const expect = legacy ? { database: legacy.database, settings: legacy.settings, medals: legacy.medals } : back;
                if (Core.canon(normalize(back)) !== Core.canon(normalize(expect))) {
                    throw new Error('Migration check failed; staying on localStorage');
                }
                check.forEach(r => records.set(r.id, r));
                await backend.kvSet('schema', { version: 1, migratedAt: new Date().toISOString(), from: 'localStorage', records: check.length });
                migrated = true;
            }
            if (backend.kind === 'indexeddb') {
                try { root.localStorage.setItem(STORAGE_FLAG, 'indexeddb'); } catch (e) { /* ignore */ }
            }
            rebuild();
            writeMirror();
            return { state, migrated, recovered, deviceId };
        }

        const normalize = s => ({ database: Store.sanitizeDatabase(s.database).db, settings: Store.sanitizeSettings(s.settings), medals: Store.sanitizeMedals(s.medals) });
        const isDefault = s => Core.canon(normalize(s)) === Core.canon(normalize({ database: {}, settings: Store.defaultSettings(), medals: Store.defaultMedals() }));
        const flagSaysIdb = () => { try { return root.localStorage.getItem(STORAGE_FLAG) === 'indexeddb'; } catch (e) { return false; } };

        /** Saves a new app state: only records whose values changed are written and queued for sync. */
        function save(next) {
            return exclusive(async () => {
                const nextValues = Core.stateToValues(next);
                const changed = [];
                for (const [id, v] of nextValues) {
                    if (!lastValues.has(id) || !Core.sameValue(lastValues.get(id), v)) {
                        changed.push({ id, v, u: now(), c: clock(), d: deviceId, dirty: 1 });
                    }
                }
                for (const id of lastValues.keys()) {
                    if (!nextValues.has(id)) changed.push({ id, x: 1, u: now(), c: clock(), d: deviceId, dirty: 1 });
                }
                if (!changed.length) return 0;
                await backend.put(changed);
                changed.forEach(r => records.set(r.id, r));
                lastValues = nextValues;
                state = Core.valuesToState(liveValues());
                writeMirror();
                emit('commit', { count: changed.length });
                return changed.length;
            });
        }

        /** Applies records that won against local copies during sync. */
        function applyRemote(updates, deletes) {
            return exclusive(async () => {
                const put = [];
                for (const r of updates) {
                    const cur = records.get(r.id);
                    // A local edit made while the sync was running must not be overwritten.
                    if (cur && cur.dirty && Core.wins(cur, r)) continue;
                    put.push({ id: r.id, ...(r.x ? { x: 1 } : { v: r.v }), u: r.u, c: r.c, d: r.d, dirty: 0 });
                }
                const del = deletes.filter(id => { const cur = records.get(id); return cur && !cur.dirty; });
                if (put.length) await backend.put(put);
                if (del.length) await backend.del(del);
                put.forEach(r => { records.set(r.id, r); lastU = Math.max(lastU, r.u); });
                del.forEach(id => records.delete(id));
                const changedLive = put.length + del.length;
                rebuild();
                if (changedLive) { writeMirror(); emit('remote', state); }
                return changedLive;
            });
        }

        /** Clears the pending flag for records that were uploaded unchanged. */
        function markClean(uploaded) {
            return exclusive(async () => {
                const put = [];
                for (const r of uploaded) {
                    const cur = records.get(r.id);
                    if (cur && cur.dirty && cur.u === r.u && cur.d === r.d) put.push({ ...cur, dirty: 0 });
                }
                if (put.length) { await backend.put(put); put.forEach(r => records.set(r.id, r)); }
                return put.length;
            });
        }

        /** Marks everything as pending again (used when joining a new cloud dataset). */
        function markAllDirty() {
            return exclusive(async () => {
                const put = [...records.values()].filter(r => !r.dirty).map(r => ({ ...r, dirty: 1 }));
                if (put.length) { await backend.put(put); put.forEach(r => records.set(r.id, r)); }
            });
        }

        /** Replaces all local data (backup import while not syncing). No tombstones are
         *  created, so connecting to a cloud copy later can never delete data there. */
        function replaceAll(next) {
            return exclusive(async () => {
                await backend.clear();
                records.clear();
                const recs = recordsFromState(next, now());
                await backend.put(recs);
                recs.forEach(r => records.set(r.id, r));
                rebuild();
                writeMirror();
                emit('remote', state);
                return state;
            });
        }

        /** Removes all tracker data from this device (not from the cloud). */
        function wipe() {
            return exclusive(async () => {
                await backend.clear();
                records.clear();
                rebuild();
                try {
                    [Store.KEYS.db, Store.KEYS.settings, Store.KEYS.medals, Store.KEYS.preMigration].forEach(k => root.localStorage.removeItem(k));
                } catch (e) { /* ignore */ }
                await backend.kvDel('conflicts');
                emit('remote', state);
                return state;
            });
        }

        async function addConflicts(list) {
            if (!list.length) return;
            const cur = (await backend.kvGet('conflicts')) || [];
            await backend.kvSet('conflicts', cur.concat(list).slice(-500));
        }

        return {
            open, save, applyRemote, markClean, markAllDirty, replaceAll, wipe, addConflicts,
            get state() { return state; },
            get deviceId() { return deviceId; },
            get backendKind() { return backend.kind; },
            get syncCapable() { return backend.kind !== 'legacy'; },
            records: () => [...records.values()],
            pendingCount: () => { let n = 0; for (const r of records.values()) if (r.dirty) n++; return n; },
            setClockSkew: async (ms) => { skew = ms; await backend.kvSet('clockSkew', ms); },
            get clockSkew() { return skew; },
            now,
            kvGet: (k) => backend.kvGet(k),
            kvSet: (k, v) => backend.kvSet(k, v),
            kvDel: (k) => backend.kvDel(k),
            on: (ev, fn) => { listeners[ev].add(fn); return () => listeners[ev].delete(fn); },
            idle: () => chain
        };
    }

    /** Opens the best available store for this browser. */
    async function openBest(legacy) {
        let backend;
        try { backend = await openIdb(); } catch (e) { backend = null; }
        if (backend) {
            try {
                const store = createLocalStore({ backend });
                const res = await store.open(legacy);
                return { store, ...res };
            } catch (e) {
                console.error('IndexedDB store failed, using localStorage:', e);
            }
        }
        // Fallback: same API, in memory, persisted only through the localStorage mirror.
        const store = createLocalStore({ backend: memoryBackend('legacy') });
        const res = await store.open(legacy);
        return { store, ...res, fallback: true };
    }

    STT.localdb = { DB_NAME, openIdb, idbBackend, memoryBackend, createLocalStore, openBest };
})(typeof self !== 'undefined' ? self : globalThis);

/* Sync engine: local database  <->  the user's cloud provider.
 *
 * The calendar and Service History only ever talk to the local store. This
 * engine runs in the background: it uploads pending records, downloads other
 * devices' changes, merges per record (last write wins) and reports status.
 *
 * Provider adapters (js/providers.js) implement:
 *   list()                      -> Map path -> { rev, modified, duplicates? }
 *   read(path)                  -> { text, rev, modified, duplicateTexts? } | null
 *   write(path, text, {ifRev, create}) -> { rev, modified }
 *        ifRev: only overwrite that revision; create: only if the file does not exist yet.
 *        Either throws SyncError 'conflict' when violated (where the provider supports it).
 *   removeDuplicates(path)      optional
 *   removeAll()
 * Paths are provider independent: manifest.json, prefs.json, entries/YYYY-MM.json.
 */
(function (root) {
    const STT = root.STT = root.STT || {};
    const Core = STT.syncCore;
    const { SyncError } = Core;

    const STATE_KEY = 'syncState';
    const LOG_KEY = 'syncLog';
    const BACKOFF = [30e3, 60e3, 120e3, 300e3, 600e3, 1800e3];
    const DEBOUNCE_MS = 4000;
    const PERIODIC_MS = 15 * 60e3;
    const MAX_SKEW = 7 * 24 * 3600e3;

    function createSyncEngine({ local, clock = () => Date.now(), isOnline = () => (root.navigator ? root.navigator.onLine !== false : true) }) {
        let adapter = null;
        let st = null;             // persisted sync state
        let running = null;        // in-flight sync promise
        let rerun = false;
        let timer = null;
        let failures = 0;
        let status = { connected: false, phase: 'idle' };
        const listeners = new Set();

        async function loadState() {
            st = (await local.kvGet(STATE_KEY)) || null;
            return st;
        }
        async function saveState() { await local.kvSet(STATE_KEY, st); }

        function setStatus(patch) {
            status = {
                ...status, ...patch,
                connected: !!st,
                provider: st ? st.provider : null,
                account: st ? st.account : null,
                mode: st ? st.mode : 'auto',
                lastSyncAt: st ? st.lastSyncAt : null,
                pending: local.pendingCount()
            };
            listeners.forEach(fn => { try { fn(status); } catch (e) { console.error(e); } });
        }

        async function log(entry) {
            const list = (await local.kvGet(LOG_KEY)) || [];
            list.push({ t: new Date(clock()).toISOString(), provider: st && st.provider, ...entry });
            await local.kvSet(LOG_KEY, list.slice(-30));
        }

        /* ---------- One full sync pass ---------- */
        async function syncOnce() {
            const now = local.now();
            const listing = await adapter.list();
            const counts = { up: 0, down: 0, files: 0 };

            // Manifest: identifies the cloud dataset and its format version.
            let manifest = null;
            const mRemote = listing.get('manifest.json');
            if (mRemote && st.datasetId && st.manifestRev && mRemote.rev === st.manifestRev) {
                manifest = { datasetId: st.datasetId }; // unchanged since last time: skip the download
            } else if (mRemote) {
                const m = await adapter.read('manifest.json');
                if (m) {
                    try { manifest = Core.parseManifest(m.text); } catch (e) {
                        if (e.code === 'schema-newer') throw e;
                        await quarantine('manifest.json', m.text, now);
                        manifest = null;
                    }
                }
            }
            const hasDataFiles = [...listing.keys()].some(Core.isDataFile);
            if (!manifest) {
                // Keep the old dataset id if files exist but the manifest was lost, so
                // devices do not treat existing files as a brand-new dataset.
                const datasetId = hasDataFiles && st.datasetId ? st.datasetId : Core.uuid();
                const w = await adapter.write('manifest.json', Core.buildManifest(datasetId, now), listing.has('manifest.json') ? {} : { create: true });
                manifest = { datasetId };
                st.manifestRev = w.rev;
            } else if (mRemote) {
                st.manifestRev = mRemote.rev;
            }
            if (st.datasetId !== manifest.datasetId) {
                st.datasetId = manifest.datasetId;
                st.files = {};
            }

            const groups = Core.groupByFile(local.records());
            const paths = new Set([...groups.keys(), ...[...listing.keys()].filter(Core.isDataFile)]);
            for (const path of [...paths].sort()) {
                const localGroup = groups.get(path) || new Map();
                const remote = listing.get(path);
                const seen = st.files[path];
                const hasDirty = [...localGroup.values()].some(r => r.dirty);
                if (remote && seen && seen.rev === remote.rev && !hasDirty && !remote.duplicates) continue;
                if (!remote && !localGroup.size) continue;

                let cloud = null, corrupt = false, rev = remote ? remote.rev : undefined;
                if (remote) {
                    const got = await adapter.read(path);
                    if (got) {
                        rev = got.rev || rev;
                        try {
                            const parsed = [Core.parseFile(got.text, path)];
                            for (const t of got.duplicateTexts || []) {
                                try { parsed.push(Core.parseFile(t, path)); } catch (e) { if (e.code === 'schema-newer') throw e; }
                            }
                            cloud = parsed.length > 1 ? Core.combineParsed(parsed) : parsed[0];
                        } catch (e) {
                            if (e.code === 'schema-newer') throw e;
                            // Never let a damaged cloud file touch local data: set it aside and rebuild it.
                            await quarantine(path, got.text, now);
                            corrupt = true;
                        }
                    }
                }

                const sameGen = !!(cloud && seen && cloud.gen && seen.gen === cloud.gen);
                const res = Core.mergeFile({ local: localGroup, cloud, sameGen, now });
                if (res.conflicts.length) await local.addConflicts(res.conflicts);
                if (res.localUpdates.length || res.localDeletes.length) {
                    counts.down += await local.applyRemote(res.localUpdates, res.localDeletes);
                }

                const gen = (cloud && cloud.gen) || Core.uuid();
                if (res.uploadNeeded || corrupt || (remote && remote.duplicates)) {
                    const text = Core.buildFile(path, res.fileRecords, { gen, purgedBefore: res.purgedBefore });
                    const t0 = clock();
                    // Conditional write: fails with 'conflict' if another device changed
                    // (or created) the file since we read it; the pass is then re-run.
                    const w = await adapter.write(path, text, remote ? { ifRev: corrupt ? undefined : rev } : { create: true });
                    await learnSkew(w.modified, t0, clock());
                    if (remote && remote.duplicates && adapter.removeDuplicates) await adapter.removeDuplicates(path);
                    st.files[path] = { rev: w.rev, gen };
                    const uploaded = [...res.fileRecords.values()];
                    counts.up += [...localGroup.values()].filter(r => r.dirty || !cloud || !cloud.records.has(r.id)).length;
                    await local.markClean(uploaded);
                    counts.files++;
                } else {
                    st.files[path] = { rev, gen };
                    await local.markClean([...res.fileRecords.values()]);
                }
            }
            st.lastSyncAt = new Date(clock()).toISOString();
            await saveState();
            return counts;
        }

        async function quarantine(path, text, now) {
            const name = `quarantine/${path.replace(/\//g, '_')}-${now}.json`;
            try { await adapter.write(name, text, {}); } catch (e) { /* best effort */ }
            await log({ ok: false, code: 'corrupt', message: `Damaged cloud file ${path} was set aside as ${name}` });
        }

        async function learnSkew(modified, t0, t1) {
            const server = Date.parse(modified || '');
            if (!Number.isFinite(server)) return;
            const offset = server - (t0 + t1) / 2;
            // Only correct clearly wrong device clocks; small differences are normal.
            const next = Math.abs(offset) > 120e3 ? Math.max(-MAX_SKEW, Math.min(MAX_SKEW, offset)) : 0;
            if (Math.abs(next - local.clockSkew) > 60e3 || (next === 0 && local.clockSkew !== 0)) await local.setClockSkew(next);
        }

        /* ---------- Public sync entry point ---------- */
        async function sync(reason = 'auto') {
            if (!st || !adapter) return null;
            if (running) { rerun = true; return running; }
            clearTimeout(timer);
            if (!isOnline()) {
                setStatus({ phase: 'offline' });
                return null;
            }
            setStatus({ phase: 'syncing', error: null });
            running = (async () => {
                let counts = null, attempt = 0;
                try {
                    await adapter.ensureAuth();
                    for (;;) {
                        try { counts = await syncOnce(); break; } catch (e) {
                            // Another device wrote the same file at the same moment: merge again.
                            if (e.code === 'conflict' && attempt++ < 3) { await loadState(); continue; }
                            throw e;
                        }
                    }
                    failures = 0;
                    st.lastError = null;
                    await saveState();
                    await log({ ok: true, reason, up: counts.up, down: counts.down });
                    setStatus({ phase: 'idle', error: null, nextRetryAt: null });
                } catch (e) {
                    await handleFailure(e, reason);
                } finally {
                    running = null;
                }
                if (rerun) { rerun = false; schedule(500, 'rerun'); }
                return counts;
            })();
            return running;
        }

        async function handleFailure(e, reason) {
            const code = e.code || (e.name === 'TypeError' ? 'offline' : 'unknown');
            const message = e.code ? e.message : 'Unexpected sync problem';
            if (!e.code) console.error(e);
            if (st) { st.lastError = { code, message, at: new Date(clock()).toISOString() }; await saveState(); }
            await log({ ok: false, reason, code, message });
            if (code === 'offline') { setStatus({ phase: 'offline', error: null }); return; }
            if (code === 'auth') { setStatus({ phase: 'auth', error: { code, message } }); return; }
            if (code === 'schema-newer' || code === 'config' || code === 'denied') { setStatus({ phase: 'error', error: { code, message }, nextRetryAt: null }); return; }
            const delay = e.retryAfter ? Math.min(3600e3, e.retryAfter * 1000) : BACKOFF[Math.min(failures, BACKOFF.length - 1)];
            failures++;
            const nextRetryAt = clock() + delay;
            setStatus({ phase: 'error', error: { code, message }, nextRetryAt });
            if (st && st.mode === 'auto') schedule(delay, 'retry');
        }

        function schedule(delay, reason) {
            if (!st || !adapter) return;
            clearTimeout(timer);
            timer = setTimeout(() => { sync(reason); }, delay);
        }

        /** Called on app events; respects Manual mode and back-off. */
        function nudge(reason, delay = DEBOUNCE_MS) {
            if (!st || st.mode !== 'auto') { setStatus({}); return; }
            // Opening/returning to the app or the timer: skip if we synced within the last minute.
            if ((reason === 'foreground' || reason === 'periodic') && !local.pendingCount() && st.lastSyncAt && clock() - Date.parse(st.lastSyncAt) < 60e3) { setStatus({}); return; }
            if (status.phase === 'auth' || (status.phase === 'error' && status.error && ['schema-newer', 'config', 'denied'].includes(status.error.code))) { setStatus({}); return; }
            if (status.phase === 'error' && status.nextRetryAt && reason === 'commit') { setStatus({}); return; } // wait for back-off
            schedule(delay, reason);
            setStatus({});
        }

        /* ---------- Connection lifecycle ---------- */
        async function attach(newAdapter) {
            adapter = newAdapter;
            await loadState();
            setStatus({ phase: status.phase || 'idle' });
        }

        /** Looks at the cloud before the first sync, so the user can choose what happens. */
        async function inspectCloud(tempAdapter) {
            await tempAdapter.ensureAuth();
            const listing = await tempAdapter.list();
            const values = new Map();
            let files = 0, damaged = 0;
            for (const path of [...listing.keys()].filter(Core.isDataFile)) {
                const got = await tempAdapter.read(path);
                if (!got) continue;
                try {
                    const p = Core.parseFile(got.text, path);
                    files++;
                    for (const [id, r] of p.records) if (!r.x) values.set(id, r.v);
                } catch (e) {
                    if (e.code === 'schema-newer') throw e;
                    damaged++;
                }
            }
            return { empty: values.size === 0, summary: Core.summarize(values), files, damaged };
        }

        function localSummary() {
            const values = new Map();
            for (const r of local.records()) if (!r.x) values.set(r.id, r.v);
            return { empty: ![...values.keys()].some(id => id.startsWith('e:')) && values.size === 0, hasEntries: [...values.keys()].some(id => id.startsWith('e:')), summary: Core.summarize(values) };
        }

        /** Starts syncing with a provider. choice: 'merge' | 'replace-local'. */
        async function connect(newAdapter, { provider, account, choice = 'merge' }) {
            adapter = newAdapter;
            const prev = await local.kvGet('lastAccount');
            if (choice === 'replace-local') await local.wipe();
            else await local.markAllDirty();
            st = { provider, account, mode: (st && st.mode) || 'auto', datasetId: null, files: {}, lastSyncAt: null, lastError: null, connectedAt: new Date(clock()).toISOString() };
            await saveState();
            await local.kvSet('lastAccount', { provider, id: account && account.id });
            await log({ ok: true, reason: 'connect', message: `Connected (${choice})` });
            setStatus({ phase: 'idle' });
            return { previousAccount: prev };
        }

        async function disconnect({ wipeLocal = false } = {}) {
            const a = adapter;
            clearTimeout(timer);
            if (running) { try { await running; } catch (e) { /* ignore */ } }
            if (a && a.signOut) { try { await a.signOut(); } catch (e) { /* best effort */ } }
            await log({ ok: true, reason: 'disconnect', message: wipeLocal ? 'Disconnected, local data removed' : 'Disconnected, local copy kept' });
            st = null;
            adapter = null;
            await local.kvDel(STATE_KEY);
            if (wipeLocal) { await local.wipe(); await local.kvDel('lastAccount'); }
            failures = 0;
            setStatus({ phase: 'idle', error: null });
        }

        /** Deletes the tracker's cloud files. Local data is untouched. */
        async function deleteCloudData() {
            if (!adapter) throw new SyncError('config', 'Not connected');
            await adapter.ensureAuth();
            await adapter.removeAll();
            await log({ ok: true, reason: 'delete-cloud', message: 'Cloud backup deleted' });
        }

        async function setMode(mode) {
            if (!st) return;
            st.mode = mode === 'manual' ? 'manual' : 'auto';
            await saveState();
            setStatus({});
            if (st.mode === 'auto') nudge('mode', 500);
        }

        return {
            attach, connect, disconnect, deleteCloudData, inspectCloud, localSummary,
            sync, nudge, setMode, loadState,
            syncNow: () => { failures = 0; return sync('manual'); },
            get status() { return status; },
            get state() { return st; },
            get adapter() { return adapter; },
            onStatus: fn => { listeners.add(fn); fn(status); return () => listeners.delete(fn); },
            log: () => local.kvGet(LOG_KEY).then(l => l || []),
            refreshStatus: () => setStatus({})
        };
    }

    STT.syncEngine = { createSyncEngine, PERIODIC_MS, DEBOUNCE_MS };
})(typeof self !== 'undefined' ? self : globalThis);

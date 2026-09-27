/* Account & Sync screen and background sync wiring.
 *
 * Nothing here is needed to use the app: without a connected provider this
 * only renders the "your data is on this device" screen. When a provider is
 * connected it starts the sync engine and syncs on save (debounced), on open,
 * when the app returns to the foreground, when the connection comes back,
 * every 15 minutes while open, and on "Sync Now".
 */
(function (root) {
    const STT = root.STT = root.STT || {};
    const $ = id => document.getElementById(id);
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

    let local = null, app = null, engine = null, busy = null;
    const P = () => STT.providers;

    const NOTES = {
        google: 'In the web app Google keeps you signed in for about an hour. After that, sync pauses (your changes keep saving here) until you tap Reconnect.',
        onedrive: 'In the web app Microsoft keeps you signed in for 24 hours. After that, sync pauses (your changes keep saving here) until you tap Reconnect.',
        dropbox: 'Dropbox keeps you signed in until you disconnect.',
        icloud: ''
    };
    const nameOf = id => (P().DEFS[id] ? P().DEFS[id].name : id);

    /* ---------- Status text ---------- */
    function describe(s) {
        if (!s.connected) return { icon: '', text: 'Not connected', tone: '' };
        if (s.phase === 'syncing') return { icon: '⟳', text: 'Syncing…', tone: 'busy' };
        if (s.phase === 'offline') return { icon: '⚡', text: s.pending ? `Offline — ${s.pending} change${s.pending === 1 ? '' : 's'} saved on this device` : 'Offline — changes are saved on this device', tone: 'warn' };
        if (s.phase === 'auth') return { icon: '!', text: 'Sign-in expired — tap Reconnect', tone: 'warn', action: 'reconnect' };
        if (s.phase === 'error') return { icon: '!', text: `Sync problem — tap to retry${s.error && s.error.message ? `\n${s.error.message}` : ''}`, tone: 'bad', action: 'retry' };
        if (s.pending) return { icon: '•', text: `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to sync${s.mode === 'manual' ? ' — tap Sync Now' : ''}`, tone: 'warn' };
        if (!s.lastSyncAt) return { icon: '•', text: 'Waiting for first sync', tone: '' };
        return { icon: '✓', text: 'Synced', tone: 'good' };
    }

    function when(iso) {
        if (!iso) return 'Never';
        const d = new Date(iso);
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const today = STT.dates.todayKey();
        const key = STT.dates.dateToKey(d);
        if (key === today) return `Today at ${time}`;
        if (key === STT.dates.addDays(today, -1)) return `Yesterday at ${time}`;
        return `${STT.dates.formatShortDate(key)} at ${time}`;
    }

    function updateBadge(s) {
        const dot = $('sync-dot');
        const show = s.connected && (s.phase === 'error' || s.phase === 'auth' || (s.phase === 'offline' && s.pending > 0));
        dot.hidden = !show;
        dot.className = 'sync-dot' + (s.phase === 'error' ? ' bad' : ' warn');
        const ms = $('menu-sync-status');
        ms.textContent = !s.connected ? '' : s.phase === 'error' || s.phase === 'auth' ? '!' : s.phase === 'syncing' ? '⟳' : s.pending ? '•' : '✓';
        ms.className = 'menu-status' + (s.phase === 'error' ? ' bad' : s.phase === 'auth' ? ' warn' : '');
        const menuBtn = $('menu-btn');
        menuBtn.setAttribute('aria-label', show ? `Open menu (sync needs attention: ${describe(s).text.split('\n')[0]})` : 'Open menu');
    }

    /* ---------- Rendering ---------- */
    function render() {
        const body = $('sync-body');
        if (!body) return;
        body.textContent = '';
        if (!local || !local.syncCapable) { renderUnavailable(body); return; }
        if (busy) {
            const b = el('div', 'empty');
            b.append(el('p', 'empty-title', busy), el('p', 'empty-text', 'Please keep the app open.'));
            body.appendChild(b);
            return;
        }
        if (engine && engine.status.connected) renderConnected(body); else renderDisconnected(body);
    }

    function renderUnavailable(body) {
        const g = el('section', 'group');
        g.append(el('p', 'sync-lead', 'Your data is stored only on this device.'),
            el('p', 'group-note', 'Cloud sync needs this browser’s built-in database (IndexedDB), which is turned off here, for example in private browsing. The app keeps working normally on this device; use Import / Export to keep a backup.'));
        body.appendChild(g);
    }

    function renderDisconnected(body) {
        const intro = el('section', 'group');
        intro.append(
            el('p', 'sync-lead', 'Your data is stored only on this device.'),
            el('p', 'group-note', 'Cloud sync is optional. Connect your own cloud account to back up your tracker and use it on your other devices. Your records go to your account only — never to a server run by this app.')
        );
        body.appendChild(intro);

        const list = el('section', 'group');
        list.appendChild(el('h3', 'group-title', 'Connect a cloud account'));
        const defs = P().describe().filter(d => !d.native || d.available);
        let shown = 0;
        for (const d of defs) {
            if (!d.configured) continue;
            shown++;
            const b = el('button', 'provider-row');
            b.type = 'button';
            b.dataset.provider = d.id;
            const logo = el('span', `provider-logo p-${d.id}`, d.name[0]);
            logo.setAttribute('aria-hidden', 'true');
            const txt = el('span', 'provider-text');
            txt.append(el('span', 'provider-name', d.name), el('span', 'provider-sub', `Works on ${d.platforms}`));
            b.append(logo, txt, el('span', 'provider-action', 'Connect'));
            b.addEventListener('click', () => startConnect(d.id));
            list.appendChild(b);
        }
        if (!shown) {
            list.appendChild(el('p', 'group-note', 'Cloud sync isn’t available in this copy of the app yet.'));
            list.appendChild(el('p', 'group-note small', 'For the app owner: add provider client IDs in js/cloud-config.js (see CLOUD_SYNC_SETUP.md).'));
        }
        if (!P().DEFS.icloud.available()) {
            list.appendChild(el('p', 'group-note small', 'iCloud will be available in the iPhone and iPad app. It isn’t supported in web browsers or on Android.'));
        }
        body.appendChild(list);
        body.appendChild(helpSection());
    }

    function renderConnected(body) {
        const s = engine.status;
        const card = el('section', 'group sync-card');
        const head = el('div', 'sync-account');
        const logo = el('span', `provider-logo p-${s.provider}`, nameOf(s.provider)[0]);
        logo.setAttribute('aria-hidden', 'true');
        const who = el('div', 'provider-text');
        who.append(el('span', 'provider-name', nameOf(s.provider)), el('span', 'provider-sub', (s.account && s.account.label) || ''));
        head.append(logo, who);
        card.appendChild(head);

        const d = describe(s);
        const status = el(d.action ? 'button' : 'div', `sync-status ${d.tone}`);
        if (d.action) {
            status.type = 'button';
            status.addEventListener('click', () => (d.action === 'reconnect' ? reconnect() : engine.syncNow()));
        }
        status.append(el('span', 'sync-status-icon', d.icon), el('span', 'sync-status-text', d.text));
        card.appendChild(status);
        card.appendChild(el('p', 'group-note', `Last synced: ${when(s.lastSyncAt)}`));

        const actions = el('div', 'sync-actions');
        if (s.phase === 'auth') {
            const r = el('button', 'btn primary', 'Reconnect'); r.type = 'button'; r.id = 'sync-reconnect-btn';
            r.addEventListener('click', reconnect);
            actions.appendChild(r);
        }
        const now = el('button', 'btn' + (s.phase === 'auth' ? '' : ' primary'), 'Sync Now');
        now.type = 'button'; now.id = 'sync-now-btn';
        now.disabled = s.phase === 'syncing';
        now.addEventListener('click', () => engine.syncNow());
        actions.appendChild(now);
        card.appendChild(actions);
        if (NOTES[s.provider]) card.appendChild(el('p', 'group-note small', NOTES[s.provider]));
        body.appendChild(card);

        const mode = el('section', 'group');
        mode.appendChild(el('h3', 'group-title', 'Sync'));
        const row = el('div', 'field-row');
        row.appendChild(el('span', 'field-label', 'Mode'));
        const seg = el('div', 'segmented');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Sync mode');
        for (const [val, label] of [['auto', 'Automatic'], ['manual', 'Manual']]) {
            const b = el('button', '', label);
            b.type = 'button';
            b.dataset.mode = val;
            b.setAttribute('aria-pressed', String(s.mode === val));
            b.addEventListener('click', () => engine.setMode(val));
            seg.appendChild(b);
        }
        row.appendChild(seg);
        mode.appendChild(row);
        mode.appendChild(el('p', 'group-note small', s.mode === 'manual'
            ? 'Manual: changes are saved on this device and only sync when you tap Sync Now.'
            : 'Automatic (recommended): syncs shortly after you save, when you open the app and when you’re back online.'));
        body.appendChild(mode);

        const manage = el('section', 'group');
        manage.appendChild(el('h3', 'group-title', 'Account'));
        const dc = el('button', 'btn block', `Disconnect ${nameOf(s.provider)}`); dc.type = 'button'; dc.id = 'sync-disconnect-btn';
        dc.addEventListener('click', disconnectFlow);
        manage.appendChild(dc);
        manage.appendChild(el('p', 'group-note small', 'To switch to another provider, disconnect first (keep the local copy), then connect the new one. Your data is merged into it.'));
        body.appendChild(manage);

        const danger = el('section', 'group danger-zone');
        danger.appendChild(el('h3', 'group-title', 'Cloud backup'));
        const del = el('button', 'btn block danger-outline', 'Delete Cloud Backup…'); del.type = 'button'; del.id = 'sync-delete-cloud-btn';
        del.addEventListener('click', deleteCloudFlow);
        danger.appendChild(del);
        danger.appendChild(el('p', 'group-note small', `Permanently deletes the tracker data stored in your ${nameOf(s.provider)}. Data on this device is kept.`));
        body.appendChild(danger);

        body.appendChild(detailsSection());
        body.appendChild(helpSection());
    }

    function helpSection() {
        const det = el('details', 'group help');
        det.appendChild(el('summary', '', 'How cloud sync works'));
        [
            'Cloud sync is optional. Without it, your data stays on this device and nowhere else.',
            'With it, the app still saves everything on this device first and works offline. Your changes are then copied to your own cloud account, and other devices connected to the same account receive them.',
            'The tracker is kept in a private app folder in your cloud account, separate from your own files.',
            'If the same day is changed on two devices, the most recent change is kept. Older versions stay saved on the device and are included in exports.',
            'Import / Export still works and is a good extra backup.'
        ].forEach(t => det.appendChild(el('p', 'group-note', t)));
        return det;
    }

    function detailsSection() {
        const det = el('details', 'group');
        det.appendChild(el('summary', '', 'Sync details'));
        const box = el('div', 'sync-log');
        det.appendChild(box);
        det.addEventListener('toggle', async () => {
            if (!det.open) return;
            box.textContent = '';
            box.appendChild(el('p', 'group-note small', `This device: ${String(local.deviceId).slice(0, 8)} · Storage: ${local.backendKind}`));
            const conflicts = (await local.kvGet('conflicts')) || [];
            if (conflicts.length) box.appendChild(el('p', 'group-note small', `${conflicts.length} replaced version${conflicts.length === 1 ? '' : 's'} kept on this device (included in exports).`));
            const logs = (await engine.log()).slice(-10).reverse();
            for (const l of logs) {
                const line = `${when(l.t)} · ${l.ok ? '✓' : '✗'} ${l.reason || ''}${l.up || l.down ? ` · ↑${l.up || 0} ↓${l.down || 0}` : ''}${l.code && !l.ok ? ` · ${l.code}` : ''}${l.message ? ` · ${l.message}` : ''}`;
                box.appendChild(el('p', 'log-line', line));
            }
            if (!logs.length) box.appendChild(el('p', 'group-note small', 'No sync activity yet.'));
        });
        return det;
    }

    /* ---------- Flows ---------- */
    async function startConnect(id) {
        if (!navigator.onLine) { app.showAlert('You’re offline. Connect to the internet to set up cloud sync.'); return; }
        const def = P().DEFS[id];
        try {
            await local.idle(); // make sure every pending save is written before leaving the page
            const r = await P().beginConnect(id);
            if (r && r.native) await finishConnect({ provider: id });
        } catch (e) {
            app.showAlert(e.message || `Could not start ${def.name} sign-in.`);
        }
    }

    async function reconnect() {
        const s = engine.status;
        await local.idle();
        try {
            await P().beginConnect(s.provider, { reconnect: true, loginHint: s.account && /@/.test(s.account.label || '') ? s.account.label : undefined });
        } catch (e) { app.showAlert(e.message); }
    }

    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    function summaryText(sum) {
        const parts = [plural(sum.entries, 'service entry', 'service entries'), plural(sum.years, 'service year', 'service years')];
        if (sum.notes) parts.push(plural(sum.notes, 'note', 'notes'));
        if (sum.planned) parts.push(plural(sum.planned, 'planned day', 'planned days'));
        return parts.join(' · ');
    }

    async function finishConnect(result) {
        busy = `Connecting to ${nameOf(result.provider)}…`;
        openPanel();
        render();
        let adapter, session;
        try {
            session = await P().completeConnect(local, result);
            adapter = await P().restore(local, result.provider);
            // Reconnecting the same account: just resume syncing.
            if (result.reconnect && engine.state && engine.state.provider === result.provider) {
                await engine.attach(adapter);
                busy = null; render();
                app.showToast(`${nameOf(result.provider)} reconnected`);
                engine.syncNow();
                return;
            }
            busy = 'Checking your cloud account…'; render();
            const cloud = await engine.inspectCloud(adapter);
            const mine = engine.localSummary();
            busy = null; render();
            const name = nameOf(result.provider);
            const prev = await local.kvGet('lastAccount');
            const otherAccount = prev && prev.id && session.account && session.account.id && prev.id !== session.account.id && mine.hasEntries
                ? '\n\nNote: this device was previously synced with a different account.' : '';

            let choice = 'merge';
            if (mine.hasEntries && cloud.empty) {
                const v = await app.showChoice({
                    title: 'Existing data found on this device',
                    message: `${summaryText(mine.summary)}\n\nUpload this data to your ${name} and start syncing?${otherAccount}`,
                    options: [{ label: 'Upload & Sync', value: 'merge', style: 'primary' }, { label: 'Cancel', value: null }]
                });
                if (!v) return cancel(adapter);
            } else if (!mine.hasEntries && !cloud.empty) {
                const v = await app.showChoice({
                    title: `Tracker data found in ${name}`,
                    message: `${summaryText(cloud.summary)}\n\nDownload it to this device and start syncing?`,
                    options: [{ label: 'Download & Sync', value: 'merge', style: 'primary' }, { label: 'Cancel', value: null }]
                });
                if (!v) return cancel(adapter);
            } else if (mine.hasEntries && !cloud.empty) {
                const v = await app.showChoice({
                    title: 'Data on both sides',
                    message: `This device: ${summaryText(mine.summary)}\n${name}: ${summaryText(cloud.summary)}\n\nMerge them? Where the same day or goal was changed in both places, the most recent change is kept; replaced versions stay saved on this device. Nothing else is removed.${otherAccount}`,
                    options: [
                        { label: 'Merge & Sync', value: 'merge', style: 'primary' },
                        { label: `Use ${name} data only`, value: 'replace-local', style: 'danger-outline' },
                        { label: 'Cancel', value: null }
                    ]
                });
                if (!v) return cancel(adapter);
                if (v === 'replace-local') {
                    const sure = await app.showConfirm(`This removes the ${plural(mine.summary.entries, 'entry', 'entries')} currently on this device and replaces them with your ${name} data. Export a backup first if you might need them.`, { okLabel: 'Replace This Device’s Data', danger: true });
                    if (!sure) return cancel(adapter);
                }
                choice = v;
            }
            if (cloud.damaged) app.showToast(`${cloud.damaged} damaged cloud file${cloud.damaged === 1 ? '' : 's'} will be set aside and rebuilt`);
            await engine.connect(adapter, { provider: result.provider, account: session.account, choice });
            render();
            await engine.syncNow();
            if (engine.status.phase === 'idle') app.showToast(`${name} connected — sync is on`);
        } catch (e) {
            busy = null;
            if (adapter) { try { await adapter.signOut(); } catch (x) { /* ignore */ } }
            app.showAlert(`${nameOf(result.provider)} could not be connected. ${e.message || ''}\n\nYour data on this device is unchanged.`);
        } finally {
            busy = null;
            render();
        }
    }

    async function cancel(adapter) {
        busy = null;
        try { await adapter.signOut(); } catch (e) { /* ignore */ }
        render();
    }

    async function disconnectFlow() {
        const name = nameOf(engine.status.provider);
        const v = await app.showChoice({
            title: `Disconnect ${name}`,
            message: `What should happen to this device’s tracker data?\n\nYour ${name} copy is not deleted.`,
            options: [
                { label: 'Keep a local copy', value: 'keep', style: 'primary' },
                { label: 'Remove synced data from this device', value: 'wipe', style: 'danger-outline' },
                { label: 'Cancel', value: null }
            ]
        });
        if (!v) return;
        if (v === 'wipe') {
            const sure = await app.showConfirm(`All service records, plans, notes, goals and medals will be removed from this device. They remain in your ${name}.`, { okLabel: 'Remove From This Device', danger: true });
            if (!sure) return;
            // Upload anything still pending first so nothing is lost.
            if (engine.status.pending) {
                await engine.syncNow();
                if (local.pendingCount()) {
                    const force = await app.showConfirm(`${local.pendingCount()} change(s) could not be uploaded yet and would be lost. Remove anyway?`, { okLabel: 'Remove Anyway', danger: true });
                    if (!force) return;
                }
            }
        }
        await engine.disconnect({ wipeLocal: v === 'wipe' });
        app.showToast(v === 'wipe' ? 'Disconnected and removed from this device' : `${name} disconnected — data kept on this device`);
        render();
    }

    async function deleteCloudFlow() {
        const name = nameOf(engine.status.provider);
        const first = await app.showConfirm(`Delete your Service Time Tracker backup from ${name}?\n\nThe cloud copy is deleted permanently. Data on this device is kept and sync is turned off here. Devices that are still connected will upload their copy again, so disconnect them first.`, { okLabel: 'Continue', danger: true });
        if (!first) return;
        const second = await app.showConfirm(`Are you sure? This permanently deletes the tracker data in your ${name}.`, { okLabel: 'Delete Cloud Backup', danger: true });
        if (!second) return;
        try {
            await engine.deleteCloudData();
            await engine.disconnect({ wipeLocal: false });
            app.showAlert(`Your ${name} backup was deleted. Your data is still on this device.`);
        } catch (e) {
            app.showAlert(`The cloud backup could not be deleted: ${e.message}`);
        }
        render();
    }

    function openPanel() {
        const dlg = $('sync-panel');
        if (!STT.layers.isOpen(dlg)) app.openPanel(dlg);
    }

    /* ---------- Start ---------- */
    async function init({ local: l, app: a }) {
        local = l; app = a;
        if (!local || !local.syncCapable) { updateBadge({ connected: false }); return; }
        engine = STT.syncEngine.createSyncEngine({ local });
        STT.sync = engine;
        const st = await engine.loadState();
        if (st) {
            const adapter = await P().restore(local, st.provider);
            if (adapter) await engine.attach(adapter);
        }
        engine.onStatus(s => {
            updateBadge(s);
            if (STT.layers.isOpen($('sync-panel')) && !busy) render();
        });

        local.on('commit', () => engine.nudge('commit'));
        root.addEventListener('online', () => engine.nudge('online', 1000));
        root.addEventListener('offline', () => engine.refreshStatus());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            checkRedirect();
            engine.nudge('foreground', 1500);
        });
        setInterval(() => { if (document.visibilityState === 'visible') engine.nudge('periodic', 0); }, STT.syncEngine.PERIODIC_MS);
        // A sign-in finished in another window of this app (e.g. an in-app browser).
        root.addEventListener('storage', e => { if (e.key === 'stt.oauth.result' && e.newValue) checkRedirect(); });
        root.addEventListener('stt-oauth-result', checkRedirect); // native apps (providers.acceptCallbackUrl)

        checkRedirect();
        if (st) engine.nudge('open', 800);
    }

    function checkRedirect() {
        const result = P().takeRedirectResult();
        if (!result) return;
        if (result.error) {
            openPanel();
            render();
            app.showAlert(result.error);
            return;
        }
        finishConnect(result);
    }

    STT.syncUI = {
        init,
        open: () => { openPanel(); render(); },
        isConnected: () => !!(engine && engine.status.connected)
    };
})(typeof self !== 'undefined' ? self : globalThis);

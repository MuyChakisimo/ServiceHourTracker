/* Service Time Tracker – UI controller.
 *
 * Sections: state · rendering (header, calendar, summaries) · entry modal ·
 * planning · goals · Service History · medals · theme · import/export ·
 * menu & sharing · PWA · startup.
 */
(function () {
    'use strict';
    const { dates: D, stats: S, storage: Store, achievements: A, theme: Theme, layers: L } = window.STT;

    const $ = id => document.getElementById(id);
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const fmt = S.formatDuration;
    const SHARE_URL = 'https://muychakisimo.github.io/ServiceHourTracker/';

    /* ================= State ================= */
    const loaded = Store.load();
    let db = loaded.database;
    let settings = loaded.settings;
    let medals = loaded.medals;

    const now = new Date();
    let today = D.todayKey(now);
    const view = { year: now.getFullYear(), month: now.getMonth() }; // always a month, never a day
    const planning = { on: false, scope: 'per-day' };
    let editingKey = null;

    function persist(which) {
        const ok = (!which.includes('db') || Store.save(Store.KEYS.db, db))
            & (!which.includes('settings') || Store.save(Store.KEYS.settings, settings))
            & (!which.includes('medals') || Store.save(Store.KEYS.medals, medals));
        if (!ok) showAlert('Your changes could not be saved on this device (storage may be full or disabled). Export a backup to keep your data safe.');
        return !!ok;
    }

    const currentServiceYear = () => D.serviceYearFor(view.year, view.month, settings.serviceYearStartMonth);

    /* ================= Toast & banner ================= */
    let toastTimer = null;
    function showToast(message) {
        const t = $('toast');
        t.textContent = message;
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
    }

    let bannerAction = null, bannerDismiss = null;
    function showBanner(text, actionLabel, onAction, onDismiss) {
        $('app-banner-text').textContent = text;
        const btn = $('app-banner-action');
        btn.hidden = !actionLabel;
        btn.textContent = actionLabel || '';
        bannerAction = onAction;
        bannerDismiss = onDismiss;
        $('app-banner').hidden = false;
    }
    function hideBanner() { $('app-banner').hidden = true; bannerAction = bannerDismiss = null; }

    /* ================= Alert / confirm ================= */
    function dialogMessage(message, { confirm = false, okLabel = 'OK', danger = false } = {}) {
        return new Promise(resolve => {
            const dlg = $('alert-modal');
            let result = false;
            $('alert-message').textContent = message;
            const ok = $('alert-ok-btn'), cancel = $('alert-cancel-btn');
            ok.textContent = okLabel;
            ok.classList.toggle('danger', danger);
            ok.classList.toggle('primary', !danger);
            cancel.hidden = !confirm;
            ok.onclick = () => { result = true; L.close(dlg); };
            cancel.onclick = () => { result = false; L.close(dlg); };
            L.open(dlg, { onClose: () => resolve(result) });
            setTimeout(() => (confirm ? cancel : ok).focus(), 0);
        });
    }
    const showAlert = (m) => dialogMessage(m);
    const showConfirm = (m, o) => dialogMessage(m, { confirm: true, ...o });

    /* ================= Header ================= */
    function renderHeader() {
        const title = $('month-title');
        title.querySelector('.t-long').textContent = D.formatMonthYear(view.year, view.month);
        title.querySelector('.t-short').textContent = D.formatMonthYear(view.year, view.month, true);
        const t = D.parseDateKey(today);
        const onToday = t.year === view.year && t.month === view.month;
        const btn = $('today-btn');
        btn.classList.toggle('is-current', onToday);
        btn.setAttribute('aria-disabled', String(onToday));
    }

    function goToMonth(year, month) {
        view.year = year;
        view.month = month;
        renderAll();
    }

    function shiftMonth(n) {
        const m = D.addMonths(view.year, view.month, n);
        goToMonth(m.year, m.month);
    }

    function goToToday() {
        today = D.todayKey();
        const t = D.parseDateKey(today);
        goToMonth(t.year, t.month);
        const cell = document.querySelector('.day.is-today');
        if (cell) {
            cell.classList.remove('pulse');
            void cell.offsetWidth; // restart the animation
            cell.classList.add('pulse');
        }
    }

    /* ================= Calendar ================= */
    function renderWeekdays() {
        const wrap = $('calendar-weekdays');
        wrap.textContent = '';
        for (const h of D.weekdayHeaders(settings.weekStartsOn)) {
            const d = el('div', 'weekday', h.short);
            d.setAttribute('aria-hidden', 'true');
            d.title = h.long;
            wrap.appendChild(d);
        }
    }

    function describeDay(key, entry, status) {
        const parts = [D.formatLongDate(key) + ', ' + D.parseDateKey(key).year];
        if (key === today) parts.push('today');
        if (entry && entry.plannedTime) parts.push(`planned ${fmt(entry.plannedTime)}`);
        if (entry && entry.time) parts.push(`logged ${fmt(entry.time)}`);
        if (entry && entry.studies) parts.push(`${entry.studies} ${entry.studies === 1 ? 'study' : 'studies'}`);
        if (entry && entry.notes) parts.push('has notes');
        const statusText = { complete: 'target met', under: 'below target', missed: 'target missed', planned: 'planned' }[status];
        if (statusText) parts.push(statusText);
        return parts.join(', ');
    }

    function renderCalendar() {
        const grid = $('calendar-grid');
        const { rows, cells } = D.buildMonthGrid(view.year, view.month, settings.weekStartsOn);
        grid.style.setProperty('--rows', rows);
        grid.dataset.rows = rows;
        const frag = document.createDocumentFragment();
        for (const c of cells) {
            const entry = db[c.key];
            const status = S.dayStatus(entry, c.key, today);
            const btn = el('button', 'day');
            btn.type = 'button';
            btn.dataset.key = c.key;
            if (!c.inMonth) { btn.classList.add('is-out'); btn.dataset.out = '1'; }
            if (c.key === today) { btn.classList.add('is-today'); btn.setAttribute('aria-current', 'date'); }
            if (c.key < today) btn.classList.add('is-past');
            if (status) btn.classList.add('st-' + status);
            if (planning.on && c.inMonth && c.key >= today) btn.classList.add('plannable');
            btn.setAttribute('aria-label', describeDay(c.key, entry, status));

            const head = el('span', 'd-head');
            head.appendChild(el('span', 'd-num', String(c.day)));
            if (entry && entry.notes) head.appendChild(el('span', 'd-note', '📝'));
            btn.appendChild(head);
            if (entry && entry.plannedTime) btn.appendChild(el('span', 'd-line d-plan', fmt(entry.plannedTime, true)));
            if (entry && entry.time) btn.appendChild(el('span', 'd-line d-time', fmt(entry.time, true)));
            frag.appendChild(btn);
        }
        grid.textContent = '';
        grid.appendChild(frag);
        grid.setAttribute('aria-label', `${D.formatMonthYear(view.year, view.month)} calendar`);
    }

    function onDayClick(e) {
        const cell = e.target.closest('.day');
        if (!cell) return;
        const key = cell.dataset.key;
        const p = D.parseDateKey(key);
        if (cell.dataset.out) {
            // Adjacent-month day: go to its real month; in normal mode also open it.
            goToMonth(p.year, p.month);
            if (!planning.on) openEntry(key);
            else showToast(`Showing ${D.formatMonthYear(p.year, p.month)}`);
            return;
        }
        if (planning.on) {
            if (key < today) { showToast('Past days can’t be planned'); return; }
            openPlan(key);
        } else {
            openEntry(key);
        }
    }

    /* ================= Summaries ================= */
    function setProgress(prefix, prog) {
        const pct = Math.round(prog.percent);
        $(`${prefix}-progress-fill`).style.width = `${prog.barPercent}%`;
        $(`${prefix}-progress-text`).textContent = `${pct}%`;
        $(`${prefix}-progress`).setAttribute('aria-valuenow', String(Math.round(prog.barPercent)));
        $(`${prefix}-progress`).setAttribute('aria-valuetext', `${pct}% of goal`);
    }

    function renderSummaries() {
        const index = S.buildMonthIndex(db);
        const ms = S.monthSummary(db, settings, view.year, view.month, index);
        $('month-card-title').textContent = D.formatMonthYear(view.year, view.month);
        $('month-total').textContent = fmt(ms.minutes);
        $('month-studies').textContent = String(ms.studies);
        $('month-goal').textContent = ms.goalHours ? fmt(ms.goalMinutes) : '—';
        $('month-planned').textContent = fmt(ms.planned);
        $('month-left-label').textContent = ms.exceededBy > 0 ? 'Over' : 'Left';
        $('month-left').textContent = ms.exceededBy > 0 ? `+${fmt(ms.exceededBy)}` : fmt(ms.remaining);
        setProgress('month', ms);
        const mEmoji = $('month-goal-emoji');
        mEmoji.classList.toggle('earned', ms.reached);
        mEmoji.setAttribute('aria-label', ms.reached ? 'Monthly goal reached' : 'Monthly goal not reached yet');

        const sy = currentServiceYear();
        const ys = S.serviceYearSummary(db, settings, sy, today, index);
        $('year-card-title').textContent = sy.label;
        $('year-card-range').textContent = D.formatServiceYearRange(sy);
        $('year-goal').textContent = ys.goalHours ? fmt(ys.goalMinutes) : '—';
        $('year-total').textContent = fmt(ys.minutes);
        $('year-left-label').textContent = ys.exceededBy > 0 ? 'Over' : 'Left';
        $('year-left').textContent = ys.exceededBy > 0 ? `+${fmt(ys.exceededBy)}` : fmt(ys.remaining);
        setProgress('year', ys);
        const yEmoji = $('year-goal-emoji');
        yEmoji.classList.toggle('earned', ys.reached);
        yEmoji.setAttribute('aria-label', ys.reached ? 'Service year goal reached' : 'Service year goal not reached yet');
    }

    function renderAll() {
        renderHeader();
        renderCalendar();
        renderSummaries();
    }

    /* ================= Number inputs ================= */
    /** '' -> 0; digits only -> number; anything else -> NaN. */
    function readInt(input) {
        const v = input.value.trim();
        if (v === '') return 0;
        return /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
    }
    function readHours(input) {
        const v = input.value.trim().replace(',', '.');
        if (v === '') return 0;
        return /^\d+(\.\d+)?$/.test(v) ? parseFloat(v) : NaN;
    }
    function setError(id, msg, inputs = []) {
        $(id).textContent = msg || '';
        inputs.forEach(i => i.setAttribute('aria-invalid', msg ? 'true' : 'false'));
    }
    // Strip anything that is not a digit as the user types (numeric keyboards can still paste text).
    document.querySelectorAll('input[pattern="[0-9]*"]').forEach(inp => {
        inp.addEventListener('input', () => {
            const clean = inp.value.replace(/\D/g, '');
            if (clean !== inp.value) inp.value = clean;
        });
    });

    /* ================= Entry modal ================= */
    function openEntry(key) {
        editingKey = key;
        const e = db[key] || {};
        $('entry-title').textContent = D.formatLongDate(key);
        const time = e.time || 0;
        $('entry-hours').value = time ? String(Math.floor(time / 60)) : '';
        $('entry-minutes').value = time % 60 ? String(time % 60) : '';
        $('entry-studies').value = e.studies ? String(e.studies) : '';
        $('entry-notes').value = e.notes || '';
        const note = $('entry-plan-note');
        note.hidden = !e.plannedTime;
        note.textContent = e.plannedTime ? `🤔 Planned: ${fmt(e.plannedTime)}` : '';
        setError('entry-error', '', [$('entry-hours'), $('entry-minutes'), $('entry-studies')]);
        L.open($('entry-modal'), { onClose: () => { editingKey = null; } });
        // Avoid popping the keyboard over the modal on touch devices.
        if (!matchMedia('(pointer: coarse)').matches) $('entry-hours').focus();
    }

    /** Replaces one day's entry without touching its other fields; drops empty days. */
    function writeEntry(src, key, patch) {
        const next = { ...(src[key] || {}), ...patch };
        for (const k of ['time', 'studies', 'plannedTime']) if (!next[k]) delete next[k];
        if (!next.notes || !next.notes.trim()) delete next.notes;
        const out = { ...src };
        if (Object.keys(next).length) out[key] = next; else delete out[key];
        return out;
    }

    function saveEntry(ev) {
        ev.preventDefault();
        if (!editingKey) return;
        const hoursIn = $('entry-hours'), minsIn = $('entry-minutes'), studiesIn = $('entry-studies');
        const h = readInt(hoursIn), m = readInt(minsIn), st = readInt(studiesIn);
        if (Number.isNaN(h) || Number.isNaN(m) || h > 24 || m > 59 || h * 60 + m > 24 * 60) {
            setError('entry-error', 'Enter up to 24 hours, with minutes from 0 to 59.', [hoursIn, minsIn]);
            return;
        }
        if (Number.isNaN(st) || st > 999) {
            setError('entry-error', 'Studies must be a whole number.', [studiesIn]);
            return;
        }
        const key = editingKey;
        const before = db;
        // Only the actual-service fields change; plannedTime and anything else stay.
        const after = writeEntry(db, key, { time: h * 60 + m, studies: st, notes: $('entry-notes').value.trim() });
        const res = A.afterEntryChange(medals, before, after, settings, key);
        db = after;
        medals = res.medals;
        persist(['db', 'medals']);
        L.close($('entry-modal'));
        renderAll();
        announceAwards(res.awarded);
    }

    function announceAwards(awarded) {
        if (!awarded.length) return;
        const yr = awarded.find(a => a.type === 'year');
        const mo = awarded.find(a => a.type === 'month');
        const lines = [];
        if (mo) lines.push(`👍 You reached your monthly goal for ${mo.label} and earned a medal!`);
        if (yr) lines.push(`🏆 You reached your ${yr.label} goal and earned a trophy!`);
        showAlert(lines.join('\n\n'));
    }

    /* ================= Planning ================= */
    function setPlanning(on) {
        planning.on = on;
        document.body.classList.toggle('planning', on);
        $('planning-bar').hidden = !on;
        $('plan-mode-btn').setAttribute('aria-pressed', String(on));
        $('menu-btn').disabled = on;
        if (on) setPlanScope('per-day');
        renderCalendar();
    }

    function setPlanScope(scope) {
        planning.scope = scope;
        $('plan-per-day-btn').setAttribute('aria-pressed', String(scope === 'per-day'));
        $('plan-per-month-btn').setAttribute('aria-pressed', String(scope === 'per-month'));
        $('planning-hint').textContent = scope === 'per-day'
            ? 'Tap a day to set its target.'
            : 'Tap a day to plan that weekday for the whole month.';
    }

    /** Days a plan applies to: one day, or every matching weekday of that month from today on. */
    function planTargets(key) {
        if (planning.scope === 'per-day') return [key];
        const p = D.parseDateKey(key);
        const wd = D.weekdayOf(key);
        const out = [];
        for (let d = 1; d <= D.daysInMonth(p.year, p.month); d++) {
            const k = D.toDateKey(p.year, p.month, d);
            if (D.weekdayOf(k) === wd && k >= today) out.push(k);
        }
        return out;
    }

    function openPlan(key) {
        editingKey = key;
        const e = db[key] || {};
        const p = D.parseDateKey(key);
        const plan = e.plannedTime || 0;
        $('plan-hours').value = plan ? String(Math.floor(plan / 60)) : '';
        $('plan-minutes').value = plan % 60 ? String(plan % 60) : '';
        const targets = planTargets(key);
        if (planning.scope === 'per-month') {
            const dayName = D.WEEKDAYS_LONG[D.weekdayOf(key)];
            $('plan-title').textContent = `Plan every ${dayName}`;
            const allInMonth = Math.floor((D.daysInMonth(p.year, p.month) - 1 - ((D.weekdayOf(key) - new Date(p.year, p.month, 1).getDay() + 7) % 7)) / 7) + 1;
            $('plan-sub').textContent = `${targets.length} ${dayName}${targets.length === 1 ? '' : 's'} in ${D.formatMonthYear(p.year, p.month)}` +
                (targets.length < allInMonth ? ' (today and later)' : '');
            $('plan-save-btn').textContent = `Apply to ${dayName}s`;
            $('plan-clear-btn').textContent = `Clear ${dayName}s`;
        } else {
            $('plan-title').textContent = 'Plan service';
            $('plan-sub').textContent = D.formatLongDate(key);
            $('plan-save-btn').textContent = 'Save Plan';
            $('plan-clear-btn').textContent = 'Clear';
        }
        setError('plan-error', '', [$('plan-hours'), $('plan-minutes')]);
        L.open($('plan-modal'), { onClose: () => { editingKey = null; } });
        if (!matchMedia('(pointer: coarse)').matches) $('plan-hours').focus();
    }

    function applyPlan(minutes) {
        if (!editingKey) return;
        let next = db;
        for (const k of planTargets(editingKey)) next = writeEntry(next, k, { plannedTime: minutes });
        db = next;
        persist(['db']);
        L.close($('plan-modal'));
        renderAll();
    }

    function savePlan(ev) {
        ev.preventDefault();
        const hIn = $('plan-hours'), mIn = $('plan-minutes');
        const h = readInt(hIn), m = readInt(mIn);
        if (Number.isNaN(h) || Number.isNaN(m) || h > 24 || m > 59 || h * 60 + m > 24 * 60) {
            setError('plan-error', 'Enter up to 24 hours, with minutes from 0 to 59.', [hIn, mIn]);
            return;
        }
        applyPlan(h * 60 + m);
    }

    async function clearMonthPlans() {
        const label = D.formatMonthYear(view.year, view.month);
        const prefix = D.toMonthKey(view.year, view.month) + '-';
        const keys = Object.keys(db).filter(k => k.startsWith(prefix) && db[k].plannedTime);
        if (!keys.length) { showToast(`No plans in ${label}`); return; }
        const ok = await showConfirm(`Clear all ${keys.length} planned day${keys.length === 1 ? '' : 's'} in ${label}?\n\nLogged time, studies and notes are not affected.`, { okLabel: 'Clear Plans', danger: true });
        if (!ok) return;
        let next = db;
        for (const k of keys) next = writeEntry(next, k, { plannedTime: 0 });
        db = next;
        persist(['db']);
        renderAll();
        showToast(`Plans cleared for ${label}`);
    }

    /* ================= Goals ================= */
    const goalsCtx = { startMonth: 8 };

    function goalsServiceYear() {
        return D.serviceYearFor(view.year, view.month, goalsCtx.startMonth);
    }

    function renderGoalsYear() {
        const sy = goalsServiceYear();
        $('goal-year-label').textContent = sy.label;
        $('goal-year-range').textContent = D.formatServiceYearRange(sy);
        const end = D.MONTHS_LONG[(goalsCtx.startMonth + 11) % 12];
        $('sy-start-preview').textContent = `Runs ${D.MONTHS_LONG[goalsCtx.startMonth]} 1 → ${end} ${D.daysInMonth(2001, (goalsCtx.startMonth + 11) % 12)}.`;
    }

    function openGoals() {
        goalsCtx.startMonth = settings.serviceYearStartMonth;
        const sel = $('sy-start-select');
        if (!sel.options.length) D.MONTHS_LONG.forEach((m, i) => sel.add(new Option(m, String(i))));
        sel.value = String(goalsCtx.startMonth);
        $('goal-month-label').textContent = D.formatMonthYear(view.year, view.month);
        $('month-goal-input').value = String(S.monthGoalHours(settings, view.year, view.month));
        const sy = goalsServiceYear();
        $('year-goal-input').value = String(S.yearGoalHours(settings, sy.id));
        const monthPhase = S.periodPhase(D.toDateKey(view.year, view.month, 1), D.toDateKey(view.year, view.month, D.daysInMonth(view.year, view.month)), today);
        $('month-goal-scope').value = monthPhase === 'past' ? 'only' : 'forward';
        $('year-goal-scope').value = S.periodPhase(sy.startKey, sy.endKey, today) === 'past' ? 'only' : 'forward';
        renderGoalsYear();
        setError('goals-error', '', [$('month-goal-input'), $('year-goal-input')]);
        L.open($('goals-panel'));
    }

    function saveGoals(ev) {
        ev.preventDefault();
        const mIn = $('month-goal-input'), yIn = $('year-goal-input');
        const mg = readHours(mIn), yg = readHours(yIn);
        if (Number.isNaN(mg) || mg > 744) { setError('goals-error', 'Enter a monthly goal between 0 and 744 hours.', [mIn]); return; }
        if (Number.isNaN(yg) || yg > 8784) { setError('goals-error', 'Enter a service year goal between 0 and 8784 hours.', [yIn]); return; }

        let next = { ...settings };
        const newStart = goalsCtx.startMonth;
        if (newStart !== settings.serviceYearStartMonth) {
            next.yearGoals = Store.remapYearGoals(settings.yearGoals, newStart);
            next.serviceYearStartMonth = newStart;
            medals = { ...medals, completedYears: Store.remapYearIds(medals.completedYears, settings.serviceYearStartMonth, newStart) };
        }
        const mk = D.toMonthKey(view.year, view.month);
        const nm = D.addMonths(view.year, view.month, 1);
        if (mg !== S.monthGoalHours(next, view.year, view.month) || $('month-goal-scope').value === 'only') {
            next.monthGoals = S.setEffectiveGoal(next.monthGoals, mk, D.toMonthKey(nm.year, nm.month), mg, next.monthGoal, $('month-goal-scope').value);
        }
        const sy = D.serviceYearFor(view.year, view.month, next.serviceYearStartMonth);
        const nextSyId = D.serviceYearFromStart(sy.startYear + 1, sy.startMonth).id;
        if (yg !== S.yearGoalHours(next, sy.id) || $('year-goal-scope').value === 'only') {
            next.yearGoals = S.setEffectiveGoal(next.yearGoals, sy.id, nextSyId, yg, next.yearGoal, $('year-goal-scope').value);
        }
        settings = Store.sanitizeSettings(next);
        const res = A.afterGoalChange(medals, db, settings, D.toDateKey(view.year, view.month, 1));
        medals = res.medals;
        persist(['settings', 'medals']);
        L.closeAll(); // back to the calendar, where the new goals are visible
        renderAll();
        announceAwards(res.awarded);
    }

    /* ================= Service History ================= */
    function statCell(label, value, cls) {
        const d = el('div', 'stat' + (cls ? ' ' + cls : ''));
        d.appendChild(el('span', 'stat-label', label));
        d.appendChild(el('span', 'stat-value', value));
        return d;
    }

    function progressBar(prog, label) {
        const wrap = el('div', 'progress');
        const track = el('div', 'track');
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-label', label);
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.setAttribute('aria-valuenow', String(Math.round(prog.barPercent)));
        const fill = el('div', 'fill');
        fill.style.width = `${prog.barPercent}%`;
        track.appendChild(fill);
        wrap.appendChild(track);
        return wrap;
    }

    function phaseBadge(phase, reached) {
        if (phase === 'current') return el('span', 'badge current', 'In Progress');
        if (phase === 'future') return el('span', 'badge', 'Upcoming');
        return el('span', 'badge' + (reached ? ' success' : ''), reached ? 'Completed ✓' : 'Completed');
    }

    function yearStatRows(ys, container) {
        container.appendChild(statCell('🎯 Target', ys.goalHours ? fmt(ys.goalMinutes) : 'Not set'));
        container.appendChild(statCell('⏱️ Completed', fmt(ys.minutes)));
        if (ys.goalHours) {
            if (ys.exceededBy > 0) container.appendChild(statCell('Exceeded by', fmt(ys.exceededBy), 'good'));
            else if (!ys.reached) container.appendChild(statCell('⏳ Remaining', fmt(ys.remaining)));
            else container.appendChild(statCell('⏳ Remaining', '0h', 'good'));
        }
        container.appendChild(statCell('👨🏽‍🏫 Studies', String(ys.studies)));
        if (ys.goalHours) container.appendChild(statCell('Progress', S.formatPercent(ys.percent, 1)));
    }

    function renderHistory() {
        const list = $('history-list');
        list.textContent = '';
        const h = S.serviceHistory(db, settings, today);
        if (!h.hasData) {
            const empty = el('div', 'empty');
            empty.appendChild(el('p', 'empty-title', 'No service history yet.'));
            empty.appendChild(el('p', 'empty-text', 'Your completed service years will appear here as you use the tracker.'));
            list.appendChild(empty);
        }
        for (const ys of h.years) {
            const card = el('button', 'history-card' + (ys.phase === 'current' ? ' is-current' : ''));
            card.type = 'button';
            const head = el('span', 'hc-head');
            const titles = el('span', 'hc-titles');
            titles.appendChild(el('span', 'hc-title', ys.sy.label));
            titles.appendChild(el('span', 'hc-range', D.formatServiceYearRange(ys.sy, false)));
            head.appendChild(titles);
            head.appendChild(phaseBadge(ys.phase, ys.reached));
            card.appendChild(head);
            const stats = el('span', 'stat-grid');
            yearStatRows(ys, stats);
            card.appendChild(stats);
            if (ys.goalHours) card.appendChild(progressBar(ys, `${ys.sy.label} progress`));
            if (ys.reached) card.appendChild(el('span', 'trophy-line', '🏆 Goal Completed'));
            card.setAttribute('aria-label', `${ys.sy.label}, ${D.formatServiceYearRange(ys.sy, false)}, ${fmt(ys.minutes)} completed` +
                (ys.goalHours ? ` of ${fmt(ys.goalMinutes)}` : '') + (ys.phase === 'current' ? ', in progress' : '') + '. Open details');
            card.addEventListener('click', () => openYearDetail(ys.sy.id));
            list.appendChild(card);
        }
    }

    function openHistory() {
        renderHistory();
        L.open($('history-panel'));
        $('history-panel').querySelector('.sheet-body').scrollTop = 0;
    }

    function openYearDetail(syId) {
        const sy = D.serviceYearFromId(syId);
        const d = S.serviceYearDetail(db, settings, sy, today);
        $('year-detail-title').textContent = sy.label;
        const body = $('year-detail-body');
        body.textContent = '';

        const summary = el('section', 'detail-summary');
        const head = el('div', 'hc-head');
        head.appendChild(el('span', 'hc-range', D.formatServiceYearRange(sy)));
        head.appendChild(phaseBadge(d.phase, d.reached));
        summary.appendChild(head);
        const stats = el('div', 'stat-grid wide');
        stats.appendChild(statCell('🎯 Target', d.goalHours ? fmt(d.goalMinutes) : 'Not set'));
        stats.appendChild(statCell('⏱️ Completed', fmt(d.minutes)));
        if (d.goalHours) {
            const diff = d.minutes - d.goalMinutes;
            stats.appendChild(statCell('Difference', (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff)), diff >= 0 ? 'good' : ''));
        }
        stats.appendChild(statCell('👨🏽‍🏫 Studies', String(d.studies)));
        if (d.goalHours) stats.appendChild(statCell('Progress', S.formatPercent(d.percent, 1)));
        summary.appendChild(stats);
        if (d.goalHours) summary.appendChild(progressBar(d, `${sy.label} progress`));
        if (d.reached) summary.appendChild(el('p', 'trophy-line', '🏆 Goal Completed'));
        body.appendChild(summary);

        body.appendChild(el('h3', 'group-title', 'By month'));
        const months = el('div', 'month-list');
        for (const m of d.months) {
            const row = el('button', 'month-row' + (m.phase === 'future' ? ' is-future' : '') + (m.phase === 'current' ? ' is-current' : ''));
            row.type = 'button';
            const name = el('span', 'mr-name', D.formatMonthYear(m.year, m.month));
            const val = el('span', 'mr-values');
            val.appendChild(el('span', 'mr-hours', fmt(m.minutes)));
            val.appendChild(el('span', 'mr-studies', `${m.studies} ${m.studies === 1 ? 'study' : 'studies'}`));
            row.appendChild(name);
            row.appendChild(val);
            const mark = el('span', 'mr-mark', m.reached ? '👍' : '');
            mark.setAttribute('aria-hidden', 'true');
            row.appendChild(mark);
            row.appendChild(el('span', 'mr-chev', '›'));
            row.setAttribute('aria-label', `${D.formatMonthYear(m.year, m.month)}: ${fmt(m.minutes)}, ${m.studies} studies${m.reached ? ', monthly goal reached' : ''}. Open in calendar`);
            row.addEventListener('click', () => {
                goToMonth(m.year, m.month);
                L.closeAll();
            });
            months.appendChild(row);
        }
        body.appendChild(months);
        body.appendChild(el('p', 'group-note', 'Tap a month to open it in the calendar.'));
        L.open($('year-detail-panel'));
        body.scrollTop = 0;
    }

    /* ================= Medals ================= */
    function renderMedals() {
        const body = $('medals-body');
        body.textContent = '';
        const { completedMonths, completedYears } = medals;
        if (!completedMonths.length && !completedYears.length) {
            const empty = el('div', 'empty');
            empty.appendChild(el('p', 'empty-title', 'No medals earned yet.'));
            empty.appendChild(el('p', 'empty-text', 'Reach a monthly goal to earn 👍, or a service year goal to earn 🏆.'));
            body.appendChild(empty);
            return;
        }
        const tally = el('div', 'medal-tally');
        const t1 = el('div', 'tally'); t1.append(el('span', 'tally-icon', '🏆'), el('span', 'tally-count', `×${completedYears.length}`), el('span', 'tally-label', 'Service year goals'));
        const t2 = el('div', 'tally'); t2.append(el('span', 'tally-icon', '👍'), el('span', 'tally-count', `×${completedMonths.length}`), el('span', 'tally-label', 'Monthly goals'));
        tally.append(t1, t2);
        body.appendChild(tally);

        if (completedYears.length) {
            body.appendChild(el('h3', 'group-title', 'Trophies'));
            const list = el('div', 'chip-list');
            [...completedYears].reverse().forEach(id => {
                const sy = D.serviceYearFromId(id);
                if (sy) list.appendChild(el('span', 'chip', `🏆 ${sy.label}`));
            });
            body.appendChild(list);
        }
        if (completedMonths.length) {
            body.appendChild(el('h3', 'group-title', 'Monthly medals'));
            // Group by service year, newest first.
            const groups = new Map();
            [...completedMonths].reverse().forEach(mk => {
                const p = D.parseMonthKey(mk);
                if (!p) return;
                const sy = D.serviceYearFor(p.year, p.month, settings.serviceYearStartMonth);
                if (!groups.has(sy.id)) groups.set(sy.id, { sy, months: [] });
                groups.get(sy.id).months.push(p);
            });
            for (const { sy, months } of groups.values()) {
                body.appendChild(el('p', 'medal-group-label', sy.label));
                const list = el('div', 'chip-list');
                months.forEach(p => list.appendChild(el('span', 'chip', `👍 ${D.formatMonthYear(p.year, p.month, true)}`)));
                body.appendChild(list);
            }
        }
    }

    /* ================= Theme ================= */
    function renderThemePanel() {
        const grid = $('preset-grid');
        grid.textContent = '';
        const active = settings.theme.preset;
        for (const [id, p] of Object.entries(Theme.PRESETS)) {
            const b = el('button', 'preset');
            b.type = 'button';
            b.setAttribute('aria-pressed', String(active === id));
            const sw = el('span', 'swatch');
            sw.style.background = p.background;
            const inner = el('span', 'swatch-card');
            inner.style.background = p.card;
            inner.style.borderColor = p.accent;
            const dot = el('span', 'swatch-dot');
            dot.style.background = p.accent;
            inner.appendChild(dot);
            sw.appendChild(inner);
            b.append(sw, el('span', 'preset-name', p.name));
            // Presets replace the palette (and any custom outline) but keep status colours.
            b.addEventListener('click', () => setTheme(withStatus({ preset: id }, settings.theme.status)));
            grid.appendChild(b);
        }
        const colors = Theme.colorsFor(settings.theme);
        document.querySelectorAll('.color-input[data-color]').forEach(inp => {
            inp.value = inp.dataset.color === 'border' ? Theme.effectiveBorder(settings.theme) : colors[inp.dataset.color];
        });
        const status = Theme.statusFor(settings.theme);
        document.querySelectorAll('.color-input[data-status]').forEach(inp => { inp.value = status[inp.dataset.status]; });
        renderThemeNotes(colors);
    }

    function renderThemeNotes(colors) {
        const custom = !!colors.border;
        $('border-auto-btn').setAttribute('aria-pressed', String(!custom));
        $('border-auto-btn').disabled = !custom;
        $('border-mode').textContent = custom
            ? 'Outlines use your colour. Tap Auto to match them to your cards and text again.'
            : 'Outlines are set automatically from your card and text colours.';
        const low = Theme.contrast(colors.text, colors.card) < 4.5;
        $('contrast-note').textContent = low
            ? 'Your text colour is hard to read on the card colour, so a readable colour is used instead.'
            : 'Secondary text and dimmed days are derived from your colours.';
        $('status-reset-btn').disabled = !settings.theme.status;
    }

    function withStatus(theme, status) {
        return status ? { ...theme, status } : theme;
    }

    let themeSaveTimer = null;
    function setTheme(theme, { rerenderPanel = true } = {}) {
        settings = { ...settings, theme };
        Theme.apply(theme);
        clearTimeout(themeSaveTimer);
        themeSaveTimer = setTimeout(() => persist(['settings']), 250);
        if (rerenderPanel) renderThemePanel();
    }

    function onColorInput(e) {
        const colors = { ...Theme.colorsFor(settings.theme), [e.target.dataset.color]: e.target.value };
        setTheme(withStatus({ preset: 'custom', colors }, settings.theme.status), { rerenderPanel: false });
        document.querySelectorAll('.preset').forEach(p => p.setAttribute('aria-pressed', 'false'));
        // While outlines are automatic, keep their picker showing the derived colour.
        if (!colors.border) $('color-border').value = Theme.effectiveBorder(settings.theme);
        renderThemeNotes(colors);
    }

    function onStatusInput(e) {
        const status = { ...Theme.statusFor(settings.theme), [e.target.dataset.status]: e.target.value };
        setTheme({ ...settings.theme, status }, { rerenderPanel: false });
        renderThemeNotes(Theme.colorsFor(settings.theme));
    }

    function resetBorder() {
        const colors = { ...Theme.colorsFor(settings.theme) };
        delete colors.border;
        setTheme(withStatus({ preset: 'custom', colors }, settings.theme.status));
    }

    function resetStatus() {
        const theme = { ...settings.theme };
        delete theme.status;
        setTheme(theme);
    }

    /* ================= Import / Export ================= */
    function renderDataSummary() {
        const keys = Object.keys(db).sort();
        const withService = keys.filter(k => S.hasActual(db[k]));
        $('data-summary').textContent = withService.length
            ? `On this device: ${withService.length} day${withService.length === 1 ? '' : 's'} of records since ${D.formatShortDate(withService[0])}.`
            : 'No service records on this device yet.';
    }

    function exportData() {
        const backup = Store.buildBackup(db, settings, medals);
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ServiceTimeTracker-backup-${D.todayKey()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Backup downloaded');
    }

    async function importFile(file) {
        let text;
        try { text = await file.text(); } catch (e) { showAlert('The file could not be read.'); return; }
        let parsed;
        try { parsed = Store.parseBackup(text); } catch (e) { showAlert(`Import failed: ${e.message}`); return; }
        const keys = Object.keys(parsed.database).sort();
        const days = keys.filter(k => S.hasActual(parsed.database[k])).length;
        const years = S.discoverServiceYears(parsed.database, parsed.settings.serviceYearStartMonth, today);
        const lines = [
            parsed.exportedAt ? `Backup from ${D.formatShortDate(D.dateToKey(new Date(parsed.exportedAt)))}.` : 'Backup file found.',
            `${days} day${days === 1 ? '' : 's'} of records` + (years.hasData ? ` across ${years.years.length} service year${years.years.length === 1 ? '' : 's'}.` : '.'),
            '',
            'Importing replaces all data on this device with this backup. Export a backup first if you might need the current data.'
        ];
        const ok = await showConfirm(lines.join('\n'), { okLabel: 'Replace Data', danger: true });
        if (!ok) return;
        db = parsed.database;
        settings = parsed.settings;
        medals = parsed.medals;
        persist(['db', 'settings', 'medals']);
        Theme.apply(settings.theme);
        renderWeekdays();
        renderAll();
        renderDataSummary();
        renderWeekStart();
        showAlert('Data imported successfully.' + (parsed.skipped ? ` ${parsed.skipped} invalid record${parsed.skipped === 1 ? ' was' : 's were'} skipped.` : ''));
    }

    /* ================= Menu, week start, sharing ================= */
    function renderWeekStart() {
        document.querySelectorAll('[data-week-start]').forEach(b => {
            b.setAttribute('aria-pressed', String(Number(b.dataset.weekStart) === settings.weekStartsOn));
        });
    }

    function setWeekStart(v) {
        if (settings.weekStartsOn === v) return;
        settings = { ...settings, weekStartsOn: v };
        persist(['settings']);
        renderWeekStart();
        renderWeekdays();
        renderCalendar();
    }

    async function shareApp() {
        const data = { title: 'Service Time Tracker', text: 'A simple app for tracking service time, studies and goals.', url: SHARE_URL };
        if (navigator.share) {
            try { await navigator.share(data); } catch (e) { /* cancelled */ }
            return;
        }
        try {
            await navigator.clipboard.writeText(SHARE_URL);
            showToast('Link copied to clipboard');
        } catch (e) {
            showAlert(`Share this link:\n${SHARE_URL}`);
        }
    }

    const panelOpeners = {
        'goals-panel': openGoals,
        'history-panel': openHistory,
        'medals-panel': () => { renderMedals(); L.open($('medals-panel')); },
        'theme-panel': () => { renderThemePanel(); L.open($('theme-panel')); },
        'data-panel': () => { renderDataSummary(); L.open($('data-panel')); }
    };

    /* ================= PWA ================= */
    function setupPwa() {
        const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
        let reloading = false;

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./service-worker.js').then(reg => {
                const offerUpdate = (worker) => {
                    showBanner('A new version is available.', 'Update', () => {
                        reloading = true;
                        worker.postMessage({ type: 'SKIP_WAITING' });
                    });
                };
                if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
                reg.addEventListener('updatefound', () => {
                    const w = reg.installing;
                    if (!w) return;
                    w.addEventListener('statechange', () => {
                        if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
                    });
                });
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') reg.update().catch(() => {});
                });
                // Versions <= 4.6 registered a daily reminder; it is no longer used.
                if (reg.periodicSync && reg.periodicSync.unregister) reg.periodicSync.unregister('check-reminder').catch(() => {});
            }).catch(err => console.warn('Service worker registration failed:', err));

            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (reloading) window.location.reload();
            });
        }

        const dismissed = (() => { try { return localStorage.getItem('sttInstallDismissed') === '1'; } catch (e) { return true; } })();
        const markDismissed = () => { try { localStorage.setItem('sttInstallDismissed', '1'); } catch (e) { /* ignore */ } };

        let deferredPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            if (dismissed || !$('app-banner').hidden) return;
            showBanner('Install Service Time Tracker for quick, offline access.', 'Install', async () => {
                hideBanner();
                deferredPrompt.prompt();
                try { await deferredPrompt.userChoice; } catch (err) { /* ignore */ }
                deferredPrompt = null;
            }, markDismissed);
        });
        window.addEventListener('appinstalled', () => { hideBanner(); markDismissed(); });

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const seenIos = (() => { try { return localStorage.getItem('hasSeenIosInstallPrompt') === 'true'; } catch (e) { return true; } })();
        if (isIOS && !standalone && !seenIos) {
            showBanner('To install: tap the Share icon, then “Add to Home Screen”.', null, null, () => {
                try { localStorage.setItem('hasSeenIosInstallPrompt', 'true'); } catch (e) { /* ignore */ }
            });
        }
    }

    /* ================= Events ================= */
    function bindEvents() {
        $('menu-btn').addEventListener('click', () => { renderWeekStart(); L.open($('menu')); });
        $('prev-month-btn').addEventListener('click', () => shiftMonth(-1));
        $('next-month-btn').addEventListener('click', () => shiftMonth(1));
        $('today-btn').addEventListener('click', goToToday);
        $('plan-mode-btn').addEventListener('click', () => setPlanning(!planning.on));
        $('plan-per-day-btn').addEventListener('click', () => setPlanScope('per-day'));
        $('plan-per-month-btn').addEventListener('click', () => setPlanScope('per-month'));
        $('clear-plans-btn').addEventListener('click', clearMonthPlans);
        $('calendar-grid').addEventListener('click', onDayClick);
        $('year-card').addEventListener('click', () => openYearDetail(currentServiceYear().id));

        $('entry-form').addEventListener('submit', saveEntry);
        $('plan-form').addEventListener('submit', savePlan);
        $('plan-clear-btn').addEventListener('click', () => applyPlan(0));
        $('goals-form').addEventListener('submit', saveGoals);
        $('sy-start-select').addEventListener('change', (e) => {
            goalsCtx.startMonth = Number(e.target.value);
            const sy = goalsServiceYear();
            const remapped = Store.remapYearGoals(settings.yearGoals, goalsCtx.startMonth);
            $('year-goal-input').value = String(S.yearGoalHours({ ...settings, yearGoals: remapped }, sy.id));
            renderGoalsYear();
        });

        document.querySelectorAll('[data-open]').forEach(btn => {
            btn.addEventListener('click', () => panelOpeners[btn.dataset.open]());
        });
        document.querySelectorAll('[data-week-start]').forEach(btn => {
            btn.addEventListener('click', () => setWeekStart(Number(btn.dataset.weekStart)));
        });
        $('share-app-btn').addEventListener('click', shareApp);
        document.querySelectorAll('.color-input[data-color]').forEach(inp => inp.addEventListener('input', onColorInput));
        document.querySelectorAll('.color-input[data-status]').forEach(inp => inp.addEventListener('input', onStatusInput));
        $('border-auto-btn').addEventListener('click', resetBorder);
        $('status-reset-btn').addEventListener('click', resetStatus);
        $('export-btn').addEventListener('click', exportData);
        $('import-btn').addEventListener('click', () => $('import-file-input').click());
        $('import-file-input').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (f) importFile(f);
        });

        $('app-banner-action').addEventListener('click', () => { const fn = bannerAction; if (fn) fn(); });
        $('app-banner-close').addEventListener('click', () => { const fn = bannerDismiss; hideBanner(); if (fn) fn(); });

        document.querySelectorAll('dialog').forEach(L.register);

        // Keyboard month navigation on the calendar screen.
        document.addEventListener('keydown', (e) => {
            if (L.top() || e.altKey || e.ctrlKey || e.metaKey) return;
            if (e.target.closest && e.target.closest('input, textarea, select')) return;
            if (e.key === 'PageUp') { e.preventDefault(); shiftMonth(-1); }
            if (e.key === 'PageDown') { e.preventDefault(); shiftMonth(1); }
        });

        // Keep "today" correct if the app stays open past midnight.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && D.todayKey() !== today) {
                today = D.todayKey();
                renderAll();
            }
        });
    }

    /* ================= Start ================= */
    Theme.apply(settings.theme);
    bindEvents();
    renderWeekdays();
    renderWeekStart();
    renderAll();
    setupPwa();
    if (loaded.corrupt) {
        showAlert('Some saved data on this device could not be read. It has been kept untouched in storage; please import your latest backup if anything is missing.');
    }

    // Test hook (read-only): lets automated checks inspect state without touching storage.
    window.STT.debug = { get state() { return { db, settings, medals, view: { ...view }, today }; } };
})();

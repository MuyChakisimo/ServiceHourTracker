/* Read-only calculations over the entries database.
 *
 * The database ({ "YYYY-MM-DD": { time, studies, notes, plannedTime } }) is the
 * single source of truth for service. Month totals, service-year totals and
 * Service History are always derived from it here; nothing in this file mutates
 * its inputs, so rendering can never change stored data or award medals.
 */
(function (root) {
    const STT = root.STT = root.STT || {};
    const D = STT.dates;

    /* ---------- Duration formatting ---------- */
    function formatDuration(minutes, compact = false) {
        const m = Math.max(0, Math.round(minutes || 0));
        const h = Math.floor(m / 60);
        const r = m % 60;
        const sep = compact ? '' : ' ';
        if (h && r) return `${h}h${sep}${r}m`;
        if (r) return `${r}m`;
        return `${h}h`;
    }

    function formatPercent(p, decimals = 0) {
        return `${(Math.round(p * 10 ** decimals) / 10 ** decimals).toFixed(decimals)}%`;
    }

    /* ---------- Entry helpers ---------- */
    function hasActual(entry) {
        return !!entry && ((entry.time || 0) > 0 || (entry.studies || 0) > 0 || !!(entry.notes && entry.notes.trim()));
    }

    /** Totals per month: { "YYYY-MM": { minutes, studies, planned, activeDays } }. */
    function buildMonthIndex(db) {
        const index = {};
        for (const key in db) {
            const e = db[key];
            if (!e) continue;
            const mk = key.slice(0, 7);
            const bucket = index[mk] || (index[mk] = { minutes: 0, studies: 0, planned: 0, activeDays: 0, hasActual: false });
            bucket.minutes += e.time || 0;
            bucket.studies += e.studies || 0;
            bucket.planned += e.plannedTime || 0;
            if ((e.time || 0) > 0) bucket.activeDays++;
            if (hasActual(e)) bucket.hasActual = true;
        }
        return index;
    }

    const EMPTY_MONTH = Object.freeze({ minutes: 0, studies: 0, planned: 0, activeDays: 0, hasActual: false });

    function monthTotals(index, year, month) {
        return index[D.toMonthKey(year, month)] || EMPTY_MONTH;
    }

    /** Sums strictly inside the service year's start and end month. */
    function serviceYearTotals(index, sy) {
        let minutes = 0, studies = 0;
        for (const { year, month } of D.serviceYearMonths(sy)) {
            const t = monthTotals(index, year, month);
            minutes += t.minutes;
            studies += t.studies;
        }
        return { minutes, studies };
    }

    /* ---------- Goals ----------
     * Goals are effective-dated. settings.monthGoals maps "YYYY-MM" -> hours and
     * settings.yearGoals maps a service-year id ("YYYY-MM" of its first month) ->
     * hours. A goal applies to its period and every later period until the next
     * explicit goal. Periods before any explicit goal use the base value
     * (settings.monthGoal / settings.yearGoal, i.e. the single global goal older
     * versions had). Setting a later period therefore never rewrites an earlier one.
     */
    function resolveEffective(map, key, base) {
        if (map && Object.prototype.hasOwnProperty.call(map, key)) return map[key];
        let bestKey = null;
        for (const k in map) {
            if (k < key && (bestKey === null || k > bestKey)) bestKey = k;
        }
        return bestKey === null ? base : map[bestKey];
    }

    function monthGoalHours(settings, year, month) {
        return resolveEffective(settings.monthGoals, D.toMonthKey(year, month), settings.monthGoal) || 0;
    }

    function yearGoalHours(settings, syId) {
        return resolveEffective(settings.yearGoals, syId, settings.yearGoal) || 0;
    }

    /**
     * Returns a new goals map with `value` set for `key`.
     * scope "forward": key and all later periods until the next explicit goal.
     * scope "only": just this period; the following period keeps its previous value.
     */
    function setEffectiveGoal(map, key, nextKey, value, base, scope) {
        const out = { ...(map || {}) };
        if (scope === 'only' && !Object.prototype.hasOwnProperty.call(out, nextKey)) {
            out[nextKey] = resolveEffective(map, nextKey, base);
        }
        out[key] = value;
        return out;
    }

    /* ---------- Progress ---------- */
    function progress(minutes, goalHours) {
        const goalMinutes = Math.max(0, goalHours || 0) * 60;
        const pct = goalMinutes > 0 ? (minutes / goalMinutes) * 100 : 0;
        return {
            minutes,
            goalHours: goalHours || 0,
            goalMinutes,
            percent: pct,
            barPercent: Math.min(100, Math.max(0, pct)),
            remaining: Math.max(0, goalMinutes - minutes),
            exceededBy: goalMinutes > 0 ? Math.max(0, minutes - goalMinutes) : 0,
            reached: goalMinutes > 0 && minutes >= goalMinutes
        };
    }

    /** Where a period sits relative to today: "past" | "current" | "future". */
    function periodPhase(startKey, endKey, today) {
        if (endKey < today) return 'past';
        if (startKey > today) return 'future';
        return 'current';
    }

    function monthSummary(db, settings, year, month, index = buildMonthIndex(db)) {
        const t = monthTotals(index, year, month);
        const goal = monthGoalHours(settings, year, month);
        return { year, month, key: D.toMonthKey(year, month), studies: t.studies, planned: t.planned, ...progress(t.minutes, goal) };
    }

    function serviceYearSummary(db, settings, sy, today, index = buildMonthIndex(db)) {
        const t = serviceYearTotals(index, sy);
        const goal = yearGoalHours(settings, sy.id);
        return {
            sy,
            studies: t.studies,
            phase: periodPhase(sy.startKey, sy.endKey, today),
            ...progress(t.minutes, goal)
        };
    }

    /* ---------- Service History ----------
     * Service years are discovered from months that hold actual service (time,
     * studies or notes). The range runs continuously from the earliest such year
     * to the later of the current year and the latest year with data, so a gap
     * year still shows as 0h rather than disappearing. Newest first.
     */
    function discoverServiceYears(db, startMonth, today) {
        const index = buildMonthIndex(db);
        const t = D.parseDateKey(today);
        const current = D.serviceYearFor(t.year, t.month, startMonth);
        let minStart = current.startYear, maxStart = current.startYear, any = false;
        for (const mk in index) {
            if (!index[mk].hasActual) continue;
            const p = D.parseMonthKey(mk);
            if (!p) continue;
            const sy = D.serviceYearFor(p.year, p.month, startMonth);
            any = true;
            if (sy.startYear < minStart) minStart = sy.startYear;
            if (sy.startYear > maxStart) maxStart = sy.startYear;
        }
        const years = [];
        for (let y = maxStart; y >= minStart; y--) years.push(D.serviceYearFromStart(y, startMonth));
        return { years, hasData: any, currentId: current.id };
    }

    function serviceHistory(db, settings, today) {
        const index = buildMonthIndex(db);
        const { years, hasData, currentId } = discoverServiceYears(db, settings.serviceYearStartMonth, today);
        return {
            hasData,
            currentId,
            years: years.map(sy => serviceYearSummary(db, settings, sy, today, index))
        };
    }

    function serviceYearDetail(db, settings, sy, today) {
        const index = buildMonthIndex(db);
        const summary = serviceYearSummary(db, settings, sy, today, index);
        const months = D.serviceYearMonths(sy).map(({ year, month }) => {
            const ms = monthSummary(db, settings, year, month, index);
            const start = D.toDateKey(year, month, 1);
            const end = D.toDateKey(year, month, D.daysInMonth(year, month));
            return { ...ms, phase: periodPhase(start, end, today) };
        });
        return { ...summary, months };
    }

    /* ---------- Day status ----------
     * complete: actual >= plan; under: some time but below plan;
     * missed: a past day with a plan and no time; planned: today/future plan not yet met.
     */
    function dayStatus(entry, key, today) {
        const plan = (entry && entry.plannedTime) || 0;
        if (plan <= 0) return null;
        const actual = (entry && entry.time) || 0;
        if (actual >= plan) return 'complete';
        if (key < today) return actual > 0 ? 'under' : 'missed';
        return actual > 0 ? 'under' : 'planned';
    }

    STT.stats = {
        formatDuration, formatPercent, hasActual, buildMonthIndex, monthTotals, serviceYearTotals,
        resolveEffective, monthGoalHours, yearGoalHours, setEffectiveGoal, progress, periodPhase,
        monthSummary, serviceYearSummary, discoverServiceYears, serviceHistory, serviceYearDetail, dayStatus
    };
})(typeof self !== 'undefined' ? self : globalThis);

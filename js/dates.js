/* Date helpers.
 *
 * Every persisted day is a local calendar date string "YYYY-MM-DD" and every
 * month is "YYYY-MM". These helpers never go through UTC (no toISOString), so
 * a key always means the day the user tapped, whatever their timezone.
 * Month numbers passed around in code are 0-based (JS convention).
 */
(function (root) {
    const STT = root.STT = root.STT || {};

    const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'];
    const MONTHS_SHORT = MONTHS_LONG.map(m => m.slice(0, 3));
    const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const WEEKDAYS_SHORT = WEEKDAYS_LONG.map(d => d.slice(0, 3));

    const pad2 = n => String(n).padStart(2, '0');

    function daysInMonth(year, month) {
        return new Date(year, month + 1, 0).getDate();
    }

    function toDateKey(year, month, day) {
        return `${year}-${pad2(month + 1)}-${pad2(day)}`;
    }

    function toMonthKey(year, month) {
        return `${year}-${pad2(month + 1)}`;
    }

    function dateToKey(date) {
        return toDateKey(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function todayKey(now = new Date()) {
        return dateToKey(now);
    }

    const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

    /** Returns {year, month, day} or null when the key is not a real calendar date. */
    function parseDateKey(key) {
        const m = DATE_KEY_RE.exec(key);
        if (!m) return null;
        const year = +m[1], month = +m[2] - 1, day = +m[3];
        if (month < 0 || month > 11 || day < 1 || day > daysInMonth(year, month)) return null;
        return { year, month, day };
    }

    function isValidDateKey(key) {
        return typeof key === 'string' && parseDateKey(key) !== null;
    }

    function parseMonthKey(key) {
        const m = /^(\d{4})-(\d{2})$/.exec(key);
        if (!m || +m[2] < 1 || +m[2] > 12) return null;
        return { year: +m[1], month: +m[2] - 1 };
    }

    /** Local-midnight Date for a key (for weekday lookups and formatting only). */
    function keyToDate(key) {
        const p = parseDateKey(key);
        return p ? new Date(p.year, p.month, p.day) : null;
    }

    function weekdayOf(key) {
        const p = parseDateKey(key);
        return new Date(p.year, p.month, p.day).getDay();
    }

    function addDays(key, n) {
        const p = parseDateKey(key);
        return dateToKey(new Date(p.year, p.month, p.day + n));
    }

    /** Month arithmetic on a {year, month} pair; never overflows like Date.setMonth(). */
    function addMonths(year, month, n) {
        const total = year * 12 + month + n;
        return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
    }

    function monthKeyOfDateKey(key) {
        return key.slice(0, 7);
    }

    /* ---------- Service year ----------
     * A service year is identified by the month key of its first month, e.g.
     * "2026-09" for Sep 1, 2026 – Aug 31, 2027. startMonth is 0-based.
     */
    function serviceYearFor(year, month, startMonth) {
        const startYear = month >= startMonth ? year : year - 1;
        return serviceYearFromStart(startYear, startMonth);
    }

    function serviceYearFromStart(startYear, startMonth) {
        const end = addMonths(startYear, startMonth, 11);
        return {
            id: toMonthKey(startYear, startMonth),
            startYear,
            startMonth,
            endYear: end.year,
            endMonth: end.month,
            startKey: toDateKey(startYear, startMonth, 1),
            endKey: toDateKey(end.year, end.month, daysInMonth(end.year, end.month)),
            label: serviceYearLabel(startYear, end.year)
        };
    }

    function serviceYearFromId(id) {
        const p = parseMonthKey(id);
        return p ? serviceYearFromStart(p.year, p.month) : null;
    }

    function serviceYearLabel(startYear, endYear) {
        if (startYear === endYear) return `Service Year ${startYear}`;
        return `Service Year ${String(startYear).slice(-2)}/${String(endYear).slice(-2)}`;
    }

    /** The 12 {year, month} pairs of a service year, in order. */
    function serviceYearMonths(sy) {
        const out = [];
        for (let i = 0; i < 12; i++) out.push(addMonths(sy.startYear, sy.startMonth, i));
        return out;
    }

    /* ---------- Calendar grid ----------
     * Full weeks covering the month, including adjacent-month days.
     * weekStartsOn: 0 = Sunday, 1 = Monday. Produces 4, 5 or 6 rows.
     */
    function buildMonthGrid(year, month, weekStartsOn) {
        const first = new Date(year, month, 1).getDay();
        const lead = (first - weekStartsOn + 7) % 7;
        const count = daysInMonth(year, month);
        const rows = Math.ceil((lead + count) / 7);
        const cells = [];
        for (let i = 0; i < rows * 7; i++) {
            const d = new Date(year, month, 1 - lead + i);
            cells.push({
                key: dateToKey(d),
                day: d.getDate(),
                weekday: d.getDay(),
                inMonth: d.getMonth() === month && d.getFullYear() === year
            });
        }
        return { rows, cells };
    }

    function weekdayHeaders(weekStartsOn) {
        const out = [];
        for (let i = 0; i < 7; i++) {
            const idx = (weekStartsOn + i) % 7;
            out.push({ short: WEEKDAYS_SHORT[idx], long: WEEKDAYS_LONG[idx] });
        }
        return out;
    }

    /* ---------- Formatting ---------- */
    function formatMonthYear(year, month, short = false) {
        return `${short ? MONTHS_SHORT[month] : MONTHS_LONG[month]} ${year}`;
    }

    function formatShortDate(key) {
        const p = parseDateKey(key);
        return `${MONTHS_SHORT[p.month]} ${p.day}, ${p.year}`;
    }

    function formatLongDate(key) {
        const p = parseDateKey(key);
        return `${WEEKDAYS_LONG[weekdayOf(key)]}, ${MONTHS_LONG[p.month]} ${p.day}`;
    }

    function formatServiceYearRange(sy, withDays = true) {
        if (!withDays) {
            return `${MONTHS_SHORT[sy.startMonth]} ${sy.startYear} – ${MONTHS_SHORT[sy.endMonth]} ${sy.endYear}`;
        }
        return `${formatShortDate(sy.startKey)} – ${formatShortDate(sy.endKey)}`;
    }

    STT.dates = {
        MONTHS_LONG, MONTHS_SHORT, WEEKDAYS_LONG, WEEKDAYS_SHORT,
        pad2, daysInMonth, toDateKey, toMonthKey, dateToKey, todayKey,
        parseDateKey, isValidDateKey, parseMonthKey, keyToDate, weekdayOf, addDays, addMonths,
        monthKeyOfDateKey, serviceYearFor, serviceYearFromStart, serviceYearFromId,
        serviceYearLabel, serviceYearMonths, buildMonthGrid, weekdayHeaders,
        formatMonthYear, formatShortDate, formatLongDate, formatServiceYearRange
    };
})(typeof self !== 'undefined' ? self : globalThis);

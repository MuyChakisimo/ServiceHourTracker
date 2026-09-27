/* Medals and trophies.
 *
 * Kept separate from display: the Home cards and Service History only *compute*
 * whether a goal is reached (STT.stats.progress). Stored medals change only here,
 * and only in response to the user saving an entry or a goal, and only for the
 * month / service year that the change belongs to.
 */
(function (root) {
    const STT = root.STT = root.STT || {};
    const D = STT.dates, S = STT.stats;

    function periodsFor(dateKey, settings) {
        const p = D.parseDateKey(dateKey);
        return {
            year: p.year, month: p.month,
            monthKey: D.toMonthKey(p.year, p.month),
            sy: D.serviceYearFor(p.year, p.month, settings.serviceYearStartMonth)
        };
    }

    function reachedFor(db, settings, per) {
        const index = S.buildMonthIndex(db);
        const today = '9999-12-31'; // phase is irrelevant here
        return {
            month: S.monthSummary(db, settings, per.year, per.month, index).reached,
            year: S.serviceYearSummary(db, settings, per.sy, today, index).reached
        };
    }

    function withItem(list, item) { return list.includes(item) ? list : [...list, item].sort(); }
    function withoutItem(list, item) { return list.filter(x => x !== item); }

    /**
     * Re-evaluates the periods touched by an entry change.
     * Awards a medal when the goal is now reached. Removes one only when this very
     * edit took the total from reached to not reached (e.g. correcting a typo), so
     * editing an unrelated day never strips an old medal.
     * Returns { medals, awarded: [{type, label}] } without mutating the input.
     */
    function afterEntryChange(medals, dbBefore, dbAfter, settings, dateKey) {
        const per = periodsFor(dateKey, settings);
        const before = reachedFor(dbBefore, settings, per);
        const after = reachedFor(dbAfter, settings, per);
        return apply(medals, per, before, after);
    }

    /** After goals change: award newly reached periods (never removes). */
    function afterGoalChange(medals, db, settings, dateKey) {
        const per = periodsFor(dateKey, settings);
        const after = reachedFor(db, settings, per);
        return apply(medals, per, { month: false, year: false }, after);
    }

    function apply(medals, per, before, after) {
        let months = medals.completedMonths, years = medals.completedYears;
        const awarded = [];
        if (after.month && !months.includes(per.monthKey)) {
            months = withItem(months, per.monthKey);
            awarded.push({ type: 'month', label: D.formatMonthYear(per.year, per.month) });
        } else if (before.month && !after.month) {
            months = withoutItem(months, per.monthKey);
        }
        if (after.year && !years.includes(per.sy.id)) {
            years = withItem(years, per.sy.id);
            awarded.push({ type: 'year', label: per.sy.label });
        } else if (before.year && !after.year) {
            years = withoutItem(years, per.sy.id);
        }
        return { medals: { ...medals, completedMonths: months, completedYears: years }, awarded };
    }

    STT.achievements = { afterEntryChange, afterGoalChange };
})(typeof self !== 'undefined' ? self : globalThis);

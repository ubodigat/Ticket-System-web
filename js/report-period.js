// Calendar dates are local to the reporting browser; upper bounds are exclusive.
const calendarDate = text => {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(text).trim());
    if (!match) return null;
    const [, day, month, year] = match.map(Number);
    if (year < 1970 || year > 9998) return null;
    const value = new Date(year, month - 1, day);
    return value.getFullYear() === year && value.getMonth() === month - 1 && value.getDate() === day ? value : null;
};
export function reportPeriod(mode, from = '', to = '', now = new Date()) {
    let since, until = now.getTime() + 1;
    if (mode === 'custom') {
        const start = calendarDate(from), end = calendarDate(to);
        if (!start || !end || start > end) return null;
        since = start.getTime();
        until = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime();
    } else if (mode === 'month') since = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    else if (mode === 'previous-month') {
        since = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
        until = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    } else if (mode === 'year') since = new Date(now.getFullYear(), 0, 1).getTime();
    else if (mode === 'all') since = 0;
    else if (['7', '30', '90', '365'].includes(mode)) since = now.getTime() - Number(mode) * 86400000;
    else return null;
    return { since, until };
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseMonthRange(month) {
    const value = String(month || '').trim();
    const match = value.match(MONTH_PATTERN);
    if (!match) return null;

    const year = Number(match[1]);
    const monthIndex = Number(match[2]);
    const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
    return {
        month: value,
        fromDate: `${value}-01`,
        toDate: `${value}-${String(lastDay).padStart(2, '0')}`,
        daysInMonth: lastDay,
        timezone: 'Asia/Bangkok'
    };
}

export function currentMonthInBangkok(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit'
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}`;
}

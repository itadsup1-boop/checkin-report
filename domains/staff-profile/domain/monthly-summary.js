const number = value => Number(value || 0);

export function buildAttendanceSummary({ schedules, checkins, penalties }) {
    const workingSchedules = schedules.filter(row => row.shift_type !== 'OFF');
    const checkedDates = new Set(checkins.map(row => row.date));
    const lateDates = new Set(
        penalties.filter(row => row.violation_type === 'LATE').map(row => row.date)
    );
    const absentDates = new Set(
        penalties.filter(row => row.violation_type === 'UNAUTHORIZED_ABSENT').map(row => row.date)
    );
    const scheduledDates = new Set(workingSchedules.map(row => row.date));

    return {
        scheduledDays: scheduledDates.size,
        checkedInDays: checkedDates.size,
        onTimeDays: [...checkedDates].filter(date => !lateDates.has(date)).length,
        lateDays: lateDates.size,
        absentDays: absentDates.size,
        penaltyTotal: penalties.reduce((total, row) => total + number(row.amount), 0)
    };
}

export function buildKpiSummary(reports) {
    const achieved = reports.filter(row => number(row.kpi_actual) >= number(row.kpi_required));
    const late = reports.filter(row => String(row.status || '').toUpperCase().includes('MUON'));
    const actualTotal = reports.reduce((total, row) => total + number(row.kpi_actual), 0);
    const requiredTotal = reports.reduce((total, row) => total + number(row.kpi_required), 0);

    return {
        reportedDays: new Set(reports.map(row => row.report_date)).size,
        achievedDays: achieved.length,
        missedTargetDays: Math.max(0, reports.length - achieved.length),
        lateDays: late.length,
        actualTotal,
        requiredTotal,
        completionRate: requiredTotal > 0 ? Math.round((actualTotal / requiredTotal) * 100) : 0
    };
}

export function groupMonthDays({ schedules, checkins, leaves, penalties, reports }) {
    const days = new Map();
    const ensure = date => {
        if (!days.has(date)) {
            days.set(date, { date, schedules: [], checkins: [], leaves: [], penalties: [], reports: [] });
        }
        return days.get(date);
    };

    for (const row of schedules) ensure(row.date).schedules.push(row);
    for (const row of checkins) ensure(row.date).checkins.push(row);
    for (const row of leaves) ensure(row.date).leaves.push(row);
    for (const row of penalties) ensure(row.date).penalties.push(row);
    for (const row of reports) ensure(row.report_date).reports.push(row);
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

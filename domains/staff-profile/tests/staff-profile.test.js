import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMonthRange } from '../domain/month-range.js';
import { buildAttendanceSummary, buildKpiSummary, groupMonthDays } from '../domain/monthly-summary.js';
import { createGetEmployeeMonthlyOverview } from '../application/get-employee-monthly-overview.js';

test('khoảng tháng hợp lệ và xử lý đúng năm nhuận', () => {
    assert.deepEqual(parseMonthRange('2028-02'), {
        month: '2028-02', fromDate: '2028-02-01', toDate: '2028-02-29',
        daysInMonth: 29, timezone: 'Asia/Bangkok'
    });
    for (const invalid of ['', '2026-2', '2026-13', 'abc']) assert.equal(parseMonthRange(invalid), null);
});

test('summary chấm công không đếm trùng nhiều lượt cùng ngày', () => {
    const summary = buildAttendanceSummary({
        schedules: [{ date: '2026-08-01', shift_type: 'CA_SANG' }, { date: '2026-08-02', shift_type: 'OFF' }],
        checkins: [{ date: '2026-08-01' }, { date: '2026-08-01' }],
        penalties: [{ date: '2026-08-01', violation_type: 'LATE', amount: 50000 }]
    });
    assert.deepEqual(summary, { scheduledDays: 1, checkedInDays: 1, onTimeDays: 0, lateDays: 1, absentDays: 0, penaltyTotal: 50000 });
});

test('summary KPI cộng đúng thực tế, chỉ tiêu và tỷ lệ', () => {
    assert.deepEqual(buildKpiSummary([
        { report_date: '2026-08-01', kpi_actual: 40, kpi_required: 40, status: 'DAT_KPI' },
        { report_date: '2026-08-02', kpi_actual: 20, kpi_required: 40, status: 'BAO_CAO_MUON' }
    ]), { reportedDays: 2, achievedDays: 1, missedTargetDays: 1, lateDays: 1, actualTotal: 60, requiredTotal: 80, completionRate: 75 });
});

test('gom dữ liệu của nhiều nghiệp vụ về đúng ngày', () => {
    const days = groupMonthDays({
        schedules: [{ id: 's', date: '2026-08-03' }], checkins: [{ id: 'c', date: '2026-08-03' }],
        leaves: [], penalties: [], reports: [{ id: 'r', report_date: '2026-08-03' }]
    });
    assert.equal(days.length, 1);
    assert.equal(days[0].schedules[0].id, 's');
    assert.equal(days[0].reports[0].id, 'r');
});

test('use case chặn nhóm ngoài quyền và chỉ bật KPI theo membership', async () => {
    let queried = false;
    const getOverview = createGetEmployeeMonthlyOverview({ repository: {
        async findEmployeeWithGroups() {
            queried = true;
            return {
                id: 'employee', is_exempt_checkin: false,
                groups: [{ group_uuid: 'uuid', telegram_group_id: '-100', bot_role: 'report', membership_status: 'ACTIVE', need_report: true, current_kpi_target: 40 }]
            };
        },
        async findAttendanceRows() { return { schedules: [], checkins: [], leaves: [], penalties: [] }; },
        async findLatestKpiReports() { return []; }
    } });
    const denied = await getOverview({ employeeId: 'employee', month: '2026-08', selectedGroupId: '-100', auth: { isSuperAdmin: false, allowedGroupIds: ['-200'] } });
    assert.equal(denied.status, 403);
    assert.equal(queried, false);

    const allowed = await getOverview({ employeeId: 'employee', month: '2026-08', selectedGroupId: '-100', auth: { isSuperAdmin: false, allowedGroupIds: ['-100'] } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.data.kpi.enabled, true);
});

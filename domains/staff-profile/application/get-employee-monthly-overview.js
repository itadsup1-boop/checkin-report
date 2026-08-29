import { buildAttendanceSummary, buildKpiSummary, groupMonthDays } from '../domain/monthly-summary.js';
import { currentMonthInBangkok, parseMonthRange } from '../domain/month-range.js';

export function createGetEmployeeMonthlyOverview({ repository }) {
    return async function getEmployeeMonthlyOverview({ employeeId, month, selectedGroupId, auth }) {
        const period = parseMonthRange(month || currentMonthInBangkok());
        if (!period) return { status: 400, message: 'Tháng phải có định dạng YYYY-MM.' };

        const requestedGroup = selectedGroupId && selectedGroupId !== 'ALL' ? String(selectedGroupId) : null;
        if (requestedGroup && !auth.isSuperAdmin && !auth.allowedGroupIds.includes(requestedGroup)) {
            return { status: 403, message: 'Bạn không có quyền xem nhóm này.' };
        }

        const allowedGroupIds = auth.isSuperAdmin ? null : auth.allowedGroupIds;
        const employee = await repository.findEmployeeWithGroups({ employeeId, allowedGroupIds, selectedGroupId: requestedGroup });
        if (!employee) return { status: 404, message: 'Không tìm thấy nhân viên trong phạm vi quản lý.' };

        const employeeIds = employee.employee_ids || [employee.id];
        const groupUuids = employee.groups.map(group => group.group_uuid);
        const attendanceRows = await repository.findAttendanceRows({
            employeeIds, groupUuids, fromDate: period.fromDate, toDate: period.toDate
        });
        const kpiGroups = employee.groups.filter(group =>
            ['report', 'report_tour'].includes(group.bot_role)
            && group.membership_status === 'ACTIVE'
            && group.need_report === true
            && Number(group.current_kpi_target || 0) > 0
        );
        const reports = await repository.findLatestKpiReports({
            employeeIds,
            telegramGroupIds: kpiGroups.map(group => group.telegram_group_id),
            fromDate: period.fromDate,
            toDate: period.toDate
        });

        return {
            status: 200,
            data: {
                employee,
                period,
                attendance: {
                    enabled: !employee.is_exempt_checkin,
                    summary: buildAttendanceSummary(attendanceRows),
                    ...attendanceRows
                },
                kpi: {
                    enabled: kpiGroups.length > 0,
                    groups: kpiGroups,
                    summary: buildKpiSummary(reports),
                    reports
                },
                days: groupMonthDays({ ...attendanceRows, reports })
            }
        };
    };
}

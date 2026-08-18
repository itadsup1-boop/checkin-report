/**
 * Use case: số liệu cho bảng điều khiển chấm công của Web Admin.
 *
 * Chỉ đọc. Xem được một nhóm hoặc tất cả (`group_id = 'ALL'` hoặc để trống).
 */

import { getTodayVN, getIsoWeekRangeVN } from '../domain/vn-time.js';
import { attendanceStatus, formatCheckInTime } from '../domain/timekeep-rules.js';

const EMPTY_STATS = {
    total_scheduled_today: 0, total_checked_in_today: 0,
    total_absent_today: 0, total_not_checked_yet: 0,
    weekly_late_count: 0, weekly_on_time_count: 0,
    weekly_total_checkins: 0, weekly_punctual_rate: 0,
    weekly_penalty_total: 0
};

export function createBuildAttendanceDashboard({ repository }) {
    return async function buildAttendanceDashboard(groupIdParam) {
        const groups = await repository.listGroups();
        if (groups.length === 0) {
            return { ok: true, payload: { groups: [], group: null, today: getTodayVN(), employees: [], stats: EMPTY_STATS } };
        }

        const allGroups = !groupIdParam || groupIdParam === 'ALL';
        // Web Admin có chỗ gửi id nội bộ, có chỗ gửi id Telegram — chấp nhận cả hai.
        const targetGroup = allGroups ? null : groups.find(g =>
            String(g.id) === String(groupIdParam) || String(g.telegram_group_id) === String(groupIdParam));

        if (!allGroups && !targetGroup) {
            return { ok: false, status: 404, error: 'Không tìm thấy nhóm đã chọn.' };
        }

        const today = getTodayVN();
        const { start: weekStart, end: weekEnd } = getIsoWeekRangeVN();

        const rows = await repository.listEmployeesOfDay(targetGroup?.id || null, today);
        const employees = rows.map(row => ({
            user_id: row.user_id,
            full_name: row.full_name,
            telegram_id: row.telegram_id,
            role: row.role,
            shift_type: row.shift_type,
            check_in_time: formatCheckInTime(row.check_in_time),
            checkin_status: row.checkin_status,
            late_minutes: row.late_minutes,
            penalty_amount: row.penalty_amount,
            status: attendanceStatus({
                hasSchedule: row.schedule_id !== null,
                shiftType: row.shift_type,
                hasCheckIn: row.checkin_id !== null,
                lateMinutes: Number(row.late_minutes) || 0
            })
        }));

        const weekly = await repository.weeklyStats(targetGroup?.id || null, weekStart, weekEnd);
        const totalCheckins = parseInt(weekly.total_checkins) || 0;
        const weeklyLateCount = parseInt(weekly.late_count) || 0;
        const weeklyOnTimeCount = totalCheckins - weeklyLateCount;
        // Làm tròn tới 0,1% — hiển thị 98,7% chứ không phải 98,6666…
        const weeklyPunctualRate = totalCheckins > 0
            ? Math.round((weeklyOnTimeCount / totalCheckins) * 1000) / 10
            : 0;

        const scheduledToday = employees.filter(e => e.shift_type && e.shift_type !== 'OFF').length;
        const checkedInToday = employees.filter(e => e.check_in_time !== null).length;

        return {
            ok: true,
            payload: {
                groups,
                group: targetGroup,
                today,
                week: { start: weekStart, end: weekEnd },
                employees,
                stats: {
                    total_scheduled_today: scheduledToday,
                    total_checked_in_today: checkedInToday,
                    total_absent_today: Math.max(0, scheduledToday - checkedInToday),
                    total_not_checked_yet: employees.filter(e => e.status === 'NOT_CHECKED_IN').length,
                    weekly_late_count: weeklyLateCount,
                    weekly_on_time_count: weeklyOnTimeCount,
                    weekly_total_checkins: totalCheckins,
                    weekly_punctual_rate: weeklyPunctualRate,
                    weekly_penalty_total: parseInt(weekly.penalty_total) || 0
                }
            }
        };
    };
}

export { EMPTY_STATS };

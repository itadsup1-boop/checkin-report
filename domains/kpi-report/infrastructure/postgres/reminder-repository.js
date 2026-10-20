/**
 * SQL của cron nhắc/phạt: danh sách nhóm role `report` cần quét, nhân viên phải
 * nộp báo cáo, và ba nguồn "được miễn" (đã nộp / nghỉ theo lịch / xin nghỉ phép).
 */

export function createReminderRepository({ pool }) {
    /** Nhóm role `report` đang hoạt động, kèm cấu hình giờ nhắc/mức phạt. Không áp dụng report_tour. */
    async function findActiveReportGroups() {
        const result = await pool.query(`
            SELECT tg.telegram_group_id, tg.group_name, gs.remind_time_1, gs.deadline_time, gs.penalty_missing_report
            FROM telegram_groups tg
            LEFT JOIN group_settings gs ON tg.telegram_group_id = gs.telegram_group_id
            WHERE tg.is_active = true
              AND tg.bot_role = 'report'
              AND COALESCE(tg.is_deleted, false) = false
        `);
        return result.rows;
    }

    /** Nhân viên phải nộp báo cáo trong nhóm: đang hoạt động, chưa bị tạm dừng, có chỉ tiêu, không phải quản lý/admin. */
    async function findEmployeesNeedingReport(groupId) {
        const result = await pool.query(`
            SELECT e.full_name, e.telegram_id, e.employee_code, e.id, m.current_kpi_target
            FROM employee_group_memberships m
            JOIN employees e ON e.id = m.employee_id
            WHERE e.is_active = true
              AND e.telegram_id IS NOT NULL
              AND m.telegram_group_id = $1
              AND m.status = 'ACTIVE'
              AND m.need_report = true
              AND COALESCE(m.current_kpi_target, 0) > 0
              AND LOWER(e.role) NOT IN ('quản lý', 'quản lý kho', 'admin')
        `, [groupId]);
        return result.rows;
    }

    async function findReportedTelegramIds(groupId, dateStr) {
        const result = await pool.query(`
            SELECT e.telegram_id FROM daily_reports dr
            JOIN employees e ON dr.employee_id = e.id
            WHERE dr.report_date = $1
              AND dr.telegram_group_id = $2
        `, [dateStr, groupId]);
        return result.rows.map(row => row.telegram_id);
    }

    async function findOffDutyTelegramIds(dateStr) {
        const result = await pool.query(`
            SELECT e.telegram_id FROM tk_schedules s
            JOIN employees e ON s.user_id = e.id
            WHERE s.date = $1 AND UPPER(s.shift_type) = 'OFF'
        `, [dateStr]);
        return result.rows.map(row => row.telegram_id);
    }

    async function findOnLeaveTelegramIds(dateStr) {
        const result = await pool.query(`
            SELECT e.telegram_id FROM tk_leave_requests l
            JOIN employees e ON l.user_id = e.id
            WHERE l.date = $1 AND l.status IN ('approved', 'pending')
        `, [dateStr]);
        return result.rows.map(row => row.telegram_id);
    }

    return {
        findActiveReportGroups,
        findEmployeesNeedingReport,
        findReportedTelegramIds,
        findOffDutyTelegramIds,
        findOnLeaveTelegramIds
    };
}

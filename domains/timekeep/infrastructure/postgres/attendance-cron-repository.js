/**
 * SQL của cron chấm công mỗi phút: nhắc trước ca, báo đi muộn, tính phạt từ
 * check-in đầu tiên trong ngày.
 */
export function createAttendanceCronRepository({ pool }) {
    async function findTimekeepGroupsWithShiftTimes() {
        const result = await pool.query(`
            SELECT g.id AS group_uuid, g.telegram_group_id, g.group_name,
                   COALESCE(gs.shift_1_time, '08:00:00') AS shift_1_time,
                   COALESCE(gs.shift_2_time, '13:30:00') AS shift_2_time
            FROM telegram_groups g
            LEFT JOIN group_settings gs ON g.telegram_group_id = gs.telegram_group_id
            WHERE g.bot_role = 'timekeep'
              AND g.is_active = true
              AND COALESCE(g.is_deleted, false) = false
        `);
        return result.rows;
    }

    async function findUncheckedForShift({ groupUuid, date, shiftTypes, telegramGroupId }) {
        const result = await pool.query(`
            SELECT u.id AS user_id, u.full_name
            FROM employees u
            JOIN tk_schedules s ON u.id = s.user_id AND s.date = $2
            LEFT JOIN employee_group_memberships gm
              ON gm.employee_id = u.id AND gm.telegram_group_id = $4
            WHERE u.group_id = $1
              AND COALESCE(u.is_exempt_checkin, false) = false
              AND COALESCE(u.is_active, true) = true
              AND COALESCE(gm.status, 'ACTIVE') = 'ACTIVE'
              AND s.shift_type = ANY($3)
              AND NOT EXISTS (SELECT 1 FROM tk_check_ins c WHERE c.user_id = u.id AND c.date = $2)
              AND NOT EXISTS (
                  SELECT 1 FROM tk_attendance_daily_status ds
                  WHERE ds.group_id = $1 AND ds.user_id = u.id AND ds.date = $2
                    AND (ds.reminder_sent_at IS NOT NULL OR ds.finalized_at IS NOT NULL)
              )
            ORDER BY u.full_name ASC
        `, [groupUuid, date, shiftTypes, String(telegramGroupId)]);
        return result.rows;
    }

    async function markReminderSent(groupUuid, userId, date) {
        await pool.query(`
            INSERT INTO tk_attendance_daily_status (group_id, user_id, date, reminder_sent_at, updated_at)
            VALUES ($1, $2, $3, NOW(), NOW())
            ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                reminder_sent_at = COALESCE(tk_attendance_daily_status.reminder_sent_at, NOW()),
                updated_at = NOW()
        `, [groupUuid, userId, date]);
    }

    async function findLateForShift({ groupUuid, date, shiftTypes, telegramGroupId }) {
        const result = await pool.query(`
            SELECT u.id AS user_id, u.full_name
            FROM employees u
            JOIN tk_schedules s ON u.id = s.user_id AND s.date = $2
            LEFT JOIN employee_group_memberships gm
              ON gm.employee_id = u.id AND gm.telegram_group_id = $4
            WHERE u.group_id = $1
              AND COALESCE(u.is_exempt_checkin, false) = false
              AND COALESCE(u.is_active, true) = true
              AND COALESCE(gm.status, 'ACTIVE') = 'ACTIVE'
              AND s.shift_type = ANY($3)
              AND NOT EXISTS (SELECT 1 FROM tk_check_ins c WHERE c.user_id = u.id AND c.date = $2)
              AND NOT EXISTS (
                  SELECT 1 FROM tk_attendance_daily_status ds
                  WHERE ds.group_id = $1 AND ds.user_id = u.id AND ds.date = $2
                    AND (ds.late_warning_sent_at IS NOT NULL OR ds.finalized_at IS NOT NULL)
              )
            ORDER BY u.full_name ASC
        `, [groupUuid, date, shiftTypes, String(telegramGroupId)]);
        return result.rows;
    }

    async function markLateWarningSent(groupUuid, userId, date) {
        await pool.query(`
            INSERT INTO tk_attendance_daily_status (group_id, user_id, date, result, late_warning_sent_at, updated_at)
            VALUES ($1, $2, $3, 'LATE_NOTIFIED', NOW(), NOW())
            ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                result = CASE WHEN tk_attendance_daily_status.finalized_at IS NULL THEN 'LATE_NOTIFIED' ELSE tk_attendance_daily_status.result END,
                late_warning_sent_at = COALESCE(tk_attendance_daily_status.late_warning_sent_at, NOW()),
                updated_at = NOW()
        `, [groupUuid, userId, date]);
    }

    /** Check-in đầu tiên của mỗi người hôm nay, kèm ca + giờ bắt đầu ca — để tính đi muộn. */
    async function findFirstCheckInsOfDay(date) {
        const result = await pool.query(`
            SELECT DISTINCT ON (c.user_id)
                   c.id, c.group_id, c.user_id, c.date::text, c.check_in_time,
                   u.full_name, g.telegram_group_id,
                   s.shift_type, gs.shift_1_time, gs.shift_2_time
            FROM tk_check_ins c
            JOIN employees u ON c.user_id = u.id
            JOIN telegram_groups g ON c.group_id = g.id
            LEFT JOIN tk_schedules s ON c.user_id = s.user_id AND c.date = s.date
            LEFT JOIN group_settings gs ON g.telegram_group_id = gs.telegram_group_id
            LEFT JOIN employee_group_memberships gm
              ON gm.employee_id = u.id AND gm.telegram_group_id = g.telegram_group_id
            WHERE c.date = $1
              AND COALESCE(u.is_exempt_checkin, false) = false
              AND COALESCE(u.is_active, true) = true
              AND COALESCE(gm.status, 'ACTIVE') = 'ACTIVE'
              AND NOT EXISTS (
                  SELECT 1 FROM tk_attendance_daily_status ds
                  WHERE ds.group_id = c.group_id AND ds.user_id = c.user_id AND ds.date = c.date
                    AND ds.finalized_at IS NOT NULL
              )
            ORDER BY c.user_id, c.check_in_time ASC
        `, [date]);
        return result.rows;
    }

    async function findLatePenaltyCountInMonth(userId, month, year) {
        const result = await pool.query(
            `SELECT COUNT(*) as count FROM tk_penalties
             WHERE user_id = $1 AND violation_type = 'LATE'
               AND EXTRACT(MONTH FROM date) = $2 AND EXTRACT(YEAR FROM date) = $3`,
            [userId, month, year]
        );
        return parseInt(result.rows[0].count) || 0;
    }

    async function findExistingLatePenalty(userId, date) {
        const result = await pool.query(
            `SELECT id FROM tk_penalties WHERE user_id = $1 AND date = $2 AND violation_type = 'LATE'`,
            [userId, date]
        );
        return result.rows[0] || null;
    }

    /** Kèm `late_minutes` đã báo trước — dùng để so với số phút muộn thực tế
     * (đến đúng trong hạn đã báo thì miễn hẳn, vượt hạn mới chỉ giảm 50%). */
    async function findApprovedLateLeaveRequest(userId, date) {
        const result = await pool.query(
            `SELECT id, late_minutes FROM tk_leave_requests
             WHERE user_id = $1 AND date = $2 AND request_type = 'LATE' AND status = 'APPROVED'
             LIMIT 1`,
            [userId, date]
        );
        return result.rows[0] || null;
    }

    async function insertLatePenalty({ groupId, userId, date, lateMinutes, amount, reason }) {
        await pool.query(
            `INSERT INTO tk_penalties (group_id, user_id, date, violation_type, late_minutes, amount, reason, is_paid)
             VALUES ($1, $2, $3, 'LATE', $4, $5, $6, false)`,
            [groupId, userId, date, lateMinutes, amount, reason]
        );
    }

    async function upsertAttendanceResult(groupId, userId, date, result) {
        await pool.query(`
            INSERT INTO tk_attendance_daily_status (group_id, user_id, date, result, finalized_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                result = $4, finalized_at = NOW(), updated_at = NOW()
        `, [groupId, userId, date, result]);
    }

    return {
        findTimekeepGroupsWithShiftTimes,
        findUncheckedForShift, markReminderSent,
        findLateForShift, markLateWarningSent,
        findFirstCheckInsOfDay,
        findLatePenaltyCountInMonth, findExistingLatePenalty, findApprovedLateLeaveRequest,
        insertLatePenalty, upsertAttendanceResult
    };
}

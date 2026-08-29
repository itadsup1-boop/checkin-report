/**
 * SQL của phạt chấm công: vắng không phép, nghỉ đột xuất, nghỉ liên tiếp, và
 * thông báo vắng chưa gửi.
 *
 * Mọi hàm nhận `db` là pool HOẶC client của một transaction đang mở (một số nơi
 * gọi lồng trong transaction của `leave-request-service.js`) — không tự ý BEGIN/
 * COMMIT ở đây.
 */

export function createPenaltyRepository() {
    async function findAbsenceCandidates(db, { date, workingShifts, leaveRequestTypes, requireScheduleBeforeShift, groupId, userId }) {
        const result = await db.query(
            `SELECT s.group_id,
                    s.user_id,
                    s.date::text AS date,
                    e.full_name,
                    g.telegram_group_id,
                    g.group_name
             FROM tk_schedules s
             JOIN employees e ON e.id = s.user_id
             JOIN telegram_groups g ON g.id = s.group_id
             LEFT JOIN group_settings gs ON gs.telegram_group_id = g.telegram_group_id
             LEFT JOIN employee_group_memberships gm
               ON gm.employee_id = e.id
              AND gm.telegram_group_id = g.telegram_group_id
             WHERE s.date = $1::date
               AND s.shift_type = ANY($2::text[])
               AND s.created_at <= (
                   ($1::date + CASE
                       WHEN $4::boolean AND s.shift_type IN ('CA_1', 'CA_SANG', 'FULL_DAY')
                           THEN COALESCE(NULLIF(gs.shift_1_time::text, '')::time, TIME '08:00')
                       WHEN $4::boolean AND s.shift_type IN ('CA_2', 'CA_CHIEU')
                           THEN COALESCE(NULLIF(gs.shift_2_time::text, '')::time, TIME '13:30')
                       WHEN $4::boolean AND s.shift_type = 'HALF_DAY_PM_WORK'
                           THEN TIME '13:30'
                       ELSE TIME '14:00'
                   END) AT TIME ZONE 'Asia/Bangkok'
               )
               AND g.bot_role = 'timekeep'
               AND g.is_active = TRUE
               AND COALESCE(g.is_deleted, FALSE) = FALSE
               AND g.group_name NOT ILIKE '%test%'
               AND e.is_active = TRUE
               AND COALESCE(e.is_exempt_checkin, FALSE) = FALSE
               AND e.full_name NOT LIKE '/%'
               AND e.full_name <> 'tester'
               AND ($5::uuid IS NULL OR s.group_id = $5::uuid)
               AND ($6::uuid IS NULL OR s.user_id = $6::uuid)
               AND (
                   COALESCE(gm.status, 'ACTIVE') <> 'PAUSED'
                   OR s.date < COALESCE(gm.paused_at::date, CURRENT_DATE)
               )
               AND NOT EXISTS (
                   SELECT 1 FROM tk_check_ins c
                   WHERE c.group_id = s.group_id AND c.user_id = s.user_id AND c.date = s.date
               )
               AND NOT EXISTS (
                   SELECT 1 FROM tk_attendance_daily_status ds
                   WHERE ds.group_id = s.group_id AND ds.user_id = s.user_id AND ds.date = s.date
                     AND ds.result = 'ABSENT' AND ds.finalized_at IS NOT NULL
               )
               AND NOT EXISTS (
                   SELECT 1 FROM tk_leave_requests r
                   WHERE r.group_id = s.group_id AND r.user_id = s.user_id AND r.date = s.date
                     AND r.request_type = ANY($3::text[]) AND UPPER(r.status) = 'APPROVED'
               )
             ORDER BY g.group_name, e.full_name`,
            [date, workingShifts, leaveRequestTypes, requireScheduleBeforeShift, groupId, userId]
        );
        return result.rows;
    }

    async function insertUnauthorizedAbsentPenalty(db, { groupId, userId, date, amount }) {
        const result = await db.query(
            `INSERT INTO tk_penalties
                (group_id, user_id, date, violation_type, late_minutes, amount, reason, is_paid)
             VALUES ($1, $2, $3, 'UNAUTHORIZED_ABSENT', 0, $4,
                     'Không check-in và không có đơn báo nghỉ trước 14:00', FALSE)
             ON CONFLICT (group_id, user_id, date, violation_type) DO NOTHING
             RETURNING id`,
            [groupId, userId, date, amount]
        );
        return result.rows[0] || null;
    }

    async function upsertAttendanceStatusAbsent(db, { groupId, userId, date }) {
        await db.query(
            `INSERT INTO tk_attendance_daily_status
                (group_id, user_id, date, result, finalized_at, updated_at)
             VALUES ($1, $2, $3, 'ABSENT', NOW(), NOW())
             ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                result = 'ABSENT',
                finalized_at = COALESCE(tk_attendance_daily_status.finalized_at, NOW()),
                updated_at = NOW()`,
            [groupId, userId, date]
        );
    }

    async function findPriorDayAbsent(db, { groupId, userId, date }) {
        const result = await db.query(
            `SELECT 1 FROM tk_attendance_daily_status
             WHERE group_id = $1 AND user_id = $2 AND date = $3::date - 1 AND result = 'ABSENT'
             LIMIT 1`,
            [groupId, userId, date]
        );
        return result.rows.length > 0;
    }

    async function findNearbyConsecutivePenaltyByGroupUser(db, { groupId, userId, date }) {
        const result = await db.query(
            `SELECT id FROM tk_penalties
             WHERE group_id = $1 AND user_id = $2 AND violation_type = 'CONSECUTIVE_LEAVE'
               AND date BETWEEN $3::date - 1 AND $3::date
             LIMIT 1`,
            [groupId, userId, date]
        );
        return result.rows[0] || null;
    }

    async function insertConsecutiveAbsencePenalty(db, { groupId, userId, date, amount, reason }) {
        const result = await db.query(
            `INSERT INTO tk_penalties
                (group_id, user_id, date, violation_type, late_minutes, amount, reason, is_paid)
             VALUES ($1, $2, $3, 'CONSECUTIVE_LEAVE', 0, $4, $5, FALSE)
             ON CONFLICT (group_id, user_id, date, violation_type) DO NOTHING
             RETURNING id`,
            [groupId, userId, date, amount, reason]
        );
        return result.rows[0] || null;
    }

    async function countApprovedLeaveThisMonth(db, { userId, requestTypes, date }) {
        const result = await db.query(
            `SELECT COUNT(DISTINCT date)::int AS leave_count
             FROM tk_leave_requests
             WHERE user_id = $1
               AND status = 'APPROVED'
               AND request_type = ANY($2::text[])
               AND date >= date_trunc('month', $3::date)::date
               AND date < (date_trunc('month', $3::date) + INTERVAL '1 month')::date`,
            [userId, requestTypes, date]
        );
        return Number(result.rows[0]?.leave_count || 0);
    }

    async function insertSuddenLeavePenalty(db, { groupId, userId, date, amount, reason }) {
        const result = await db.query(
            `INSERT INTO tk_penalties
                (group_id, user_id, date, violation_type, late_minutes, amount, reason, is_paid)
             VALUES ($1, $2, $3, 'SUDDEN_LEAVE', 0, $4, $5, FALSE)
             ON CONFLICT (group_id, user_id, date, violation_type) DO NOTHING
             RETURNING id`,
            [groupId, userId, date, amount, reason]
        );
        return result.rows[0] || null;
    }

    async function findAdjacentApprovedLeave(db, { userId, requestTypes, date }) {
        const result = await db.query(
            `SELECT 1 FROM tk_leave_requests
             WHERE user_id = $1
               AND status = 'APPROVED'
               AND request_type = ANY($2::text[])
               AND date IN ($3::date - 1, $3::date + 1)
             LIMIT 1`,
            [userId, requestTypes, date]
        );
        return result.rows.length > 0;
    }

    async function findNearbyConsecutivePenaltyByUser(db, { userId, date }) {
        const result = await db.query(
            `SELECT id FROM tk_penalties
             WHERE user_id = $1 AND violation_type = 'CONSECUTIVE_LEAVE'
               AND date BETWEEN $2::date - 1 AND $2::date + 1
             LIMIT 1`,
            [userId, date]
        );
        return result.rows[0] || null;
    }

    async function findPendingAbsenceNotificationRows(db, date) {
        const result = await db.query(
            `SELECT ds.group_id,
                    ds.user_id,
                    ds.date::text AS date,
                    e.full_name,
                    g.telegram_group_id,
                    g.group_name
             FROM tk_attendance_daily_status ds
             JOIN employees e ON e.id = ds.user_id
             JOIN telegram_groups g ON g.id = ds.group_id
             LEFT JOIN employee_group_memberships gm
               ON gm.employee_id = e.id
              AND gm.telegram_group_id = g.telegram_group_id
             WHERE ds.date = $1::date
               AND ds.result = 'ABSENT'
               AND ds.absence_notified_at IS NULL
               AND g.bot_role = 'timekeep'
               AND g.is_active = TRUE
               AND COALESCE(g.is_deleted, FALSE) = FALSE
               AND (COALESCE(gm.status, 'ACTIVE') <> 'PAUSED'
                    OR ds.date < COALESCE(gm.paused_at::date, CURRENT_DATE))
             ORDER BY g.group_name, e.full_name`,
            [date]
        );
        return result.rows;
    }

    /** Miễn trừ án phạt nghỉ liên tiếp — giữ lại lịch sử lý do, không xoá dòng. */
    async function excusePenalty(db, { penaltyId, adminName }) {
        await db.query(
            `UPDATE tk_penalties
             SET amount = 0, reason = reason || ' (Đã được miễn trừ bởi ' || $1 || ')'
             WHERE id = $2`,
            [adminName, penaltyId]
        );
    }

    async function markAbsenceNotificationsSentRows(db, { groupId, userIds, date }) {
        if (!userIds.length) return;
        await db.query(
            `UPDATE tk_attendance_daily_status
             SET absence_notified_at = COALESCE(absence_notified_at, NOW()),
                 updated_at = NOW()
             WHERE group_id = $1 AND date = $2::date AND user_id = ANY($3::uuid[]) AND result = 'ABSENT'`,
            [groupId, date, userIds]
        );
    }

    return {
        findAbsenceCandidates,
        insertUnauthorizedAbsentPenalty,
        upsertAttendanceStatusAbsent,
        findPriorDayAbsent,
        findNearbyConsecutivePenaltyByGroupUser,
        insertConsecutiveAbsencePenalty,
        countApprovedLeaveThisMonth,
        insertSuddenLeavePenalty,
        findAdjacentApprovedLeave,
        findNearbyConsecutivePenaltyByUser,
        findPendingAbsenceNotificationRows,
        markAbsenceNotificationsSentRows,
        excusePenalty
    };
}

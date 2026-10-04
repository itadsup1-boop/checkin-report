/**
 * SQL của lượt điểm danh video và check-out (`tk_check_ins`).
 */
export function createCheckinRepository({ pool }) {
    async function insertCheckIn({ groupId, userId, date, checkInTime, videoUrl, workCredit = 1.0, checkinPenaltyAmount = 0 }) {
        await pool.query(
            `INSERT INTO tk_check_ins (group_id, user_id, date, check_in_time, video_file_id, status, work_credit, checkin_penalty_amount)
             VALUES ($1, $2, $3, $4, $5, 'APPROVED', $6, $7)
             ON CONFLICT (user_id, date) DO UPDATE SET
                check_in_time = EXCLUDED.check_in_time,
                video_file_id = EXCLUDED.video_file_id,
                work_credit = EXCLUDED.work_credit,
                checkin_penalty_amount = EXCLUDED.checkin_penalty_amount`,
            [groupId, userId, date, checkInTime, videoUrl, workCredit, checkinPenaltyAmount]
        );
        const attendanceResult = checkinPenaltyAmount > 0 ? 'LATE' : 'ON_TIME';
        await pool.query(
            `INSERT INTO tk_attendance_daily_status (group_id, user_id, date, result, finalized_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())
             ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                result = $4,
                finalized_at = COALESCE(tk_attendance_daily_status.finalized_at, NOW()),
                updated_at = NOW()`,
            [groupId, userId, date, attendanceResult]
        );
    }


    async function recordCheckOut({ userId, date, checkoutTime, mediaFileId = null, checkoutStatus = 'HOAN_THANH', penaltyAmount = 0 }) {
        const result = await pool.query(
            `UPDATE tk_check_ins
             SET checkout_time = $3,
                 checkout_media_file_id = COALESCE($4, checkout_media_file_id),
                 checkout_status = $5,
                 checkout_penalty_amount = $6
             WHERE user_id = $1 AND date = $2
             RETURNING id, group_id, user_id, check_in_time, checkout_time, work_credit`,
            [userId, date, checkoutTime, mediaFileId, checkoutStatus, penaltyAmount]
        );
        return result.rows[0] || null;
    }

    async function findCheckInOfDay(userIdOrFilter, maybeDate) {
        let userId = userIdOrFilter;
        let date = maybeDate;
        if (userIdOrFilter && typeof userIdOrFilter === 'object') {
            userId = userIdOrFilter.userId;
            date = userIdOrFilter.date;
        }
        const result = await pool.query(
            `SELECT * FROM tk_check_ins WHERE user_id = $1 AND date = $2 LIMIT 1`,
            [userId, date]
        );
        return result.rows[0] || null;
    }

    async function findGroupPolicy(telegramGroupId) {
        const result = await pool.query(
            `SELECT COALESCE(gs.attendance_policy, 'CLINIC') AS attendance_policy,
                    COALESCE(gs.checkout_min_time::text, '18:30:00') AS checkout_min_time,
                    COALESCE(gs.checkout_deadline::text, '23:59:00') AS checkout_deadline,
                    COALESCE(gs.marketing_checkin_deadline::text, '08:30:00') AS marketing_checkin_deadline,
                    COALESCE(gs.marketing_late_cutoff::text, '09:30:00') AS marketing_late_cutoff,
                    gs.marketing_sunday_checkin_deadline::text AS marketing_sunday_checkin_deadline,
                    gs.marketing_sunday_late_cutoff::text AS marketing_sunday_late_cutoff,
                    COALESCE(gs.marketing_checkin_penalty, 50000) AS marketing_checkin_penalty,
                    COALESCE(gs.marketing_checkout_penalty, 20000) AS marketing_checkout_penalty,
                    COALESCE(gs.effective_start_date::text, '2026-09-29') AS effective_start_date
             FROM telegram_groups g
             LEFT JOIN group_settings gs ON g.telegram_group_id = gs.telegram_group_id
             WHERE g.telegram_group_id = $1 OR g.id::text = $1
             LIMIT 1`,
            [String(telegramGroupId)]
        );
        return result.rows[0] || {
            attendance_policy: 'CLINIC',
            checkout_min_time: '18:30:00',
            checkout_deadline: '23:59:00',
            marketing_checkin_deadline: '08:30:00',
            marketing_late_cutoff: '09:30:00',
            marketing_sunday_checkin_deadline: null,
            marketing_sunday_late_cutoff: null,
            marketing_checkin_penalty: 50000,
            marketing_checkout_penalty: 20000,
            effective_start_date: '2026-09-29'
        };
    }

    async function findMarketingUncheckedOut({ date }) {
        const result = await pool.query(
            `SELECT c.id, c.group_id, c.user_id, c.date::text, c.check_in_time,
                    u.full_name, g.telegram_group_id,
                    COALESCE(gs.marketing_checkout_penalty, 20000) AS marketing_checkout_penalty
             FROM tk_check_ins c
             JOIN employees u ON c.user_id = u.id
             JOIN telegram_groups g ON c.group_id = g.id
             JOIN group_settings gs ON g.telegram_group_id = gs.telegram_group_id
             WHERE c.date = $1
               AND gs.attendance_policy = 'MARKETING'
               AND c.checkout_time IS NULL
               AND COALESCE(c.checkout_status, '') != 'QUEN_CHECKOUT'
               AND COALESCE(u.is_active, true) = true
               AND c.date >= COALESCE(gs.effective_start_date, '2026-09-29'::date)
             ORDER BY u.full_name ASC`,
            [date]
        );
        return result.rows;
    }

    async function markMissedCheckout({ checkinId, penaltyAmount = 20000 }) {
        await pool.query(
            `UPDATE tk_check_ins
             SET checkout_status = 'QUEN_CHECKOUT',
                 checkout_penalty_amount = $2
             WHERE id = $1`,
            [checkinId, penaltyAmount]
        );
    }

    async function insertCheckoutPenalty({ groupId, userId, date, amount = 20000, reason }) {
        await pool.query(
            `INSERT INTO tk_penalties (group_id, user_id, date, violation_type, amount, reason, is_paid)
             VALUES ($1, $2, $3, 'MISSED_CHECKOUT', $4, $5, false)
             ON CONFLICT DO NOTHING`,
            [groupId, userId, date, amount, reason]
        );
    }

    async function clearCheckoutPenalty({ userId, date }) {
        await pool.query(
            `DELETE FROM tk_penalties
             WHERE user_id = $1 AND date = $2 AND violation_type = 'MISSED_CHECKOUT'`,
            [userId, date]
        );
    }

    async function insertLatePenalty({ groupId, userId, date, lateMinutes, amount, reason }) {
        await pool.query(
            `INSERT INTO tk_penalties (group_id, user_id, date, violation_type, late_minutes, amount, reason, is_paid)
             VALUES ($1, $2, $3, 'LATE', $4, $5, $6, false)
             ON CONFLICT DO NOTHING`,
            [groupId, userId, date, lateMinutes, amount, reason]
        );
    }

    async function findUserScheduleOfDay(userId, date) {
        const result = await pool.query(
            `SELECT shift_type FROM tk_schedules WHERE user_id = $1 AND date = $2 LIMIT 1`,
            [userId, date]
        );
        return result.rows[0] || null;
    }

    async function findApprovedLateLeaveRequest(userId, date) {
        const result = await pool.query(
            `SELECT id, late_minutes, reason FROM tk_leave_requests
             WHERE user_id = $1 AND date = $2 AND request_type = 'LATE' AND status = 'APPROVED'
             ORDER BY created_at DESC
             LIMIT 1`,
            [userId, date]
        );
        return result.rows[0] || null;
    }

    return {
        insertCheckIn,
        recordCheckOut,
        findCheckInOfDay,
        findGroupPolicy,
        findMarketingUncheckedOut,
        markMissedCheckout,
        insertCheckoutPenalty,
        clearCheckoutPenalty,
        insertLatePenalty,
        findUserScheduleOfDay,
        findApprovedLateLeaveRequest
    };
}



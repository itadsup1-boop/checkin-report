/**
 * SQL của đơn nghỉ đột xuất tự động chấp nhận (`tk_leave_requests`) và các hiệu
 * ứng kèm theo trên `tk_schedules`/`tk_penalties`/`tk_attendance_daily_status`.
 *
 * Mọi hàm nhận `client` của transaction đang mở — quy trình duyệt/từ chối đơn
 * phải chạy trong một transaction để không lệch nửa chừng. Tham số dùng đúng
 * tên cột snake_case vì phần lớn lời gọi truyền thẳng bản ghi đọc từ
 * `tk_leave_requests` (đã ở dạng snake_case), tránh phải đổi tên qua lại.
 */

export function createLeaveRequestRepository() {
    async function restoreSchedule(client, { group_id, user_id, appliedShift }, snapshot, dateKey) {
        if (!snapshot?.existed) {
            await client.query(
                `DELETE FROM tk_schedules
                 WHERE user_id = $1 AND date = $2
                   AND group_id = $3 AND shift_type = $4 AND is_locked = TRUE`,
                [user_id, dateKey, group_id, appliedShift]
            );
            return;
        }

        await client.query(
            `INSERT INTO tk_schedules
                (group_id, user_id, date, shift_type, is_locked, proof_url, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (user_id, date) DO UPDATE SET
                group_id = EXCLUDED.group_id,
                shift_type = EXCLUDED.shift_type,
                is_locked = EXCLUDED.is_locked,
                proof_url = EXCLUDED.proof_url,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()`,
            [
                snapshot.groupId || group_id,
                user_id,
                dateKey,
                snapshot.shiftType,
                Boolean(snapshot.isLocked),
                snapshot.proofUrl || null,
                snapshot.updatedBy || null
            ]
        );
    }

    async function applyScheduleEffect(client, { group_id, user_id, dateKey, shiftType, updatedBy }) {
        await client.query(
            `INSERT INTO tk_schedules
                (group_id, user_id, date, shift_type, is_locked, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, TRUE, $5, NOW())
             ON CONFLICT (user_id, date) DO UPDATE SET
                group_id = EXCLUDED.group_id,
                shift_type = EXCLUDED.shift_type,
                is_locked = TRUE,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()`,
            [group_id, user_id, dateKey, shiftType, updatedBy]
        );
    }

    async function removePenaltiesCreatedByAcceptedLeave(client, { group_id, user_id, date }) {
        const result = await client.query(
            `DELETE FROM tk_penalties
             WHERE group_id = $1 AND user_id = $2 AND date = $3
               AND violation_type IN ('SUDDEN_LEAVE', 'CONSECUTIVE_LEAVE')
             RETURNING id, violation_type, amount`,
            [group_id, user_id, date]
        );
        return result.rows;
    }

    async function restoreLatePenaltyAfterRejection(client, { group_id, user_id, date }, discountSuffix) {
        const result = await client.query(
            `UPDATE tk_penalties
             SET amount = amount * 2,
                 reason = REPLACE(reason, $4, '')
             WHERE group_id = $1 AND user_id = $2 AND date = $3
               AND violation_type = 'LATE'
               AND amount > 0
               AND reason LIKE '%' || $4 || '%'
             RETURNING id, amount, reason`,
            [group_id, user_id, date, discountSuffix]
        );
        return result.rows;
    }

    /**
     * Phạt đi muộn của đúng ngày đó, nếu cron đã chốt trước khi đơn LATE được
     * tạo (nhân viên báo sau khi đã chấm công/đã bị tính phạt).
     */
    async function findLatePenaltyForDate(client, { group_id, user_id, date }) {
        const result = await client.query(
            `SELECT id, amount, late_minutes, reason FROM tk_penalties
             WHERE group_id = $1 AND user_id = $2 AND date = $3 AND violation_type = 'LATE'
             LIMIT 1`,
            [group_id, user_id, date]
        );
        return result.rows[0] || null;
    }

    /** Hồi tố mức phạt đã chốt khi đơn báo muộn đến muộn hơn (sau khi đã chấm công). */
    async function adjustLatePenaltyForLateAnnouncement(client, penaltyId, { amount, reason }) {
        const result = await client.query(
            `UPDATE tk_penalties SET amount = $1, reason = $2 WHERE id = $3 RETURNING id, amount, reason`,
            [amount, reason, penaltyId]
        );
        return result.rows[0] || null;
    }

    async function deleteOnLeaveStatus(client, { group_id, user_id, date }) {
        await client.query(
            `DELETE FROM tk_attendance_daily_status
             WHERE group_id = $1 AND user_id = $2 AND date = $3 AND result = 'ON_LEAVE'`,
            [group_id, user_id, date]
        );
    }

    async function deleteUnauthorizedAbsentPenalty(client, { group_id, user_id, date }) {
        await client.query(
            `DELETE FROM tk_penalties
             WHERE group_id = $1 AND user_id = $2 AND date = $3 AND violation_type = 'UNAUTHORIZED_ABSENT'`,
            [group_id, user_id, date]
        );
    }

    async function upsertAttendanceStatusOnLeave(client, { group_id, user_id, date }) {
        await client.query(
            `INSERT INTO tk_attendance_daily_status
                (group_id, user_id, date, result, finalized_at, updated_at)
             VALUES ($1, $2, $3, 'ON_LEAVE', NOW(), NOW())
             ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                result = 'ON_LEAVE', finalized_at = NOW(), updated_at = NOW()`,
            [group_id, user_id, date]
        );
    }

    /** Bỏ cảnh báo ca sáng để nhân sự vẫn được chấm công cho ca chiều — dùng khi duyệt nghỉ nửa ngày sáng. */
    async function clearMorningLateWarning(client, { group_id, user_id, date }) {
        await client.query(
            `DELETE FROM tk_attendance_daily_status
             WHERE group_id = $1 AND user_id = $2 AND date = $3
               AND result = 'LATE_NOTIFIED' AND finalized_at IS NULL`,
            [group_id, user_id, date]
        );
    }

    async function lockPreviousRequest(client, { group_id, user_id, date }) {
        const result = await client.query(
            `SELECT * FROM tk_leave_requests
             WHERE group_id = $1 AND user_id = $2 AND date = $3
               AND status IN ('PENDING', 'APPROVED', 'REJECTED')
             ORDER BY created_at DESC
             FOR UPDATE`,
            [group_id, user_id, date]
        );
        return result.rows[0] || null;
    }

    async function cancelPreviousRequests(client, { group_id, user_id, date }) {
        await client.query(
            `UPDATE tk_leave_requests
             SET status = 'CANCELLED'
             WHERE group_id = $1 AND user_id = $2 AND date = $3
               AND status IN ('PENDING', 'APPROVED', 'REJECTED')`,
            [group_id, user_id, date]
        );
    }

    async function lockCurrentSchedule(client, { user_id, date }) {
        const result = await client.query(
            `SELECT group_id, shift_type, is_locked, proof_url, updated_by
             FROM tk_schedules
             WHERE user_id = $1 AND date = $2
             FOR UPDATE`,
            [user_id, date]
        );
        return result.rows[0] || null;
    }

    async function insertAutoAcceptedRequest(client, {
        group_id, user_id, requestType, lateMinutes, date, reason, proofUrl, approvedBy, previousSchedule
    }) {
        const result = await client.query(
            `INSERT INTO tk_leave_requests
                (group_id, user_id, request_type, late_minutes, date, reason, proof_url,
                 status, approved_by, auto_accepted, effective_applied_at, previous_schedule)
             VALUES ($1, $2, $3, $4, $5, $6, $7,
                     'APPROVED', $8, TRUE, NOW(), $9::jsonb)
             RETURNING *`,
            [group_id, user_id, requestType, lateMinutes, date, reason, proofUrl, approvedBy, JSON.stringify(previousSchedule)]
        );
        return result.rows[0];
    }

    async function lockRequestById(client, requestId) {
        const result = await client.query('SELECT * FROM tk_leave_requests WHERE id = $1 FOR UPDATE', [requestId]);
        return result.rows[0] || null;
    }

    async function markRequestRejected(client, requestId, rejectedBy) {
        await client.query(
            `UPDATE tk_leave_requests
             SET status = 'REJECTED', approved_by = $2, rejected_at = NOW()
             WHERE id = $1`,
            [requestId, rejectedBy]
        );
    }

    /* ---------- Duyệt/từ chối đơn qua nút Telegram ---------- */

    async function findForApproval(pool, requestId) {
        const result = await pool.query(
            `SELECT r.*, u.full_name, u.role, u.telegram_id as user_telegram_id, g.telegram_group_id
             FROM tk_leave_requests r
             JOIN employees u ON r.user_id = u.id
             JOIN telegram_groups g ON r.group_id = g.id
             WHERE r.id = $1`,
            [requestId]
        );
        return result.rows[0] || null;
    }

    async function findEmployeeFullNameByTelegramId(pool, telegramId) {
        const result = await pool.query('SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1', [telegramId]);
        return result.rows[0]?.full_name || null;
    }

    /** Đơn PENDING cũ (chưa tự động chấp nhận) — luồng duyệt/từ chối kiểu cũ. */
    async function updateLegacyRequestStatus(pool, requestId, status, adminName) {
        await pool.query(
            'UPDATE tk_leave_requests SET status = $1, approved_by = $2 WHERE id = $3',
            [status, adminName, requestId]
        );
    }

    /** Ghi ca khi đơn PENDING cũ (FULL/HALF day) được duyệt — is_locked luôn TRUE, khác upsertScheduleDay dùng cho Mini App. */
    async function upsertApprovedShift(pool, { groupId, userId, date, shiftType }) {
        await pool.query(
            `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked)
             VALUES ($1, $2, $3, $4, true)
             ON CONFLICT (user_id, date)
             DO UPDATE SET shift_type = $4, is_locked = true`,
            [groupId, userId, date, shiftType]
        );
    }

    return {
        restoreSchedule,
        applyScheduleEffect,
        removePenaltiesCreatedByAcceptedLeave,
        restoreLatePenaltyAfterRejection,
        findLatePenaltyForDate,
        adjustLatePenaltyForLateAnnouncement,
        deleteOnLeaveStatus,
        deleteUnauthorizedAbsentPenalty,
        upsertAttendanceStatusOnLeave,
        clearMorningLateWarning,
        lockPreviousRequest,
        cancelPreviousRequests,
        lockCurrentSchedule,
        insertAutoAcceptedRequest,
        lockRequestById,
        markRequestRejected,
        findForApproval,
        findEmployeeFullNameByTelegramId,
        updateLegacyRequestStatus,
        upsertApprovedShift
    };
}

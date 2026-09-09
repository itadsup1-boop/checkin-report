/**
 * SQL của cron quét retry mỗi 5 phút: gửi bù tin nhắn Telegram báo bù, đồng bộ
 * lại Sheet của báo bù bị lỗi, và ghi lên Sheet các công tour quá 48 giờ chưa
 * hoàn tất. Ba việc khác nhau nhưng cùng chạy trong một lịch, nên gom SQL vào
 * một file cho dễ đối chiếu với interfaces/cron/register-retry-cron.js.
 */

export function createRetryRepository({ pool }) {
    async function findPendingNotifications(limit = 10) {
        const result = await pool.query(
            `SELECT * FROM tour_makeup_requests
             WHERE status IN ('PENDING_NOTIFICATION', 'NOTIFICATION_FAILED')
             ORDER BY created_at ASC LIMIT $1`,
            [limit]
        );
        return result.rows;
    }

    async function markNotificationPending(id) {
        await pool.query("UPDATE tour_makeup_requests SET status = 'PENDING' WHERE id = $1", [id]);
    }

    async function markNotificationFailed(id) {
        await pool.query("UPDATE tour_makeup_requests SET status = 'NOTIFICATION_FAILED' WHERE id = $1", [id]);
    }

    /** Ảnh minh chứng đã mất trên đĩa (dọn ổ cứng, restart mất volume tạm...) — không còn gì để gửi lại. */
    async function markRejectedMissingProof(id) {
        await pool.query(
            "UPDATE tour_makeup_requests SET status = 'REJECTED', review_note = 'Không tìm thấy ảnh chứng thực trên máy chủ' WHERE id = $1",
            [id]
        );
    }

    async function findRequestsNeedingSheetSync(limit = 10) {
        const result = await pool.query(
            `SELECT id FROM tour_makeup_requests
             WHERE status = 'APPROVED'
               AND (sheet_sync_status IS NULL OR sheet_sync_status != 'SUCCESS')
             ORDER BY reviewed_at ASC LIMIT $1`,
            [limit]
        );
        return result.rows;
    }

    async function findMakeupRequestById(id) {
        const result = await pool.query('SELECT * FROM tour_makeup_requests WHERE id = $1', [id]);
        return result.rows[0] || null;
    }

    async function markSheetSyncStatus(id, status, error = null) {
        await pool.query(
            'UPDATE tour_makeup_requests SET sheet_sync_status = $1, sheet_sync_error = $2 WHERE id = $3',
            [status, error, id]
        );
    }

    async function findEmployeeCode(telegramId, groupId) {
        const result = await pool.query(
            'SELECT employee_code FROM employees WHERE telegram_id = $1 AND telegram_group_id = $2 LIMIT 1',
            [telegramId, groupId]
        );
        return result.rows[0]?.employee_code || '';
    }

    async function markApprovedAppointmentSheetRowIndex(appointmentId, rowNumber) {
        await pool.query('UPDATE customer_appointments SET sheet_row_index = $1 WHERE id = $2', [rowNumber, appointmentId]);
    }

    /**
     * Công tour quá 48h chưa xác nhận/hủy và chưa từng ghi lên Sheet, để không
     * âm thầm mất dấu những lịch nhân viên quên xử lý.
     */
    async function findUncompletedTourAppointments(limit = 20) {
        const result = await pool.query(
            `SELECT a.*, e.employee_code
             FROM customer_appointments a
             LEFT JOIN employees e ON a.telegram_id = e.telegram_id AND a.group_id = e.telegram_group_id
             WHERE a.status != 'CANCELLED'
               AND a.sheet_row_index IS NULL
               AND a.appointment_time < NOW() - INTERVAL '48 hours'
               AND NOT EXISTS (
                   SELECT 1 FROM tour_makeup_requests r
                   WHERE r.original_appointment_id = a.id AND r.status = 'APPROVED'
               )
             ORDER BY a.appointment_time ASC LIMIT $1`,
            [limit]
        );
        return result.rows;
    }

    async function markAppointmentSheetRowIndex(id, rowNumber) {
        await pool.query('UPDATE customer_appointments SET sheet_row_index = $1 WHERE id = $2', [rowNumber, id]);
    }

    return {
        findPendingNotifications,
        markNotificationPending,
        markNotificationFailed,
        markRejectedMissingProof,
        findRequestsNeedingSheetSync,
        findMakeupRequestById,
        markSheetSyncStatus,
        findEmployeeCode,
        markApprovedAppointmentSheetRowIndex,
        findUncompletedTourAppointments,
        markAppointmentSheetRowIndex
    };
}

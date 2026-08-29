/** Truy vấn riêng cho luồng hoàn tất ảnh của nhóm Báo hẹn khách cũ. */

export function createCompletionRepository({ pool }) {
    /** Lấy lịch quá 30 phút chưa nhắc; dấu DB giúp không bỏ sót khi bot restart. */
    async function findReportPhotoDebtsDueForReminder() {
        const result = await pool.query(
            `SELECT a.*
             FROM customer_appointments a
             JOIN telegram_groups g ON g.telegram_group_id = a.group_id
             WHERE g.bot_role = 'report' AND g.is_active = TRUE
               AND a.status IN ('ACTIVE', 'ARRIVED')
               AND NULLIF(a.proof_image, '') IS NULL
               AND (a.status = 'ACTIVE' OR a.is_photo_debt = TRUE)
               AND a.completion_reminded_at IS NULL
               AND a.appointment_time >= (NOW() - INTERVAL '48 hours')
               AND a.appointment_time <= (NOW() - INTERVAL '30 minutes')
             ORDER BY a.appointment_time ASC`
        );
        return result.rows;
    }

    async function markCompletionReminded(id) {
        await pool.query(
            `UPDATE customer_appointments
             SET completion_reminded_at = NOW()
             WHERE id = $1 AND completion_reminded_at IS NULL`,
            [id]
        );
    }

    return { findReportPhotoDebtsDueForReminder, markCompletionReminded };
}

/**
 * SQL của "nợ ảnh": danh sách lịch đã đến nhưng chưa có ảnh chứng thực, và các
 * thao tác bổ sung ảnh (từ Mini App hoặc reply trực tiếp trên Telegram).
 *
 * Tách khỏi appointment-repository.js để file đó không vượt quá 300 dòng, và vì
 * đây là một nhóm nghiệp vụ riêng (bổ sung minh chứng), khác CRUD lịch hẹn.
 */

export function createProofRepository({ pool }) {
    /** Danh sách nợ ảnh của đúng nhân viên đang xem, lọc theo ngày nếu có. */
    async function listPhotoDebts(telegramId, groupId, date) {
        let query = `
            SELECT id, customer_name, employee_name, appointment_time, service, status, is_photo_debt, proof_image
            FROM customer_appointments
            WHERE is_photo_debt = TRUE AND status = 'ARRIVED'
              AND telegram_id = $1 AND group_id = $2
        `;
        const params = [telegramId, String(groupId)];
        if (date) {
            query += ' AND DATE(appointment_time) = $3';
            params.push(date);
        }
        query += ' ORDER BY appointment_time DESC';

        const result = await pool.query(query, params);
        return result.rows;
    }

    /**
     * Lịch hợp lệ để chính chủ bổ sung ảnh qua Mini App: đúng nhân viên, đúng
     * nhóm, chưa có ảnh, và nhóm phải đang bật vai trò lịch khách/tour.
     */
    async function findForProofUpload(id, groupId, telegramId) {
        const result = await pool.query(
            `SELECT a.*, g.bot_role
             FROM customer_appointments a
             JOIN telegram_groups g ON g.telegram_group_id = a.group_id
             WHERE a.id = $1 AND a.group_id = $2 AND a.telegram_id = $3
               AND a.status IN ('ACTIVE', 'ARRIVED')
               AND NULLIF(a.proof_image, '') IS NULL
               AND g.is_active = TRUE
               AND g.bot_role IN ('report', 'report_tour')`,
            [id, String(groupId), telegramId]
        );
        return result.rows[0] || null;
    }

    /** Lịch còn nhận ảnh trong đúng nhóm — dùng khi bổ sung qua reply Telegram (ai trong nhóm cũng bấm được, tuỳ quyền). */
    async function findActiveForProof(id, groupId) {
        const result = await pool.query(
            `SELECT *
             FROM customer_appointments
             WHERE id = $1
               AND group_id = $2
               AND status IN ('ACTIVE', 'ARRIVED')
               AND NULLIF(proof_image, '') IS NULL`,
            [id, groupId]
        );
        return result.rows[0] || null;
    }

    /**
     * Dò lịch theo SĐT + ngày + giờ hẹn khi tin nhắn cũ không còn mã lịch trong
     * nội dung — dùng để nhận diện đúng khách khi nhân viên reply ảnh trên tin cũ.
     */
    async function findCandidatesByPhoneDateTime(groupId, phone, date, appointmentTime) {
        const result = await pool.query(
            `SELECT id, customer_name
             FROM customer_appointments
             WHERE group_id = $1
               AND phone = $2
               AND status IN ('ACTIVE', 'ARRIVED')
               AND NULLIF(proof_image, '') IS NULL
               AND appointment_time::date = $3::date
               AND ($4::text IS NULL OR
                    TO_CHAR(appointment_time, 'HH24:MI') = $4)
             ORDER BY appointment_time DESC
             LIMIT 5`,
            [groupId, phone, date, appointmentTime]
        );
        return result.rows;
    }

    /** Ghi ảnh không điều kiện — dùng khi luồng gọi đã tự xác nhận lịch hợp lệ ngay trước đó. */
    async function markProofSaved(id, proofUrl) {
        await pool.query(
            `UPDATE customer_appointments
             SET status = 'ARRIVED', is_photo_debt = FALSE, proof_image = $1
             WHERE id = $2`,
            [proofUrl, id]
        );
    }

    /**
     * Ghi ảnh có điều kiện, trả về có ghi được không — dùng khi nhiều người có
     * thể cùng reply một tin nên phải chặn ghi trùng ở tầng database.
     */
    async function markProofSavedIfPending(id, proofUrl) {
        const result = await pool.query(
            `UPDATE customer_appointments
             SET status = 'ARRIVED', is_photo_debt = FALSE, proof_image = $1
             WHERE id = $2
               AND status IN ('ACTIVE', 'ARRIVED')
               AND NULLIF(proof_image, '') IS NULL
             RETURNING id`,
            [proofUrl, id]
        );
        return result.rows.length > 0;
    }

    async function markSheetRowIndex(id, rowNumber) {
        await pool.query('UPDATE customer_appointments SET sheet_row_index = $1 WHERE id = $2', [rowNumber, id]);
    }

    async function findGroupRole(groupId) {
        const result = await pool.query(
            `SELECT bot_role FROM telegram_groups
             WHERE telegram_group_id = $1 AND is_active = TRUE LIMIT 1`,
            [groupId]
        );
        return result.rows[0]?.bot_role || null;
    }

    async function findEmployeeCode(telegramId, groupId) {
        const result = await pool.query(
            'SELECT employee_code FROM employees WHERE telegram_id = $1 AND telegram_group_id = $2 LIMIT 1',
            [telegramId, groupId]
        );
        return result.rows[0]?.employee_code || '';
    }

    /**
     * Nhóm `report` chỉ cho chính chủ bổ sung ảnh trong 48 giờ; Quản lý của
     * đúng nhóm hoặc Admin được xử lý hộ không giới hạn giờ. Kiểm cả cột nhóm
     * cố định (`e.telegram_group_id`) lẫn bảng phụ trách nhiều nhóm
     * (`employee_group_memberships`) vì nhân viên có thể phụ trách nhóm không
     * phải nhóm gốc của họ.
     */
    async function isManagerOfGroup(telegramId, groupId) {
        const result = await pool.query(
            `SELECT 1
             FROM employees e
             LEFT JOIN employee_group_memberships m ON m.employee_id = e.id
             WHERE e.telegram_id = $1 AND e.is_active = TRUE AND e.role = 'Quản lý'
               AND (e.telegram_group_id = $2
                    OR (m.telegram_group_id = $2 AND m.status = 'ACTIVE'))
             LIMIT 1`,
            [telegramId, groupId]
        );
        return result.rows.length > 0;
    }

    /**
     * Khi lịch không gắn nhóm cụ thể (đặt qua Mini App độc lập, `group_id`
     * rỗng hoặc placeholder), chọn tạm một nhóm lịch khách/tour đang hoạt động
     * để báo tin thay vì bỏ qua thông báo hoàn toàn.
     */
    async function findFallbackNotifyGroup() {
        const result = await pool.query(
            `SELECT s.group_id
             FROM schedule_notification_groups s
             JOIN telegram_groups tg ON tg.telegram_group_id = s.group_id
             WHERE tg.bot_role IN ('report', 'report_tour') AND tg.is_active = true
               AND COALESCE(tg.is_deleted, false) = false
             LIMIT 1`
        );
        return result.rows[0]?.group_id || null;
    }

    return {
        listPhotoDebts,
        findFallbackNotifyGroup,
        findForProofUpload,
        findActiveForProof,
        findCandidatesByPhoneDateTime,
        findGroupRole,
        markProofSaved,
        markProofSavedIfPending,
        markSheetRowIndex,
        findEmployeeCode,
        isManagerOfGroup
    };
}

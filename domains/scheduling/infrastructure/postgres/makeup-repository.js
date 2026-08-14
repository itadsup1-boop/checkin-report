/**
 * Toàn bộ SQL của chức năng lịch khách / báo bù công tour.
 *
 * Đây là nơi DUY NHẤT trong domain này được viết SQL — tầng application và
 * domain không được chứa câu truy vấn nào.
 *
 * Các khoá FOR SHARE / FOR UPDATE giữ nguyên như bản cũ: hai nhân viên cùng bấm
 * gửi một lúc thì người sau phải chờ, nếu không cả hai cùng thấy "chưa có yêu
 * cầu nào" và tạo ra hai bản ghi trùng.
 */

import { BLOCKING_STATUSES } from '../../domain/makeup-rules.js';

export function createMakeupRepository({ pool }) {
    /** Nhân sự có thuộc nhóm không; không thấy trong nhóm thì tìm bản ghi bất kỳ. */
    async function findEmployeeForGroup(telegramId, groupId) {
        const inGroup = await pool.query(
            `SELECT id FROM employees
             WHERE telegram_id = $1 AND telegram_group_id = $2 AND is_active = true
             LIMIT 1`,
            [telegramId, groupId]
        );
        if (inGroup.rows.length > 0) return inGroup.rows[0];

        const anyGroup = await pool.query(
            'SELECT id FROM employees WHERE telegram_id = $1 AND is_active = true LIMIT 1',
            [telegramId]
        );
        return anyGroup.rows[0] || null;
    }

    /**
     * Lịch còn thiếu trong 48 giờ qua: đang chờ, hoặc đã đến mà còn nợ ảnh.
     * Đây chính là danh sách hiện trong ô "Chọn lịch thiếu cần bổ sung".
     */
    async function listIncompleteAppointments(telegramId, groupId) {
        const result = await pool.query(
            `SELECT id, customer_name, phone, appointment_time, service, sessions,
                    session_type, revenue, status, is_photo_debt
             FROM customer_appointments
             WHERE telegram_id = $1
               AND group_id = $2
               AND appointment_time >= NOW() - INTERVAL '48 hours'
               AND appointment_time <= NOW()
               AND status != 'CANCELLED'
               AND (status = 'ACTIVE' OR (status = 'ARRIVED' AND (is_photo_debt = TRUE OR proof_image IS NULL)))
             ORDER BY appointment_time DESC`,
            [telegramId, groupId]
        );
        return result.rows;
    }

    async function listRequestHistory(telegramId) {
        const result = await pool.query(
            `SELECT id, request_type, work_date, appointment_time, customer_name, customer_phone,
                    service, sessions, session_type, revenue, reason, proof_image, status,
                    submitted_at, review_note, reviewed_by, sheet_sync_status, sheet_sync_error
             FROM tour_makeup_requests
             WHERE telegram_id = $1
             ORDER BY submitted_at DESC`,
            [telegramId]
        );
        return result.rows;
    }

    /* ---------- Các truy vấn chạy TRONG transaction ---------- */

    async function lockActiveGroup(client, groupId) {
        const result = await client.query(
            `SELECT is_active FROM telegram_groups
             WHERE telegram_group_id = $1 AND is_active = true
             LIMIT 1 FOR SHARE`,
            [groupId]
        );
        return result.rows[0] || null;
    }

    async function lockGroupMember(client, telegramId, groupId) {
        const result = await client.query(
            `SELECT full_name FROM employees
             WHERE telegram_id = $1 AND telegram_group_id = $2 AND is_active = true
             LIMIT 1 FOR SHARE`,
            [telegramId, groupId]
        );
        return result.rows[0] || null;
    }

    async function lockAppointment(client, appointmentId) {
        const result = await client.query(
            'SELECT * FROM customer_appointments WHERE id = $1 FOR SHARE',
            [appointmentId]
        );
        return result.rows[0] || null;
    }

    /** Đã có yêu cầu báo bù cho cùng khách trong cùng ngày chưa. */
    async function findBlockingRequest(client, { telegramId, groupId, workDate, phone }) {
        const result = await client.query(
            `SELECT id FROM tour_makeup_requests
             WHERE telegram_id = $1 AND telegram_group_id = $2 AND work_date = $3 AND customer_phone = $4
               AND status = ANY($5::text[]) FOR UPDATE`,
            [telegramId, groupId, workDate, phone, BLOCKING_STATUSES]
        );
        return result.rows[0] || null;
    }

    /** Công tour cho khách đó trong ngày đã ghi nhận đầy đủ rồi hay chưa. */
    async function findCompletedAppointment(client, { telegramId, groupId, workDate, phone }) {
        const result = await client.query(
            `SELECT id FROM customer_appointments
             WHERE telegram_id = $1 AND group_id = $2 AND DATE(appointment_time) = $3 AND phone = $4
               AND status = 'ARRIVED' AND is_photo_debt = FALSE AND proof_image IS NOT NULL
             LIMIT 1 FOR SHARE`,
            [telegramId, groupId, workDate, phone]
        );
        return result.rows[0] || null;
    }

    async function insertRequest(client, request) {
        const result = await client.query(
            `INSERT INTO tour_makeup_requests (
                telegram_group_id, telegram_id, employee_name, request_type, original_appointment_id,
                work_date, appointment_time, customer_name, customer_phone, service, sessions,
                session_type, revenue, reason, proof_image, status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                       'PENDING_NOTIFICATION')
             RETURNING id`,
            [
                request.groupId, request.telegramId, request.employeeName, request.requestType,
                request.originalAppointmentId || null, request.workDate, request.appointmentTime,
                request.customerName, request.phone, request.service, request.sessions,
                request.sessionType || 'Bán', request.revenue, request.reason, request.proofUrl
            ]
        );
        return result.rows[0].id;
    }

    /** Cập nhật trạng thái sau khi đã gửi (hoặc gửi hỏng) thông báo Telegram. */
    async function markStatus(requestId, status) {
        await pool.query('UPDATE tour_makeup_requests SET status = $2 WHERE id = $1', [requestId, status]);
    }

    /* ---------- Duyệt / từ chối ---------- */

    async function lockRequest(client, requestId) {
        const result = await client.query(
            'SELECT * FROM tour_makeup_requests WHERE id = $1 FOR UPDATE',
            [requestId]
        );
        return result.rows[0] || null;
    }

    async function lockAppointmentForUpdate(client, appointmentId) {
        const result = await client.query(
            'SELECT * FROM customer_appointments WHERE id = $1 FOR UPDATE',
            [appointmentId]
        );
        return result.rows[0] || null;
    }

    /** Người bấm nút có vai trò "Quản lý" ĐÚNG trong nhóm của yêu cầu không. */
    async function isGroupManager(client, telegramId, groupId) {
        const result = await client.query(
            `SELECT e.role
             FROM employees e
             JOIN employee_group_memberships m ON m.employee_id = e.id
             WHERE e.telegram_id = $1 AND m.telegram_group_id = $2
               AND e.is_active = true AND m.status = 'ACTIVE'
               AND e.role = 'Quản lý'
             LIMIT 1`,
            [telegramId, groupId]
        );
        return result.rows.length > 0;
    }

    async function findEmployeeName(client, telegramId) {
        const result = await client.query(
            'SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1',
            [telegramId]
        );
        return result.rows[0]?.full_name || null;
    }

    /** Bổ sung vào lịch cũ: đánh dấu đã đến, hết nợ ảnh, cập nhật thông tin buổi. */
    async function completeExistingAppointment(client, request) {
        await client.query(
            `UPDATE customer_appointments
             SET status = 'ARRIVED', is_photo_debt = FALSE, proof_image = $1,
                 revenue = $2, service = $3, sessions = $4, session_type = $5
             WHERE id = $6`,
            [
                request.proof_image, request.revenue, request.service,
                request.sessions, request.session_type, request.original_appointment_id
            ]
        );
    }

    /** Báo bù lịch chưa từng đăng ký: tạo lịch mới đã ở trạng thái hoàn tất. */
    async function insertApprovedAppointment(client, request) {
        const result = await client.query(
            `INSERT INTO customer_appointments (
                telegram_id, employee_name, group_id, customer_name, phone, service,
                sessions, session_type, revenue, appointment_time,
                is_reminded, status, is_photo_debt, proof_image
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, 'ARRIVED', FALSE, $11)
             RETURNING id`,
            [
                request.telegram_id, request.employee_name, request.telegram_group_id,
                request.customer_name, request.customer_phone, request.service,
                request.sessions, request.session_type, request.revenue,
                request.appointment_time, request.proof_image
            ]
        );
        return result.rows[0].id;
    }

    async function markApproved(client, { requestId, reviewer, appointmentId }) {
        await client.query(
            `UPDATE tour_makeup_requests
             SET status = 'APPROVED', reviewed_at = NOW(), reviewed_by = $1,
                 approved_appointment_id = $2
             WHERE id = $3`,
            [reviewer, appointmentId, requestId]
        );
    }

    async function markRejected(client, { requestId, reviewer }) {
        await client.query(
            `UPDATE tour_makeup_requests
             SET status = 'REJECTED', reviewed_at = NOW(), reviewed_by = $1
             WHERE id = $2`,
            [reviewer, requestId]
        );
    }

    return {
        lockRequest,
        lockAppointmentForUpdate,
        isGroupManager,
        findEmployeeName,
        completeExistingAppointment,
        insertApprovedAppointment,
        markApproved,
        markRejected,
        findEmployeeForGroup,
        listIncompleteAppointments,
        listRequestHistory,
        lockActiveGroup,
        lockGroupMember,
        lockAppointment,
        findBlockingRequest,
        findCompletedAppointment,
        insertRequest,
        markStatus
    };
}

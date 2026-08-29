/**
 * SQL của lịch khách (`customer_appointments`) và danh sách nhóm nhận thông báo
 * (`schedule_notification_groups`).
 *
 * Mọi truy vấn của phần đặt lịch nằm ở đây — tầng application không viết SQL.
 */

import { OVERLAP_MINUTES, SCHEDULE_NOTIFY_ROLES } from '../../domain/appointment-rules.js';

const SHORT_COLUMNS = `id, employee_name, customer_name, phone, service, sessions,
    session_type, today_incurred, doctor, nurse, revenue, appointment_time, status, cancel_reason`;

export function createAppointmentRepository({ pool }) {
    /* ---------- Đọc ---------- */

    /**
     * Lịch trong một ngày của một nhóm.
     * So sánh cả giờ Việt Nam lẫn giờ thô: dữ liệu cũ có bản ghi lưu chưa kèm
     * timezone, bỏ vế sau là mất lịch cũ khỏi danh sách.
     */
    async function findByDate(dateStr, groupId) {
        const result = await pool.query(
            `SELECT ${SHORT_COLUMNS}
             FROM customer_appointments
             WHERE (DATE(appointment_time AT TIME ZONE 'Asia/Ho_Chi_Minh') = $1::date
                    OR DATE(appointment_time) = $1::date)
               AND group_id = $2
             ORDER BY appointment_time ASC`,
            [dateStr, String(groupId)]
        );
        return result.rows;
    }

    /** Tìm theo SĐT; để trống SĐT thì trả lịch hôm nay. */
    async function searchByPhone(phone, groupId) {
        let query = `SELECT id, employee_name, customer_name, phone, service, sessions,
                            appointment_time, status, cancel_reason
                     FROM customer_appointments
                     WHERE phone ILIKE $1 AND group_id = $2`;

        if (!phone || phone.trim() === '') {
            query += ` AND (DATE(appointment_time AT TIME ZONE 'Asia/Ho_Chi_Minh') = CURRENT_DATE
                            OR DATE(appointment_time) = CURRENT_DATE)
                       ORDER BY appointment_time ASC`;
        } else {
            query += ' ORDER BY appointment_time DESC LIMIT 20';
        }

        const result = await pool.query(query, [`%${phone || ''}%`, groupId]);
        return result.rows;
    }

    async function findById(id) {
        const result = await pool.query('SELECT * FROM customer_appointments WHERE id = $1', [id]);
        return result.rows[0] || null;
    }

    async function findGroupIdOf(id) {
        const result = await pool.query(
            'SELECT group_id FROM customer_appointments WHERE id = $1', [id]);
        return result.rows.length > 0 ? { found: true, groupId: result.rows[0].group_id } : { found: false };
    }

    async function findOwnerOf(id) {
        const result = await pool.query(
            'SELECT telegram_id FROM customer_appointments WHERE id = $1', [id]);
        return result.rows[0] || null;
    }

    /** Lịch trùng khung giờ ±59 phút trong cùng nhóm; bỏ qua lịch đã hủy. */
    async function findOverlap(appointmentTime, groupId, excludeId = null) {
        const query = `
            SELECT id, employee_name, customer_name, appointment_time
            FROM customer_appointments
            WHERE status = 'ACTIVE'
              AND group_id = $2
              AND appointment_time BETWEEN ($1::timestamp - INTERVAL '${OVERLAP_MINUTES} minutes')
                                       AND ($1::timestamp + INTERVAL '${OVERLAP_MINUTES} minutes')
              ${excludeId ? 'AND id != $3' : ''}
            LIMIT 1`;
        const params = excludeId ? [appointmentTime, groupId, excludeId] : [appointmentTime, groupId];
        const result = await pool.query(query, params);
        return result.rows[0] || null;
    }

    /**
     * Lịch ACTIVE cùng SĐT trong cùng ngày — dùng riêng cho lịch "đi luôn", nhánh
     * vốn bỏ qua `findOverlap` (khách đã ở đó rồi) nên cần chặn kiểu trùng khác:
     * cùng một khách đã có lịch chưa xử lý, tránh tạo thêm bản ghi thứ hai cho
     * cùng một lượt khách đến.
     */
    async function findActiveByPhoneToday(phone, groupId, appointmentTime) {
        const result = await pool.query(
            `SELECT id, employee_name, customer_name, appointment_time
             FROM customer_appointments
             WHERE status = 'ACTIVE' AND group_id = $2 AND phone = $1
               AND DATE(appointment_time) = DATE($3::timestamp)
             LIMIT 1`,
            [phone, groupId, appointmentTime]
        );
        return result.rows[0] || null;
    }

    async function findEmployee(telegramId, groupId) {
        let result = await pool.query(
            'SELECT full_name, employee_code FROM employees WHERE telegram_id = $1 AND telegram_group_id = $2 LIMIT 1',
            [telegramId, groupId]
        );
        // Nhân viên có thể được đăng ký ở nhóm khác — vẫn cho đặt lịch, như bản cũ.
        if (result.rows.length === 0) {
            result = await pool.query(
                'SELECT full_name, employee_code FROM employees WHERE telegram_id = $1 LIMIT 1',
                [telegramId]
            );
        }
        return result.rows[0] || null;
    }

    async function findGroupRole(groupId) {
        const result = await pool.query(
            'SELECT bot_role FROM telegram_groups WHERE telegram_group_id = $1', [groupId]);
        return result.rows.length > 0 ? result.rows[0].bot_role : null;
    }

    /* ---------- Ghi ---------- */

    async function insert(appointment) {
        const result = await pool.query(
            `INSERT INTO customer_appointments
             (telegram_id, employee_name, group_id, customer_name, phone, service, sessions,
              session_type, revenue, today_incurred, doctor, nurse, appointment_time, is_reminded, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ACTIVE')
             RETURNING id`,
            [
                appointment.telegramId, appointment.employeeName, appointment.groupId,
                appointment.customerName, appointment.phone, appointment.service, appointment.sessions,
                appointment.sessionType, appointment.revenue, appointment.todayIncurred || null,
                appointment.doctor || null, appointment.nurse || null,
                appointment.appointmentTime, appointment.isReminded
            ]
        );
        return result.rows[0].id;
    }

    /** Cập nhật phát sinh trong ngày (không đụng giờ hẹn). */
    async function updateDetails(id, details) {
        const result = await pool.query(
            `UPDATE customer_appointments
             SET service = $1, revenue = $2, today_incurred = $3, doctor = $4, nurse = $5
             WHERE id = $6
             RETURNING *`,
            [details.service, details.revenue, details.todayIncurred || null,
             details.doctor || null, details.nurse || null, id]
        );
        return result.rows[0] || null;
    }

    /** Dời lịch: đặt lại is_reminded để cron nhắc lại theo giờ mới. */
    async function reschedule(id, groupId, changes) {
        const result = await pool.query(
            `UPDATE customer_appointments
             SET customer_name = $1, phone = $2, appointment_time = $3,
                 is_reminded = FALSE, status = 'ACTIVE'
             WHERE id = $4 AND group_id = $5
             RETURNING sheet_row_index, employee_name`,
            [changes.customerName, changes.phone, changes.appointmentTime, id, String(groupId)]
        );
        return result.rows[0] || null;
    }

    async function cancel(id, groupId, reason) {
        const result = await pool.query(
            `UPDATE customer_appointments
             SET status = 'CANCELLED', cancel_reason = $1
             WHERE id = $2 AND group_id = $3
             RETURNING sheet_row_index, employee_name`,
            [reason, id, String(groupId)]
        );
        return result.rows[0] || null;
    }

    /** Bấm "Đã đến": ghi luôn nợ ảnh, đó là căn cứ tính đủ công tour. */
    async function markArrived(id) {
        const result = await pool.query(
            `UPDATE customer_appointments
             SET status = 'ARRIVED', is_photo_debt = TRUE
             WHERE id = $1
             RETURNING sheet_row_index, employee_name, group_id`,
            [id]
        );
        return result.rows[0] || null;
    }

    async function cancelWithReason(id, reason) {
        const result = await pool.query(
            `UPDATE customer_appointments
             SET status = 'CANCELLED', cancel_reason = $1
             WHERE id = $2
             RETURNING sheet_row_index, employee_name, group_id`,
            [reason, id]
        );
        return result.rows[0] || null;
    }

    return {
        SCHEDULE_NOTIFY_ROLES,
        findByDate, searchByPhone, findById, findGroupIdOf, findOwnerOf, findOverlap, findActiveByPhoneToday,
        findEmployee, findGroupRole,
        insert, updateDetails, reschedule, cancel, markArrived, cancelWithReason
    };
}

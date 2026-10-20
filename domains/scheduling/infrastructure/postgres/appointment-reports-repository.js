/**
 * SQL phục vụ cron/báo cáo lịch khách: danh sách nhóm nhận thông báo, lịch
 * ngày mai/hôm nay/hôm qua, lịch tới giờ cần nhắc.
 *
 * Tách khỏi `appointment-repository.js` (giữ file đó dưới 300 dòng) — cùng
 * thao tác trên bảng `customer_appointments`, chỉ khác là các hàm ở đây được
 * gọi từ cron (`remind-due-appointments.js`, `schedule-reports.js`), không
 * phải từ luồng đặt/sửa lịch trực tiếp của nhân viên.
 */

export function createAppointmentReportsRepository({ pool }) {
    /**
     * Mô hình opt-out: mọi nhóm report/report_tour đều nhận, TRỪ nhóm đã tắt.
     * Nhóm chưa có dòng nào trong `schedule_notification_groups` vẫn nhận —
     * đó là lý do phải LEFT JOIN + COALESCE.
     */
    async function findNotifyGroups() {
        const result = await pool.query(`
            SELECT g.telegram_group_id AS group_id, g.bot_role
            FROM telegram_groups g
            LEFT JOIN schedule_notification_groups s ON s.group_id = g.telegram_group_id
            WHERE g.bot_role IN ('report', 'report_tour')
              AND g.is_active = true
              AND COALESCE(g.is_deleted, false) = false
              AND COALESCE(s.is_disabled, false) = false`);
        return result.rows;
    }

    /** Bản không opt-out, dùng cho báo động lịch đi luôn. */
    async function findUrgentTargetGroups() {
        const result = await pool.query(`
            SELECT s.group_id, g.bot_role
            FROM schedule_notification_groups s
            JOIN telegram_groups g ON s.group_id = g.telegram_group_id
            WHERE g.bot_role IN ('report', 'report_tour')
              AND g.is_active = true
              AND COALESCE(g.is_deleted, false) = false`);
        return result.rows;
    }

    async function findTourGroups() {
        const result = await pool.query(`
            SELECT g.telegram_group_id AS group_id
            FROM telegram_groups g
            WHERE g.bot_role = 'report_tour'
              AND g.is_active = true
              AND COALESCE(g.is_deleted, false) = false`);
        return result.rows;
    }

    async function findTomorrowOf(groupId) {
        const result = await pool.query(
            `SELECT *
             FROM customer_appointments
             WHERE DATE(appointment_time) = CURRENT_DATE + INTERVAL '1 day'
               AND status = 'ACTIVE' AND group_id = $1
             ORDER BY appointment_time ASC`,
            [groupId]
        );
        return result.rows;
    }

    async function findTodayOf(groupId) {
        const result = await pool.query(
            `SELECT *
             FROM customer_appointments
             WHERE DATE(appointment_time) = CURRENT_DATE AND group_id = $1
             ORDER BY appointment_time ASC`,
            [groupId]
        );
        return result.rows;
    }

    /** Lịch của hôm qua: tính theo NGÀY TẠO hoặc NGÀY HẸN, vì hai mốc có thể lệch nhau. */
    async function findYesterdayOf(groupId) {
        const result = await pool.query(
            `SELECT * FROM customer_appointments
             WHERE (DATE(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = CURRENT_DATE - INTERVAL '1 day'
                 OR DATE(appointment_time AT TIME ZONE 'Asia/Ho_Chi_Minh') = CURRENT_DATE - INTERVAL '1 day')
               AND group_id = $1
             ORDER BY appointment_time ASC`,
            [groupId]
        );
        return result.rows;
    }

    /** Lịch tới giờ mà chưa nhắc, cửa sổ ±1 phút quanh thời điểm quét. */
    async function findDueForReminder() {
        const result = await pool.query(
            `SELECT *
             FROM customer_appointments
             WHERE (is_reminded = FALSE OR is_reminded IS NULL) AND status = 'ACTIVE'
               AND appointment_time BETWEEN (NOW() - INTERVAL '1 minute') AND (NOW() + INTERVAL '1 minute')`
        );
        return result.rows;
    }

    async function markReminded(id) {
        await pool.query('UPDATE customer_appointments SET is_reminded = TRUE WHERE id = $1', [id]);
    }

    /** Chuẩn hoá "500,000đ" thành "500000" sau khi tổng hợp công tour. */
    async function normalizeRevenue(id, revenue) {
        await pool.query('UPDATE customer_appointments SET revenue = $1 WHERE id = $2',
            [String(revenue), id]).catch(() => { });
    }

    return {
        findNotifyGroups, findUrgentTargetGroups, findTourGroups,
        findTomorrowOf, findTodayOf, findYesterdayOf, findDueForReminder,
        markReminded, normalizeRevenue
    };
}

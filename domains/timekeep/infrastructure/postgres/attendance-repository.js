/**
 * SQL đọc cho bảng điều khiển chấm công (Web Admin).
 *
 * Chỉ đọc — bảng điều khiển không được ghi gì.
 */

export function createAttendanceRepository({ pool }) {
    async function listGroups() {
        const result = await pool.query(
            'SELECT id, telegram_group_id, group_name FROM telegram_groups ORDER BY created_at ASC'
        );
        return result.rows;
    }

    /**
     * Nhân sự kèm lịch, check-in và tiền phạt của MỘT ngày.
     *
     * `$1 IS NULL` nghĩa là xem tất cả nhóm. Dùng LEFT JOIN cho lịch/check-in/phạt
     * vì người chưa có lịch hoặc chưa check-in vẫn phải xuất hiện trong danh sách —
     * đó chính là thông tin quản lý cần thấy.
     */
    async function listEmployeesOfDay(groupId, date) {
        const result = await pool.query(`
            SELECT
                u.id AS user_id,
                u.full_name,
                u.telegram_id,
                u.role,
                s.id AS schedule_id,
                s.shift_type,
                ci.id AS checkin_id,
                ci.check_in_time,
                ci.status AS checkin_status,
                COALESCE(p.late_minutes, 0) AS late_minutes,
                COALESCE(p.amount, 0) AS penalty_amount
            FROM employees u
            JOIN telegram_groups tg ON u.telegram_group_id = tg.telegram_group_id
            LEFT JOIN tk_schedules s ON s.user_id = u.id AND s.date = $2
            LEFT JOIN tk_check_ins ci ON ci.user_id = u.id AND ci.date = $2
            LEFT JOIN tk_penalties p ON p.user_id = u.id AND p.date = $2 AND p.violation_type = 'LATE'
            WHERE ($1::uuid IS NULL OR tg.id = $1)
              AND u.is_active = TRUE
            ORDER BY u.full_name ASC
        `, [groupId, date]);
        return result.rows;
    }

    /** Số liệu cả tuần: tổng lượt check-in, số lượt muộn, tổng tiền phạt. */
    async function weeklyStats(groupId, weekStart, weekEnd) {
        const result = await pool.query(`
            SELECT
                COUNT(*) AS total_checkins,
                SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) AS late_count,
                COALESCE(SUM(p2.amount), 0) AS penalty_total
            FROM tk_check_ins ci
            LEFT JOIN tk_penalties p ON p.user_id = ci.user_id AND p.date = ci.date AND p.violation_type = 'LATE'
            LEFT JOIN tk_penalties p2 ON p2.user_id = ci.user_id AND p2.date >= $2 AND p2.date <= $3 AND p2.violation_type = 'LATE'
            WHERE ($1::uuid IS NULL OR ci.group_id = $1)
              AND ci.date >= $2 AND ci.date <= $3
        `, [groupId, weekStart, weekEnd]);
        return result.rows[0];
    }

    /* ---------- Dữ liệu cho bản xuất Sheet cuối ngày ---------- */

    // Chạy tuần tự đúng như bản cũ: bản xuất này chạy lúc 23:00, không cần nhanh,
    // và giữ nguyên thứ tự thì không chiếm bốn kết nối pool cùng lúc.
    async function exportRowsOfDay(dateStr) {
        const settings = await pool.query('SELECT * FROM group_settings');
        const checkins = await pool.query('SELECT * FROM tk_check_ins WHERE date = $1', [dateStr]);
        const penalties = await pool.query('SELECT * FROM tk_penalties WHERE date = $1', [dateStr]);
        const leaves = await pool.query('SELECT * FROM tk_leave_requests WHERE date = $1', [dateStr]);
        return {
            settings: settings.rows,
            checkins: checkins.rows,
            penalties: penalties.rows,
            leaves: leaves.rows
        };
    }

    return { listGroups, listEmployeesOfDay, weeklyStats, exportRowsOfDay };
}

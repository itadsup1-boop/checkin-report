/**
 * SQL của lịch trực (`tk_schedules`) và cờ mở/đóng đăng ký lịch tuần.
 */

export function createScheduleRepository({ pool }) {
    /** Người bấm nút cùng cờ đăng ký của nhóm — một truy vấn cho cả hai. */
    async function findCallerWithFlag(telegramId, chatId) {
        const result = await pool.query(
            `SELECT u.role, g.id AS group_id, g.schedule_registration_open
             FROM employees u
             JOIN telegram_groups g ON u.group_id = g.id
             WHERE u.telegram_id = $1 AND g.telegram_group_id = $2`,
            [telegramId, chatId]
        );
        return result.rows[0] || null;
    }

    async function setRegistrationOpen(groupId, isOpen) {
        await pool.query(
            'UPDATE telegram_groups SET schedule_registration_open = $1 WHERE id = $2',
            [isOpen, groupId]
        );
    }

    /* ---------- Quản trị lịch trực từ Web Admin ---------- */

    // `date::text` để Postgres không trả về Date của JS rồi bị lệch múi giờ khi
    // serialize sang JSON — Web Admin cần đúng chuỗi YYYY-MM-DD.
    const SCHEDULE_COLUMNS = `id, group_id, user_id, date::text AS date, shift_type,
        is_locked, created_at, proof_url, updated_by, updated_at`;

    async function updateShift(scheduleId, shiftType) {
        const result = await pool.query(
            `UPDATE tk_schedules
             SET shift_type = $1, updated_by = 'admin', updated_at = NOW()
             WHERE id = $2
             RETURNING ${SCHEDULE_COLUMNS}`,
            [shiftType, scheduleId]
        );
        return result.rows[0] || null;
    }

    /** Nhóm của nhân sự, để ghi kèm vào lịch Admin tạo tay. */
    async function findGroupIdOfEmployee(userId) {
        const result = await pool.query(
            `SELECT tg.id AS group_id
             FROM employees u
             JOIN telegram_groups tg ON u.telegram_group_id = tg.telegram_group_id
             WHERE u.id = $1`,
            [userId]
        );
        return result.rows[0]?.group_id || null;
    }

    /** Một nhân sự chỉ có một ca mỗi ngày — trùng thì ghi đè, không tạo dòng thứ hai. */
    async function upsertSchedule({ groupId, userId, date, shiftType }) {
        const result = await pool.query(
            `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, false, 'admin', NOW())
             ON CONFLICT (user_id, date)
             DO UPDATE SET shift_type = $4, updated_by = 'admin', updated_at = NOW()
             RETURNING ${SCHEDULE_COLUMNS}`,
            [groupId, userId, date, shiftType]
        );
        return result.rows[0];
    }

    async function deleteSchedule(scheduleId) {
        const result = await pool.query(
            `DELETE FROM tk_schedules WHERE id = $1 RETURNING ${SCHEDULE_COLUMNS}`,
            [scheduleId]
        );
        return result.rows[0] || null;
    }

    return {
        findCallerWithFlag, setRegistrationOpen,
        updateShift, findGroupIdOfEmployee, upsertSchedule, deleteSchedule
    };
}

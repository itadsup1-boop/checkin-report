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

    async function findTelegramGroupIdOfSchedule(scheduleId) {
        const result = await pool.query(
            `SELECT tg.telegram_group_id
             FROM tk_schedules schedule
             JOIN telegram_groups tg ON tg.id = schedule.group_id
             WHERE schedule.id = $1`,
            [scheduleId]
        );
        return result.rows[0]?.telegram_group_id || null;
    }

    async function findTelegramGroupIdOfEmployee(userId) {
        const result = await pool.query(
            `SELECT tg.telegram_group_id
             FROM employees employee
             JOIN telegram_groups tg ON tg.id = employee.group_id
             WHERE employee.id = $1`,
            [userId]
        );
        return result.rows[0]?.telegram_group_id || null;
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

    /* ---------- Mini App "Đăng ký lịch tuần" ---------- */

    async function findGroupByTelegramGroupId(telegramGroupId) {
        const result = await pool.query(
            'SELECT * FROM telegram_groups WHERE telegram_group_id = $1 LIMIT 1',
            [telegramGroupId]
        );
        return result.rows[0] || null;
    }

    async function findGroupRegistrationFlag(groupId) {
        const result = await pool.query(
            'SELECT schedule_registration_open FROM telegram_groups WHERE id = $1 LIMIT 1',
            [groupId]
        );
        return result.rows[0]?.schedule_registration_open ?? true;
    }

    async function findEmployeeById(id) {
        const result = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
        return result.rows[0] || null;
    }

    async function findSchedulesInRange(userId, fromDate, toDate) {
        const result = await pool.query(
            `SELECT date::text, shift_type, is_locked, proof_url, updated_by, updated_at
             FROM tk_schedules
             WHERE user_id = $1 AND date >= $2 AND date <= $3`,
            [userId, fromDate, toDate]
        );
        return result.rows;
    }

    async function findGroupSchedulesInRange(groupId, fromDate, toDate) {
        const result = await pool.query(
            `SELECT s.date::text, s.shift_type, u.id as user_id, u.full_name, u.role
             FROM tk_schedules s
             JOIN employees u ON s.user_id = u.id
             WHERE s.group_id = $1 AND s.date >= $2 AND s.date <= $3`,
            [groupId, fromDate, toDate]
        );
        return result.rows;
    }

    async function findGroupEmployees(groupId) {
        const result = await pool.query(
            'SELECT id, full_name, role, telegram_id FROM employees WHERE group_id = $1 ORDER BY full_name ASC',
            [groupId]
        );
        return result.rows;
    }

    async function isManager(telegramId) {
        const result = await pool.query(
            "SELECT 1 FROM employees WHERE telegram_id = $1 AND role IN ('Quản lý', 'Quản lý kho') LIMIT 1",
            [telegramId]
        );
        return result.rows.length > 0;
    }

    /** Ai khác đã đăng ký OFF cùng ngày, cùng vai trò — chặn cả nhóm cùng vị trí nghỉ trùng ngày. */
    async function findOffOverlap(groupId, date, role, excludeUserId) {
        const result = await pool.query(
            `SELECT u.full_name
             FROM tk_schedules s
             JOIN employees u ON s.user_id = u.id
             WHERE s.group_id = $1 AND s.date = $2 AND s.shift_type = 'OFF' AND u.role = $3 AND u.id != $4`,
            [groupId, date, role, excludeUserId]
        );
        return result.rows[0] || null;
    }

    async function findExistingShiftsForDates(userId, dates) {
        const result = await pool.query(
            'SELECT date::text, shift_type FROM tk_schedules WHERE user_id = $1 AND date = ANY($2::date[])',
            [userId, dates]
        );
        const map = {};
        result.rows.forEach(row => { map[row.date] = row.shift_type; });
        return map;
    }

    /** Ghi đè một ngày, ba biến thể khác nhau ở cách xử lý cột updated_by/updated_at. */
    async function upsertScheduleDay({ groupId, userId, date, shiftType, isLocked, proofUrl, adminName, modifiedAt, clearAdminTracking }) {
        if (adminName) {
            await pool.query(
                `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked, proof_url, updated_by, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (user_id, date)
                 DO UPDATE SET shift_type = EXCLUDED.shift_type,
                               is_locked = EXCLUDED.is_locked,
                               proof_url = COALESCE(EXCLUDED.proof_url, tk_schedules.proof_url),
                               updated_by = EXCLUDED.updated_by,
                               updated_at = EXCLUDED.updated_at`,
                [groupId, userId, date, shiftType, isLocked, proofUrl, adminName, modifiedAt]
            );
        } else if (clearAdminTracking) {
            await pool.query(
                `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked, proof_url, updated_by, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)
                 ON CONFLICT (user_id, date)
                 DO UPDATE SET shift_type = EXCLUDED.shift_type,
                               is_locked = EXCLUDED.is_locked,
                               proof_url = COALESCE(EXCLUDED.proof_url, tk_schedules.proof_url),
                               updated_by = NULL,
                               updated_at = NULL`,
                [groupId, userId, date, shiftType, isLocked, proofUrl]
            );
        } else {
            await pool.query(
                `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked, proof_url)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (user_id, date)
                 DO UPDATE SET shift_type = EXCLUDED.shift_type,
                               is_locked = EXCLUDED.is_locked,
                               proof_url = COALESCE(EXCLUDED.proof_url, tk_schedules.proof_url)`,
                [groupId, userId, date, shiftType, isLocked, proofUrl]
            );
        }
    }

    async function findTelegramGroupId(groupId) {
        const result = await pool.query('SELECT telegram_group_id FROM telegram_groups WHERE id = $1', [groupId]);
        return result.rows[0]?.telegram_group_id || null;
    }

    async function cancelPendingScheduleChangeRequests(userId, weekStartDate) {
        await pool.query(
            `UPDATE tk_leave_requests
             SET status = 'CANCELLED'
             WHERE user_id = $1 AND request_type = 'SCHEDULE_CHANGE' AND date = $2 AND status = 'PENDING'`,
            [userId, weekStartDate]
        );
    }

    async function insertScheduleChangeRequest({ groupId, userId, weekStartDate, daysJson, proofUrl }) {
        const result = await pool.query(
            `INSERT INTO tk_leave_requests (group_id, user_id, request_type, late_minutes, date, reason, proof_url, status)
             VALUES ($1, $2, 'SCHEDULE_CHANGE', 0, $3, $4, $5, 'PENDING')
             RETURNING id`,
            [groupId, userId, weekStartDate, daysJson, proofUrl]
        );
        return result.rows[0].id;
    }

    return {
        findCallerWithFlag, setRegistrationOpen,
        updateShift, findGroupIdOfEmployee, findTelegramGroupIdOfSchedule,
        findTelegramGroupIdOfEmployee, upsertSchedule, deleteSchedule,
        findGroupByTelegramGroupId, findGroupRegistrationFlag, findEmployeeById,
        findSchedulesInRange, findGroupSchedulesInRange, findGroupEmployees, isManager,
        findOffOverlap, findExistingShiftsForDates, upsertScheduleDay,
        findTelegramGroupId, cancelPendingScheduleChangeRequests, insertScheduleChangeRequest
    };
}

/**
 * SQL của nhân sự và nhóm khi đăng ký tài khoản chấm công.
 */

export function createEmployeeRepository({ pool }) {
    async function findGroup(telegramGroupId) {
        const result = await pool.query(
            'SELECT * FROM telegram_groups WHERE telegram_group_id = $1',
            [telegramGroupId]
        );
        return result.rows[0] || null;
    }

    /** Nhóm chưa có trong bảng thì tạo mới với tên tạm — Admin đổi tên sau. */
    async function createGroup(telegramGroupId) {
        const result = await pool.query(
            'INSERT INTO telegram_groups (telegram_group_id, group_name) VALUES ($1, $2) RETURNING *',
            [telegramGroupId, 'Nhóm làm việc']
        );
        return result.rows[0];
    }

    async function findByTelegramIdInGroup(groupId, telegramId) {
        const result = await pool.query(
            'SELECT id FROM employees WHERE group_id = $1 AND telegram_id = $2',
            [groupId, telegramId]
        );
        return result.rows[0] || null;
    }

    async function lockByTelegramIdInGroup(client, groupId, telegramId) {
        const result = await client.query(
            `SELECT * FROM employees
             WHERE group_id = $1 AND telegram_id = $2
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE`,
            [groupId, String(telegramId)]
        );
        return result.rows[0] || null;
    }

    /**
     * Hồ sơ Admin tạo sẵn nhưng chưa gắn Telegram, khớp theo TÊN trong cùng nhóm.
     * Ưu tiên liên kết vào hồ sơ này thay vì tạo mới, nếu không nhân sự sẽ có hai
     * bản ghi và số liệu chấm công bị tách đôi.
     */
    async function findUnlinkedByName(groupId, fullName) {
        const result = await pool.query(
            `SELECT id FROM employees
             WHERE group_id = $1
               AND LOWER(TRIM(full_name)) = LOWER(TRIM($2))
               AND (telegram_id IS NULL OR telegram_id = '')
             ORDER BY id ASC
             LIMIT 1`,
            [groupId, fullName]
        );
        return result.rows[0] || null;
    }

    /**
     * Đăng ký trùng tên với hồ sơ có sẵn (chưa gắn Telegram) — KHÔNG gắn ngay,
     * chỉ lưu tạm ở các cột pending_* chờ Admin xác nhận đúng người. `db` nhận
     * cả `pool` (nhánh nhóm thường) lẫn `client` trong transaction (nhánh KPI).
     */
    async function setPendingRegistration(db, employeeId, data) {
        const result = await db.query(
            `UPDATE employees
             SET pending_telegram_id = $1,
                 pending_telegram_username = $2,
                 pending_role = $3,
                 pending_telegram_group_id = $4,
                 pending_requested_at = NOW(),
                 pending_is_new_profile = FALSE
             WHERE id = $5
               AND (pending_telegram_id IS NULL OR pending_telegram_id = $1)
             RETURNING *`,
            [String(data.telegramId), data.telegramUsername || '', data.role, data.telegramGroupId || null, employeeId]
        );
        return result.rows[0] || null;
    }

    /** Một Telegram chỉ được có một yêu cầu chờ trong cùng nhóm. */
    async function lockPendingByTelegramInGroup(client, telegramId, telegramGroupId) {
        const result = await client.query(
            `SELECT * FROM employees
             WHERE pending_telegram_id = $1
               AND pending_telegram_group_id = $2
             ORDER BY pending_requested_at ASC
             LIMIT 1
             FOR UPDATE`,
            [String(telegramId), String(telegramGroupId)]
        );
        return result.rows[0] || null;
    }

    /**
     * Chưa có hồ sơ Admin tạo sẵn: tạo một hồ sơ bất hoạt chỉ để chứa yêu cầu.
     * Telegram ID và vai trò thật vẫn để trống cho tới khi Admin duyệt.
     */
    async function insertPendingEmployee(client, groupId, data, { isKpiGroup = false } = {}) {
        const result = await client.query(
            `INSERT INTO employees
                (group_id, telegram_group_id, telegram_id, telegram_username,
                 full_name, role, employee_code, department, position, is_active,
                 pending_telegram_id, pending_telegram_username, pending_role,
                 pending_telegram_group_id, pending_requested_at, pending_is_new_profile)
             VALUES ($1, $2, NULL, '', $3, NULL, $4, $5, $6, FALSE,
                     $7, $8, $9, $10, NOW(), TRUE)
             RETURNING *`,
            [
                groupId,
                isKpiGroup ? null : data.telegramGroupId,
                data.fullName,
                data.employeeCode,
                'Chưa xếp',
                'Nhân viên',
                String(data.telegramId),
                data.telegramUsername || '',
                data.role,
                data.telegramGroupId
            ]
        );
        return result.rows[0];
    }

    async function createRegistrationRequest(client, employee, data, { isNewProfile }) {
        const result = await client.query(
            `INSERT INTO employee_registration_requests
                (suggested_employee_id, telegram_id, telegram_username, telegram_group_id,
                 requested_full_name, requested_role, status, is_new_profile)
             VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)
             RETURNING *`,
            [
                employee.id,
                String(data.telegramId),
                data.telegramUsername || '',
                data.telegramGroupId,
                data.fullName,
                data.role,
                isNewProfile
            ]
        );
        return result.rows[0];
    }

    async function findPendingRegistrationById(employeeId) {
        const result = await pool.query(
            `SELECT * FROM employees WHERE id = $1 AND pending_telegram_id IS NOT NULL`,
            [employeeId]
        );
        return result.rows[0] || null;
    }

    /** Toàn bộ đăng ký đang chờ Admin duyệt, cũ nhất trước. */
    async function findPendingRegistrations() {
        const result = await pool.query(
            `SELECT e.*, tg.group_name AS pending_group_name
             FROM employees e
             LEFT JOIN telegram_groups tg
                 ON tg.telegram_group_id = COALESCE(e.pending_telegram_group_id, e.telegram_group_id)
             WHERE e.pending_telegram_id IS NOT NULL
             ORDER BY e.pending_requested_at ASC`
        );
        return result.rows;
    }

    /** Admin từ chối — chỉ xoá yêu cầu chờ, hồ sơ gốc giữ nguyên để người đúng đăng ký lại sau. */
    async function clearPendingRegistration(employeeId) {
        await pool.query(
            `UPDATE employees
             SET pending_telegram_id = NULL, pending_telegram_username = NULL,
                 pending_role = NULL, pending_telegram_group_id = NULL, pending_requested_at = NULL,
                 pending_is_new_profile = FALSE
             WHERE id = $1`,
            [employeeId]
        );
    }

    /** Admin duyệt — gắn thật Telegram vào hồ sơ, xoá cờ chờ. */
    async function finalizeApprovedRegistration(client, employeeId, { telegramId, telegramUsername, role, telegramGroupId }) {
        const result = await client.query(
            `UPDATE employees
             SET telegram_id = $1,
                 telegram_username = $2,
                 role = COALESCE(NULLIF(role, ''), $3),
                 telegram_group_id = COALESCE($4, telegram_group_id),
                 is_active = true,
                 pending_telegram_id = NULL,
                 pending_telegram_username = NULL,
                 pending_role = NULL,
                 pending_telegram_group_id = NULL,
                 pending_requested_at = NULL,
                 pending_is_new_profile = FALSE
             WHERE id = $5
             RETURNING *`,
            [telegramId, telegramUsername || '', role, telegramGroupId || null, employeeId]
        );
        return result.rows[0] || null;
    }

    /* ---------- Nhánh nhóm KPI: tài khoản toàn cục + membership từng nhóm ---------- */

    /** `FOR UPDATE` để hai lần đăng ký cùng lúc không tạo hai hồ sơ. */
    async function lockGlobalEmployee(client, telegramId) {
        const result = await client.query(
            'SELECT * FROM employees WHERE telegram_id = $1 ORDER BY created_at ASC LIMIT 1 FOR UPDATE',
            [String(telegramId)]
        );
        return result.rows[0] || null;
    }

    async function lockUnlinkedByName(client, groupId, fullName) {
        const result = await client.query(
            `SELECT * FROM employees
             WHERE group_id = $1
               AND LOWER(TRIM(full_name)) = LOWER(TRIM($2))
               AND (telegram_id IS NULL OR telegram_id = '')
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE`,
            [groupId, fullName]
        );
        return result.rows[0] || null;
    }

    return {
        findGroup, createGroup, findByTelegramIdInGroup, lockByTelegramIdInGroup, findUnlinkedByName,
        setPendingRegistration, lockPendingByTelegramInGroup, insertPendingEmployee, createRegistrationRequest,
        findPendingRegistrationById, findPendingRegistrations,
        clearPendingRegistration, finalizeApprovedRegistration,
        lockGlobalEmployee, lockUnlinkedByName
    };
}

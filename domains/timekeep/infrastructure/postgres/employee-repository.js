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

    async function linkExisting(employeeId, data) {
        await pool.query(
            `UPDATE employees
             SET telegram_group_id = $1,
                 telegram_id = $2,
                 telegram_username = $3,
                 role = COALESCE(NULLIF(role, ''), $4),
                 is_active = true
             WHERE id = $5`,
            [data.telegramGroupId, data.telegramId, data.telegramUsername || '', data.role, employeeId]
        );
    }

    async function insertEmployee(groupId, data) {
        await pool.query(
            `INSERT INTO employees
                (group_id, telegram_group_id, telegram_id, telegram_username,
                 full_name, role, employee_code, department, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                groupId, data.telegramGroupId, data.telegramId, data.telegramUsername || '',
                data.fullName, data.role, data.employeeCode, 'Chưa xếp', 'Nhân viên'
            ]
        );
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

    async function attachTelegramToEmployee(client, employeeId, data) {
        const result = await client.query(
            `UPDATE employees
             SET telegram_id = $1, telegram_username = $2,
                 full_name = $3, role = COALESCE(NULLIF(role, ''), $4)
             WHERE id = $5
             RETURNING *`,
            [String(data.telegramId), data.telegramUsername || '', data.fullName, data.role, employeeId]
        );
        return result.rows[0];
    }

    /**
     * Hồ sơ KPI mới: `telegram_group_id` để NULL vì nhóm được quản lý qua bảng
     * membership riêng, không gắn cứng vào nhân sự.
     */
    async function insertKpiEmployee(client, groupId, data) {
        const result = await client.query(
            `INSERT INTO employees
                (group_id, telegram_group_id, telegram_id, telegram_username,
                 full_name, role, employee_code, department, position,
                 current_kpi_target, need_report, is_active)
             VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, 40, TRUE, TRUE)
             RETURNING *`,
            [
                groupId, String(data.telegramId), data.telegramUsername || '',
                data.fullName, data.role, data.employeeCode, 'Chưa xếp', 'Nhân viên'
            ]
        );
        return result.rows[0];
    }

    return {
        findGroup, createGroup, findByTelegramIdInGroup, findUnlinkedByName,
        linkExisting, insertEmployee,
        lockGlobalEmployee, lockUnlinkedByName, attachTelegramToEmployee, insertKpiEmployee
    };
}

/**
 * SQL của 5 cron nhắc đăng ký lịch tuần vào Chủ Nhật.
 */
export function createSundayReminderRepository({ pool }) {
    async function findActiveTimekeepGroups() {
        const result = await pool.query(`
            SELECT id, telegram_group_id, group_name
            FROM telegram_groups
            WHERE bot_role = 'timekeep' AND is_active = true AND COALESCE(is_deleted, false) = false
        `);
        return result.rows;
    }

    /** Nhân sự trong nhóm chưa có bất kỳ lịch nào cho tuần tới. */
    async function findUnregisteredStaff(telegramGroupId, fromDate, toDate) {
        const result = await pool.query(`
            SELECT e.id, e.full_name, e.telegram_id, e.telegram_username
            FROM employees e
            LEFT JOIN employee_group_memberships gm
              ON gm.employee_id = e.id AND gm.telegram_group_id = $1
            WHERE e.telegram_group_id = $1
              AND e.is_active = true
              AND COALESCE(gm.status, 'ACTIVE') = 'ACTIVE'
              AND e.full_name NOT LIKE '/%'
              AND e.full_name != 'tester'
              AND NOT EXISTS (
                  SELECT 1 FROM tk_schedules s
                  WHERE s.user_id = e.id AND s.date >= $2::date AND s.date <= $3::date
              )
        `, [telegramGroupId, fromDate, toDate]);
        return result.rows;
    }

    async function insertAutoAssignedShift(groupId, userId, date) {
        await pool.query(`
            INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked, updated_by)
            VALUES ($1, $2, $3, 'CA_SANG', true, 'Hệ thống tự động')
            ON CONFLICT (user_id, date)
            DO UPDATE SET shift_type = 'CA_SANG', is_locked = true, updated_by = 'Hệ thống tự động', updated_at = NOW()
        `, [groupId, userId, date]);
    }

    async function closeScheduleRegistration(groupId) {
        await pool.query('UPDATE telegram_groups SET schedule_registration_open = false WHERE id = $1', [groupId]);
    }

    return { findActiveTimekeepGroups, findUnregisteredStaff, insertAutoAssignedShift, closeScheduleRegistration };
}

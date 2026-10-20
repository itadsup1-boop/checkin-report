/**
 * SQL của 5 cron nhắc đăng ký lịch tuần vào Chủ Nhật.
 */
export function createSundayReminderRepository({ pool }) {
    /** Lấy tất cả nhóm có role = timekeep đang hoạt động */
    async function findActiveTimekeepGroups() {
        const result = await pool.query(`
            SELECT id, telegram_group_id, group_name, schedule_registration_open
            FROM telegram_groups
            WHERE bot_role = 'timekeep' 
              AND is_active = true 
              AND COALESCE(is_deleted, false) = false
              AND telegram_group_id != '-5321152019'
            ORDER BY group_name ASC
        `);
        return result.rows;
    }

    async function autoSeedSpecialEmployeesWeeklySchedules(fromDate, toDate) {
        const dinhNgocId = 'dc286880-c850-4740-8db0-ee700db216e8';
        const groupId = '7cdb911f-5e2b-441f-adc9-75a5c8793176';
        try {
            await pool.query(`
                INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked, updated_by)
                SELECT 
                    $1, 
                    $2, 
                    d.date::date, 
                    CASE WHEN EXTRACT(DOW FROM d.date) = 0 THEN 'OFF' ELSE 'CA_9_17' END, 
                    true, 
                    'Hệ thống tự động'
                FROM generate_series($3::date, $4::date, '1 day'::interval) d(date)
                ON CONFLICT (user_id, date) DO UPDATE SET
                    shift_type = CASE WHEN EXTRACT(DOW FROM EXCLUDED.date) = 0 THEN 'OFF' ELSE 'CA_9_17' END,
                    is_locked = true,
                    updated_by = 'Hệ thống tự động'
                WHERE tk_schedules.updated_by = 'Hệ thống tự động' OR tk_schedules.shift_type IN ('CA_SANG', 'CA_9_17', 'OFF')
            `, [groupId, dinhNgocId, fromDate, toDate]);
        } catch (err) {
            console.error('[Auto Seed Special Schedules Err]:', err.message);
        }
    }

    /** Nhân sự trong nhóm chưa đăng ký đủ lịch cho cả 7 ngày tuần tới. */
    async function findUnregisteredStaff(telegramGroupId, fromDate, toDate) {
        await autoSeedSpecialEmployeesWeeklySchedules(fromDate, toDate);
        const result = await pool.query(`
            SELECT e.id, e.full_name, e.telegram_id, e.telegram_username
            FROM employees e
            LEFT JOIN employee_group_memberships gm
              ON gm.employee_id = e.id AND gm.telegram_group_id = $1
            LEFT JOIN tk_schedules s
              ON s.user_id = e.id AND s.date >= $2::date AND s.date <= $3::date
            WHERE (e.telegram_group_id = $1 OR gm.telegram_group_id = $1)
              AND e.is_active = true
              AND COALESCE(gm.status, 'ACTIVE') = 'ACTIVE'
              AND e.full_name NOT LIKE '/%'
              AND e.full_name != 'tester'
            GROUP BY e.id, e.full_name, e.telegram_id, e.telegram_username
            HAVING COUNT(s.id) < 7
            ORDER BY e.full_name ASC
        `, [telegramGroupId, fromDate, toDate]);
        return result.rows;
    }

    async function insertAutoAssignedShift(groupId, userId, date) {
        await pool.query(`
            INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked, updated_by)
            VALUES ($1, $2, $3, 'CA_SANG', true, 'Hệ thống tự động')
            ON CONFLICT (user_id, date) DO NOTHING
        `, [groupId, userId, date]);
    }

    async function closeScheduleRegistration(groupId) {
        await pool.query('UPDATE telegram_groups SET schedule_registration_open = false WHERE id = $1', [groupId]);
    }

    async function openScheduleRegistrationForAll() {
        await pool.query(`
            UPDATE telegram_groups
            SET schedule_registration_open = true
            WHERE bot_role = 'timekeep'
              AND is_active = true
              AND COALESCE(is_deleted, false) = false
              AND telegram_group_id != '-5321152019'
        `);
    }

    return {
        findActiveTimekeepGroups,
        findUnregisteredStaff,
        insertAutoAssignedShift,
        closeScheduleRegistration,
        openScheduleRegistrationForAll,
        autoSeedSpecialEmployeesWeeklySchedules
    };
}



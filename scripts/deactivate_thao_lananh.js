import 'dotenv/config';
import pool from '../packages/database/index.js';
import { syncAllTimekeepSheets } from '../apps/bot/syncTimekeepSheets.js';

async function run() {
    const empIds = [
        'fd354df2-66aa-49d8-99c3-cc8bdf2c3381', // Thảo
        'e8eb3d95-a7b9-4ca5-a8cc-403b3b21cc5c'  // Nguyễn Lan Anh
    ];

    console.log('--- 1. DEACTIVATING EMPLOYEES ---');
    for (const empId of empIds) {
        const empRes = await pool.query(
            `UPDATE employees 
             SET is_active = FALSE, is_exempt_checkin = TRUE, need_report = FALSE 
             WHERE id = $1 
             RETURNING id, full_name, telegram_id, is_active, is_exempt_checkin, need_report`,
            [empId]
        );
        console.log('Updated employee:', empRes.rows[0]);

        const memRes = await pool.query(
            `UPDATE employee_group_memberships 
             SET status = 'PAUSED', pause_reason = 'Admin vô hiệu hóa', paused_at = NOW(), updated_at = NOW() 
             WHERE employee_id = $1 
             RETURNING *`,
            [empId]
        );
        console.log(`Paused ${memRes.rowCount} memberships for:`, empRes.rows[0]?.full_name);

        await pool.query(
            `INSERT INTO employee_group_membership_events
                (employee_id, telegram_group_id, old_status, new_status, reason, actor)
             SELECT employee_id, telegram_group_id, 'ACTIVE', 'PAUSED', 'Admin vô hiệu hóa', 'admin:system'
             FROM employee_group_memberships
             WHERE employee_id = $1`,
            [empId]
        );

        if (empRes.rows[0]?.telegram_id) {
            await pool.query('DELETE FROM pending_reports WHERE telegram_id = $1', [String(empRes.rows[0].telegram_id)]);
        }

        // Clean schedules and daily status today and future
        const delSched = await pool.query('DELETE FROM tk_schedules WHERE user_id = $1 AND date >= $2', [empId, '2026-09-27']);
        console.log(`Deleted ${delSched.rowCount} schedules >= 2026-09-27 for ${empRes.rows[0]?.full_name}`);

        const delStatus = await pool.query('DELETE FROM tk_attendance_daily_status WHERE user_id = $1 AND date = $2', [empId, '2026-09-27']);
        console.log(`Deleted ${delStatus.rowCount} daily status on 2026-09-27 for ${empRes.rows[0]?.full_name}`);

        const delPenalties = await pool.query('DELETE FROM tk_penalties WHERE user_id = $1 AND date = $2', [empId, '2026-09-27']);
        console.log(`Deleted ${delPenalties.rowCount} penalties on 2026-09-27 for ${empRes.rows[0]?.full_name}`);
    }

    console.log('--- 2. DISABLE AUTO REMINDER FOR GROUP -5589101669 ---');
    const updateGs = await pool.query(
        `UPDATE group_settings 
         SET auto_reminder_enabled = FALSE, updated_at = NOW() 
         WHERE telegram_group_id = '-5589101669' 
         RETURNING telegram_group_id, auto_reminder_enabled, attendance_policy`
    );
    console.log('Updated group_settings:', updateGs.rows[0]);

    console.log('--- 3. SYNC TIMEKEEP SHEETS ---');
    try {
        await syncAllTimekeepSheets();
        console.log('Sheets synced successfully.');
    } catch (e) {
        console.error('Error syncing sheets:', e.message);
    }

    await pool.end();
    console.log('DONE ALL DEACTIVATIONS & CONFIG!');
}

run();

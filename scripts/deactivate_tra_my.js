import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        const empId = '07c75a31-2623-4a25-b62c-796f5651f53f';
        
        // 1. Update employee: is_active = FALSE, is_exempt_checkin = TRUE, need_report = FALSE
        const empRes = await pool.query(
            `UPDATE employees 
             SET is_active = FALSE, is_exempt_checkin = TRUE, need_report = FALSE 
             WHERE id = $1 
             RETURNING id, full_name, telegram_id, is_active, is_exempt_checkin, need_report`,
            [empId]
        );
        console.log('UPDATED EMPLOYEE:', empRes.rows[0]);
        
        // 2. Pause membership in group
        const memRes = await pool.query(
            `UPDATE employee_group_memberships 
             SET status = 'PAUSED', pause_reason = 'Admin vô hiệu hóa', paused_at = NOW(), updated_at = NOW() 
             WHERE employee_id = $1 
             RETURNING *`,
            [empId]
        );
        console.log('PAUSED MEMBERSHIPS:', memRes.rows);

        // 3. Log event
        await pool.query(
            `INSERT INTO employee_group_membership_events
                (employee_id, telegram_group_id, old_status, new_status, reason, actor)
             SELECT employee_id, telegram_group_id, 'ACTIVE', 'PAUSED', 'Admin vô hiệu hóa', 'admin:system'
             FROM employee_group_memberships
             WHERE employee_id = $1`,
            [empId]
        );

        // 4. Delete pending reports
        if (empRes.rows[0]?.telegram_id) {
            await pool.query('DELETE FROM pending_reports WHERE telegram_id = $1', [String(empRes.rows[0].telegram_id)]);
        }

        console.log('DONE: DEACTIVATED DAO TRA MY SUCCESSFULLY');
    } catch (err) {
        console.error('Error deactivating:', err);
    } finally {
        await pool.end();
    }
}

run();

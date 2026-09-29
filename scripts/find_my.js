import 'dotenv/config';
import pool from '../packages/database/index.js';

async function main() {
    const empRes = await pool.query(`
        SELECT e.id, e.full_name, e.telegram_id, e.role, e.is_active, 
               g.id as group_id, g.group_name, g.telegram_group_id
        FROM employees e 
        LEFT JOIN employee_group_memberships egm ON e.id = egm.employee_id 
        LEFT JOIN telegram_groups g ON egm.telegram_group_id = g.telegram_group_id 
        WHERE e.full_name ILIKE '%Mỹ%' OR e.full_name ILIKE '%My%'
    `);
    console.log('Employees:', JSON.stringify(empRes.rows, null, 2));

    const statusRes = await pool.query(`
        SELECT ds.*, e.full_name, g.group_name, g.telegram_group_id
        FROM tk_attendance_daily_status ds
        JOIN employees e ON e.id = ds.user_id
        JOIN telegram_groups g ON g.id = ds.group_id
        WHERE ds.date = '2026-09-27'
    `);
    console.log('Daily Status today:', JSON.stringify(statusRes.rows, null, 2));

    const penRes = await pool.query(`
        SELECT p.*, e.full_name
        FROM tk_penalties p
        JOIN employees e ON p.user_id = e.id
        WHERE p.created_at >= '2026-09-27 00:00:00'
    `);
    console.log('Penalties created today:', JSON.stringify(penRes.rows, null, 2));

    process.exit(0);
}

main().catch(console.error);

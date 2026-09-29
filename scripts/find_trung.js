import 'dotenv/config';
import pool from '../packages/database/index.js';

async function main() {
    const res = await pool.query(
        `SELECT e.id, e.full_name, e.telegram_id, e.telegram_username, e.role, e.group_id, g.telegram_group_id, g.group_name 
         FROM employees e 
         LEFT JOIN telegram_groups g ON e.group_id = g.id 
         WHERE e.full_name ILIKE '%Trung%' OR e.full_name ILIKE '%Mỹ%'`
    );
    console.log('Employees:', JSON.stringify(res.rows, null, 2));

    const penalties = await pool.query(
        `SELECT p.*, e.full_name, g.telegram_group_id, g.group_name 
         FROM tk_penalties p 
         JOIN employees e ON p.user_id = e.id 
         JOIN telegram_groups g ON p.group_id = g.id 
         WHERE p.date = '2026-09-25'`
    );
    console.log('Penalties today (2026-09-25):', JSON.stringify(penalties.rows, null, 2));

    const daily = await pool.query(
        `SELECT ds.*, e.full_name, g.telegram_group_id, g.group_name 
         FROM tk_attendance_daily_status ds 
         JOIN employees e ON ds.user_id = e.id 
         JOIN telegram_groups g ON ds.group_id = g.id 
         WHERE ds.date = '2026-09-25'`
    );
    console.log('Daily status today (2026-09-25):', JSON.stringify(daily.rows, null, 2));

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

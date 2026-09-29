import 'dotenv/config';
import pool from '../packages/database/index.js';

async function run() {
    const res = await pool.query(`
        SELECT e.full_name, e.role, m.status, g.group_name 
        FROM employees e
        JOIN employee_group_memberships m ON m.employee_id = e.id
        JOIN telegram_groups g ON g.telegram_group_id = m.telegram_group_id
        WHERE m.telegram_group_id = '-4815602983'
    `);
    console.log('MDT Group Members:', res.rows);

    const ktvRes = await pool.query(`
        SELECT DISTINCT reported_by, unnest(ktv_names) as ktv 
        FROM ktv_tour_reports 
        WHERE group_id = '-4815602983'
    `);
    console.log('Reported KTVs:', ktvRes.rows);

    await pool.end();
}
run();

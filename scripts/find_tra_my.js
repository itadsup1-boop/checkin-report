import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        const res = await pool.query(
            `SELECT id, full_name, telegram_id, role, is_active, is_exempt_checkin, created_at 
             FROM employees 
             WHERE full_name ILIKE '%Đào Trà My%' 
                OR full_name ILIKE '%Trà My%' 
                OR full_name ILIKE '%Dao Tra My%'
                OR full_name ILIKE '%My%'`
        );
        console.log('EMPLOYEES FOUND:', JSON.stringify(res.rows, null, 2));

        if (res.rows.length > 0) {
            const empIds = res.rows.map(r => r.id);
            const memRes = await pool.query(
                `SELECT m.*, g.group_name 
                 FROM employee_group_memberships m
                 LEFT JOIN telegram_groups g ON g.telegram_group_id = m.telegram_group_id
                 WHERE m.employee_id = ANY($1)`,
                [empIds]
            );
            console.log('MEMBERSHIPS:', JSON.stringify(memRes.rows, null, 2));
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();

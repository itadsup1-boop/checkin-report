import 'dotenv/config';
import pool from '../packages/database/index.js';

async function checkViet() {
    try {
        console.log('--- EMPLOYEES MATCHING VIET ---');
        const emps = await pool.query(`SELECT e.*, g.group_name FROM employees e LEFT JOIN telegram_groups g ON e.group_id = g.id WHERE e.full_name ILIKE '%Việt%' OR e.full_name ILIKE '%Viet%' OR e.telegram_username ILIKE '%viet%'`);
        console.log(JSON.stringify(emps.rows, null, 2));

        console.log('--- ALL EMPLOYEES IN ADSUP GROUP ---');
        const adsupEmps = await pool.query(`SELECT e.* FROM employees e JOIN telegram_groups g ON e.group_id = g.id WHERE g.group_name ILIKE '%Adsup%' OR g.telegram_group_id = '-5470063387'`);
        console.log(JSON.stringify(adsupEmps.rows, null, 2));

        console.log('--- RECENT REGISTRATION REQUESTS ---');
        try {
            const reqs = await pool.query(`SELECT * FROM employee_registration_requests ORDER BY created_at DESC LIMIT 10`);
            console.log(JSON.stringify(reqs.rows, null, 2));
        } catch (e) {
            console.log('err:', e.message);
        }

        console.log('--- GROUP SETTINGS ADSUP ---');
        const gs = await pool.query(`SELECT * FROM group_settings WHERE telegram_group_id = '-5470063387'`);
        console.log(JSON.stringify(gs.rows, null, 2));
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

checkViet();

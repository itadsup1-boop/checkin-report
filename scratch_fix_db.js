
import pool from './packages/database/index.js';

async function run() {
    try {
        const res = await pool.query(`
            UPDATE customer_appointments ca
            SET group_id = e.telegram_group_id
            FROM employees e
            WHERE ca.telegram_id = e.telegram_id AND ca.group_id = 'MINI_APP'
        `);
        console.log('Fixed', res.rowCount, 'appointments');
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();

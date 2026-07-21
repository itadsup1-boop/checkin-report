import pool from './packages/database/index.js';

async function run() {
    try {
        await pool.query("UPDATE customer_appointments SET group_id = '-4807311025' WHERE id = 71");
        console.log('Fixed!');
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();

import pool from './packages/database/index.js';

async function run() {
    try {
        const res = await pool.query("SELECT id, customer_name, group_id, sheet_row_index FROM customer_appointments ORDER BY appointment_time DESC LIMIT 5");
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();

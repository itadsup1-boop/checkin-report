import pool from './packages/database/index.js';

async function run() {
    try {
        const res = await pool.query("SELECT id, employee_name, customer_name, group_id, sheet_row_index, created_at FROM customer_appointments ORDER BY created_at DESC LIMIT 5");
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();

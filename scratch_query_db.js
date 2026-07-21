import pool from './packages/database/index.js';

async function run() {
    try {
        const res = await pool.query("SELECT id, employee_name, customer_name, appointment_time, status, group_id FROM customer_appointments WHERE DATE(appointment_time) = '2026-07-14';");
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();

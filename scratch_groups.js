import pool from './packages/database/index.js';

async function run() {
    try {
        const res = await pool.query("SELECT telegram_group_id, group_name, customer_sheet_id FROM telegram_groups");
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();

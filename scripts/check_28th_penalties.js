import 'dotenv/config';
import pool from '../packages/database/index.js';

async function run() {
    const p = await pool.query("SELECT * FROM tk_penalties WHERE date = '2026-09-28' AND violation_type = 'MISSED_CHECKOUT'");
    console.log('Penalties on 2026-09-28:');
    console.log(JSON.stringify(p.rows, null, 2));

    const c = await pool.query(`
        SELECT c.id, c.user_id, u.full_name, c.date::text, c.check_in_time, c.checkout_time, c.checkout_status, c.checkout_penalty_amount, g.telegram_group_id
        FROM tk_check_ins c
        JOIN employees u ON c.user_id = u.id
        JOIN telegram_groups g ON c.group_id = g.id
        WHERE c.date = '2026-09-28'
    `);
    console.log('Checkins on 2026-09-28:');
    console.table(c.rows);

    await pool.end();
}
run();

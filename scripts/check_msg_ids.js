import 'dotenv/config';
import pool from '../packages/database/index.js';

async function run() {
    const ktv = await pool.query('SELECT message_id, created_at FROM ktv_tour_reports ORDER BY created_at DESC LIMIT 5');
    console.log('ktv message_ids:', ktv.rows);

    const cust = await pool.query('SELECT telegram_message_id, created_at FROM customer_record_telegram_media ORDER BY created_at DESC LIMIT 5');
    console.log('cust message_ids:', cust.rows);

    await pool.end();
}

run();

import 'dotenv/config';
import pool from '../packages/database/index.js';

async function main() {
    await pool.query(
        'UPDATE group_settings SET effective_start_date = $1 WHERE telegram_group_id = $2',
        ['2026-09-25', '-5470063387']
    );
    const res = await pool.query(
        'SELECT telegram_group_id, attendance_policy, effective_start_date::text, checkout_min_time::text, marketing_checkin_deadline::text FROM group_settings WHERE telegram_group_id = $1',
        ['-5470063387']
    );
    console.log('Updated group_settings for Adsup:', res.rows[0]);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

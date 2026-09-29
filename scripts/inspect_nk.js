import 'dotenv/config';
import pool from '../packages/database/index.js';

async function main() {
    const tgid = '-4689278273';
    const settings = await pool.query('SELECT * FROM group_settings WHERE telegram_group_id = $1', [tgid]);
    console.log('Settings for -4689278273:');
    console.log(JSON.stringify(settings.rows, null, 2));

    const checkins = await pool.query(`
        SELECT c.*, e.full_name 
        FROM tk_check_ins c
        JOIN employees e ON e.id = c.user_id
        WHERE c.group_id = '03ad937c-8bcc-42b7-95a1-7efbecba1efd'
          AND c.date = '2026-09-27'
    `);
    console.log('Checkins today for this group:');
    console.log(JSON.stringify(checkins.rows, null, 2));

    process.exit(0);
}

main().catch(console.error);

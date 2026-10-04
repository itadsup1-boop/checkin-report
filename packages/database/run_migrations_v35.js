import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v35_telegram_group_automation.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v35 installed Telegram group automation.');
}

run().catch(error => { console.error('Migration v35 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

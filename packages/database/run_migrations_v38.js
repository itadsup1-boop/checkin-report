import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v38_retail_start_date.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v38: Added start_date column to retail_checkin_config.');
}

run().catch(error => { console.error('Migration v38 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

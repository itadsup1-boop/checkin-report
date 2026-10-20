import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v37_retail_checkin_config.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v37 installed retail_checkin_config table (per-group shift times & KPI target).');
}

run().catch(error => { console.error('Migration v37 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

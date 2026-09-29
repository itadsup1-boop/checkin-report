import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v45_marketing_timekeep_policy.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v45 installed Marketing timekeep policy columns (group_settings & tk_check_ins).');
}

run().catch(error => { console.error('Migration v45 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

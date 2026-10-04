import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v54_timekeep_weekly_penalty_dedup.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v54 installed timekeep weekly penalty dedup table.');
}

run().catch(error => { console.error('Migration v54 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

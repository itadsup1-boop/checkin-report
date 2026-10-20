import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v44_telesale_daily_reports.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v44 installed Telesale Daily Reports table (telesale_daily_reports).');
}

run().catch(error => { console.error('Migration v44 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

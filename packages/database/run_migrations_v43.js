import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v43_ktv_tour_reports.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v43 installed KTV Tour Reports table (ktv_tour_reports).');
}

run().catch(error => { console.error('Migration v43 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

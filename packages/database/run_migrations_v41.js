import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v41_retail_checkin_gps.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v41 installed Retail Checkin GPS columns.');
}

run().catch(error => { console.error('Migration v41 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

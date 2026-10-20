import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v36_retail_checkin.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v36 installed Retail Checkin tables.');
}

run().catch(error => { console.error('Migration v36 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

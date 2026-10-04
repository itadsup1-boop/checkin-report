import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v42_uk_tour_records.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v42 installed UK Tour Records table (uk_tour_records).');
}

run().catch(error => { console.error('Migration v42 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

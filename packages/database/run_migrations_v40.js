import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v40_retail_checkin_drive_folder.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v40: Added drive_folder_url to retail_checkins.');
}

run().catch(error => { console.error('Migration v40 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v48_sheet_sync_state.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v48 installed sheet_sync_state table.');
}

run().catch(error => { console.error('Migration v48 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

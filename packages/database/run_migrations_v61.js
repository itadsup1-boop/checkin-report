import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v61_excel_sync_logs.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v61 installed ai_management.excel_sync_logs (lịch sử sync Excel).');
}

run().catch(error => { console.error('Migration v61 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

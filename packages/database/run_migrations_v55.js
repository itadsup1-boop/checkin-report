import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v55_warehouse_order_edits.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v55 installed warehouse order edits audit table and tracking columns.');
}

run().catch(error => { console.error('Migration v55 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

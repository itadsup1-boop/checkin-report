import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v39_retail_employee_kpi.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v39: Installed retail_employee_kpi table.');
}

run().catch(error => { console.error('Migration v39 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

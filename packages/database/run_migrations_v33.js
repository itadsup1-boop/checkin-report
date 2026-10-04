import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v33_normalize_employee_admin_role.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v33 normalized employee admin roles.');
}

run().catch(error => { console.error('Migration v33 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

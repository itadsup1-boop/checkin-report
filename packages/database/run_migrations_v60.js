import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v60_report_forms.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v60 installed ai_management report form tables (templates, versions, assignments, submissions).');
}

run().catch(error => { console.error('Migration v60 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

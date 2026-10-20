import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v58_task_management_access.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v58 installed ai_management schema (access codes, manager accounts, RBAC).');
}

run().catch(error => { console.error('Migration v58 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

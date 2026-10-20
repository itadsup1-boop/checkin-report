import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v59_task_management_tasks.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v59 installed ai_management task tables (tasks, assignees, events, outbox, links).');
}

run().catch(error => { console.error('Migration v59 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

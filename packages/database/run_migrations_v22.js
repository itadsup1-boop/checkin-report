import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const migrationUrl = new URL('./migrations/v22_schedule_completion_reminder.sql', import.meta.url);
    const sql = await fs.readFile(fileURLToPath(migrationUrl), 'utf8');
    await pool.query(sql);
    console.log('Migration v22 schedule completion reminder completed.');
}

run()
    .catch(error => {
        console.error('Migration v22 failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

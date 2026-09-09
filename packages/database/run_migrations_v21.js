import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const migrationUrl = new URL('./migrations/v21_timekeep_auto_accept_leave.sql', import.meta.url);
    const sql = await fs.readFile(fileURLToPath(migrationUrl), 'utf8');
    await pool.query(sql);
    console.log('Migration v21 timekeep auto-accept leave completed.');
}

run()
    .catch(error => {
        console.error('Migration v21 failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

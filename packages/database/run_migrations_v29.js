import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const migrationUrl = new URL('./migrations/v29_employee_pending_registration.sql', import.meta.url);
    const sql = await fs.readFile(fileURLToPath(migrationUrl), 'utf8');
    await pool.query(sql);
    console.log('Migration v29 employee pending registration completed.');
}

run()
    .catch(error => {
        console.error('Migration v29 failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

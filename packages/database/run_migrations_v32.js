import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const migrationUrl = new URL('./migrations/v32_employee_group_settings.sql', import.meta.url);
    const sql = await fs.readFile(fileURLToPath(migrationUrl), 'utf8');
    await pool.query(sql);
    console.log('Migration v32 employee group settings completed.');
}

run()
    .catch(error => {
        console.error('Migration v32 failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => pool.end());

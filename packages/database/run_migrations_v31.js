import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const migrationUrl = new URL('./migrations/v31_admin_security.sql', import.meta.url);
    const sql = await fs.readFile(fileURLToPath(migrationUrl), 'utf8');
    await pool.query(sql);
    console.log('Migration v31 admin security completed.');
}

run()
    .catch(error => {
        console.error('Migration v31 failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const migrationUrl = new URL('./migrations/v23_warehouse_decimal_quantities.sql', import.meta.url);
    const sql = await fs.readFile(fileURLToPath(migrationUrl), 'utf8');
    await pool.query(sql);
    console.log('Migration v23 warehouse decimal quantities completed.');
}

run()
    .catch(error => {
        console.error('Migration v23 failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

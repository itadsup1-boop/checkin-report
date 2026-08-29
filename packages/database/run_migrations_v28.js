import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const migrationUrl = new URL('./migrations/v28_warehouse_product_pricing.sql', import.meta.url);
    const sql = await fs.readFile(fileURLToPath(migrationUrl), 'utf8');
    await pool.query(sql);
    console.log('Migration v28 warehouse product pricing completed.');
}

run()
    .catch(error => {
        console.error('Migration v28 failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

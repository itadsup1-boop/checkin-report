import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v57_telesale_multislot_and_dimensions.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v57 executed successfully: Added multi-slot, projects, and services support to telesale reports.');
}

run().catch(error => { console.error('Migration v57 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

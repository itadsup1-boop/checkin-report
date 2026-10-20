import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v56_fix_tk_check_ins_nullability.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v56 executed successfully: relaxed NOT NULL constraints on tk_check_ins.');
}

run().catch(error => { console.error('Migration v56 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

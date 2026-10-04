import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
    const sqlPath = path.join(__dirname, 'migrations', 'v52_marketing_checkout_deadline_midnight.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('Migration v52 executed successfully: checkout deadline 23:59:00, effective start date 2026-09-29, cleared 28/09 missed checkout penalties.');
    await pool.end();
}

run().catch(err => {
    console.error('Migration v52 failed:', err);
    process.exit(1);
});

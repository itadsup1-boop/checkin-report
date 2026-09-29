import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
    const sqlPath = path.join(__dirname, 'migrations', 'v47_marketing_effective_date.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('Migration v47 executed successfully: effective_start_date set to 2026-09-26 for Adsup');
    await pool.end();
}

run().catch(err => {
    console.error('Migration v47 failed:', err);
    process.exit(1);
});

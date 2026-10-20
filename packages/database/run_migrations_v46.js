import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
    const sqlPath = path.join(__dirname, 'migrations', 'v46_fix_tk_check_ins_unique_constraint.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('Migration v46 executed successfully: cleaned duplicates & created idx_tk_check_ins_user_date');
    await pool.end();
}

run().catch(err => {
    console.error('Migration v46 failed:', err);
    process.exit(1);
});

import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v63_manager_rule_configs.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v63 installed ai_management.manager_rule_configs (cấu hình ngưỡng nhắc theo quản lý).');
}

run().catch(error => { console.error('Migration v63 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

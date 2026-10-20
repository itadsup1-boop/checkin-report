import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

async function run() {
    const sql = await fs.readFile(fileURLToPath(new URL('./migrations/v62_direct_message_logs.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    console.log('Migration v62 installed ai_management.direct_message_logs (nhật ký gửi tin nhắn).');
}

run().catch(error => { console.error('Migration v62 failed:', error); process.exitCode = 1; }).finally(async () => pool.end());

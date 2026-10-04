import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
    const sqlPath = path.join(__dirname, 'migrations', 'v50_telesale_attendance_mapping.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('[Migration v50] Đang áp dụng v50_telesale_attendance_mapping.sql...');
    await pool.query(sql);
    console.log('[Migration v50] Áp dụng thành công migration v50.');
    await pool.end();
}

run().catch(err => {
    console.error('[Migration v50] Lỗi khi chạy migration:', err);
    process.exit(1);
});

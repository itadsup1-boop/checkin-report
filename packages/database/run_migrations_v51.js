import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
    const sqlPath = path.join(__dirname, 'migrations', 'v51_group_approval_settings.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('[Migration v51] Đang áp dụng v51_group_approval_settings.sql...');
    await pool.query(sql);
    console.log('[Migration v51] Áp dụng thành công migration v51 (Cấu hình phê duyệt theo nhóm).');
    await pool.end();
}

run().catch(err => {
    console.error('[Migration v51] Lỗi khi chạy migration:', err);
    process.exit(1);
});

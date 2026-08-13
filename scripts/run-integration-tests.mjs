/**
 * Chạy toàn bộ test tích hợp trên DATABASE TEST, không bao giờ trên database thật.
 *
 * Tự đổi DATABASE_URL sang telegram_kpi_test rồi mới gọi node --test, nên không
 * thể lỡ tay chạy vào dữ liệu đang phục vụ nhân viên.
 *
 * Mỗi file chạy trong MỘT TIẾN TRÌNH RIÊNG: các test dùng chung pool singleton
 * ở packages/database, file nào gọi pool.end() trước sẽ làm hỏng file chạy sau
 * ("Cannot use a pool after calling end on the pool").
 */
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();

const SOURCE = process.env.DATABASE_URL || '';
const TEST_URL = SOURCE.replace(/\/[^/]+$/, '/telegram_kpi_test');

if (!SOURCE || !TEST_URL.endsWith('/telegram_kpi_test')) {
    console.error('Không dựng được DATABASE_URL cho database test.');
    process.exit(1);
}

const FILES = [
    'domains/warehouse/tests/warehouse-order.integration.test.js',
    'domains/warehouse/tests/warehouse-import.integration.test.js',
    'domains/warehouse/tests/warehouse-admin.integration.test.js'
];

console.log('Chạy test tích hợp trên telegram_kpi_test (KHÔNG phải database thật)\n');

let thatBai = 0;
for (const file of FILES) {
    console.log(`--- ${file.replace('domains/warehouse/tests/', '')}`);
    try {
        execFileSync(
            process.execPath,
            ['--experimental-test-isolation=none', '--test', file],
            { stdio: 'inherit', env: { ...process.env, DATABASE_URL: TEST_URL } }
        );
    } catch {
        thatBai += 1;
    }
}

if (thatBai > 0) {
    console.error(`\n${thatBai}/${FILES.length} file test thất bại.`);
    process.exit(1);
}
console.log(`\nCả ${FILES.length} file test tích hợp đều pass.`);

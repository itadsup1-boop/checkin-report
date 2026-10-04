/**
 * Tạo lại database test từ CẤU TRÚC của database thật.
 *
 * Vì sao cần: các test có đuôi `-db` ghi dữ liệu thật. Chạy thẳng vào
 * telegram_kpi là đang nghịch trên dữ liệu đang phục vụ nhân viên.
 *
 * Script này chỉ sao chép SCHEMA (không sao chép dữ liệu) sang
 * telegram_kpi_test, nên test chạy trên bảng trống và không bao giờ chạm vào
 * dữ liệu thật.
 *
 * Dùng:
 *   node scripts/setup-test-db.mjs      # tạo lại database test
 *   npm run test:db                     # chạy toàn bộ test tích hợp trên đó
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const SOURCE_URL = process.env.DATABASE_URL;
if (!SOURCE_URL) {
    console.error('Thiếu DATABASE_URL trong .env');
    process.exit(1);
}

const TEST_DB = 'telegram_kpi_test';
const sourceName = SOURCE_URL.replace(/^.*\//, '');
const testUrl = SOURCE_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
const adminUrl = SOURCE_URL.replace(/\/[^/]+$/, '/postgres');

if (sourceName === TEST_DB) {
    console.error('DATABASE_URL đang trỏ vào chính database test, dừng lại cho an toàn.');
    process.exit(1);
}

/** Tìm pg_dump/psql kể cả khi chưa có trong PATH (thường gặp trên Windows). */
function findTool(name) {
    const candidates = [
        name,
        `C:/Program Files/PostgreSQL/16/bin/${name}.exe`,
        `C:/Program Files/PostgreSQL/15/bin/${name}.exe`,
        `/usr/bin/${name}`
    ];
    for (const candidate of candidates) {
        try {
            execFileSync(candidate, ['--version'], { stdio: 'pipe' });
            return candidate;
        } catch {
            /* thử ứng viên tiếp theo */
        }
    }
    throw new Error(`Không tìm thấy ${name}. Hãy cài PostgreSQL client hoặc thêm vào PATH.`);
}

const parsed = new URL(SOURCE_URL);
const env = { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) };
const connArgs = ['-h', parsed.hostname, '-p', parsed.port || '5432', '-U', decodeURIComponent(parsed.username)];

async function main() {
    const pgDump = findTool('pg_dump');
    const psql = findTool('psql');

    console.log(`Nguồn cấu trúc : ${sourceName}`);
    console.log(`Database test  : ${TEST_DB}`);

    const admin = new pg.Pool({ connectionString: adminUrl });
    try {
        await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
        await admin.query(`CREATE DATABASE ${TEST_DB}`);
        console.log('  Đã tạo database test rỗng');
    } finally {
        await admin.end();
    }

    const dumpFile = path.join(os.tmpdir(), `warehouse-schema-${Date.now()}.sql`);
    try {
        const schema = execFileSync(
            pgDump,
            [...connArgs, '--schema-only', '--no-owner', '--no-privileges', sourceName],
            { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
        );
        fs.writeFileSync(dumpFile, schema);
        console.log(`  Đã lấy cấu trúc (${schema.split('\n').length} dòng)`);

        execFileSync(psql, [...connArgs, '-d', TEST_DB, '-q', '-f', dumpFile], { env, stdio: 'pipe' });
        console.log('  Đã nạp cấu trúc vào database test');
    } finally {
        fs.rmSync(dumpFile, { force: true });
    }

    const check = new pg.Pool({ connectionString: testUrl });
    try {
        const tables = await check.query(
            "SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public'"
        );
        const rows = await check.query('SELECT count(*)::int AS c FROM tk_products');
        console.log(`  Kết quả: ${tables.rows[0].c} bảng, ${rows.rows[0].c} sản phẩm (phải là 0)`);
        if (rows.rows[0].c !== 0) {
            throw new Error('Database test có dữ liệu — không đúng, phải là bản rỗng');
        }
    } finally {
        await check.end();
    }

    console.log('\nXong. Chạy test tích hợp bằng: npm run test:db');
}

main().catch(error => {
    console.error('Lỗi:', error.message);
    process.exit(1);
});

/**
 * Test kiến trúc: biến quy tắc trong ADR-0001 thành thứ máy kiểm tra được.
 *
 * Quy tắc viết trong tài liệu sẽ bị phá dần mà không ai biết. Test này chạy cùng
 * bộ test kho nên vi phạm bị chặn ngay khi vừa xuất hiện.
 *
 * Hướng phụ thuộc bắt buộc:
 *
 *   interfaces/  ──►  application/  ──►  domain/
 *        │                  │
 *        └──────────────────┴──────►  infrastructure/
 *
 * Chiều ngược lại bị cấm: domain/ không được biết gì về tầng trên, và tuyệt đối
 * không được biết tới Express, PostgreSQL, Telegraf hay Google API.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOMAIN_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Mọi file .js trong domain, trừ thư mục tests. */
function domainFiles() {
    return fs.readdirSync(DOMAIN_ROOT, { recursive: true })
        .map(entry => String(entry).split(path.sep).join('/'))
        .filter(entry => entry.endsWith('.js') && !entry.startsWith('tests/'));
}

function readFile(relativePath) {
    return fs.readFileSync(path.join(DOMAIN_ROOT, relativePath), 'utf8');
}

/** Danh sách specifier được import trong một file. */
function importsOf(source) {
    return [
        ...[...source.matchAll(/from\s+'([^']+)'/g)].map(match => match[1]),
        ...[...source.matchAll(/import\s*\(\s*'([^']+)'\s*\)/g)].map(match => match[1])
    ];
}

/** Đường dẫn tương đối được quy về gốc domain để so tầng. */
function resolveLayer(fromFile, specifier) {
    if (!specifier.startsWith('.')) return null;
    return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
}

test('tầng domain không được phụ thuộc framework hay hạ tầng', () => {
    const CAM = ['express', 'pg', 'telegraf', 'googleapis', 'google-spreadsheet', 'multer', 'axios'];

    for (const file of domainFiles()) {
        if (!file.startsWith('domain/')) continue;
        const source = readFile(file);

        for (const specifier of importsOf(source)) {
            assert.ok(
                !CAM.includes(specifier),
                `${file} import "${specifier}" — tầng domain phải thuần nghiệp vụ`
            );

            const target = resolveLayer(file, specifier);
            if (!target) continue;
            for (const tangTren of ['application/', 'infrastructure/', 'interfaces/']) {
                assert.ok(
                    !target.startsWith(tangTren),
                    `${file} -> ${target}: domain/ không được phụ thuộc ${tangTren}`
                );
            }
        }
    }
});

test('tầng application không được phụ thuộc tầng giao tiếp', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('application/')) continue;

        for (const specifier of importsOf(readFile(file))) {
            assert.ok(
                specifier !== 'express' && specifier !== 'telegraf',
                `${file} import "${specifier}" — use case không được biết Express/Telegraf`
            );

            const target = resolveLayer(file, specifier);
            if (!target) continue;
            assert.ok(
                !target.startsWith('interfaces/'),
                `${file} -> ${target}: application/ không được phụ thuộc interfaces/`
            );
        }
    }
});

test('chỉ tầng infrastructure được viết SQL', () => {
    // ADR-0001 quy định Express -> use case -> repository -> PostgreSQL.
    // Trước đây warehouse-order-service.js có 54 câu SQL viết thẳng trong tầng
    // application, tức là bỏ qua repository. Test này chặn việc đó quay lại.
    const CAU_SQL = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/;

    // Đã đạt: domain/ và application/ hoàn toàn sạch SQL (trước đây
    // warehouse-order-service.js có 54 câu SQL, nay còn 0).
    //
    // Nợ kỹ thuật còn lại, tầng interfaces vẫn tự truy vấn:
    //   interfaces/admin-api    ~40 dòng  (CRUD danh mục cho Web Admin)
    //   interfaces/miniapp-api  ~34 dòng  (route Mini App)
    //   interfaces/telegram     ~26 dòng  (callback duyệt đơn)
    //
    // Ưu tiên thấp hơn vì chúng không đụng lõi trừ tồn kho. Danh sách này chỉ
    // được phép NGẮN ĐI, không được dài thêm.
    const MIEN_TRU = ['interfaces/'];

    for (const file of domainFiles()) {
        if (file.startsWith('infrastructure/')) continue;
        if (MIEN_TRU.some(prefix => file.startsWith(prefix))) continue;
        const source = readFile(file);

        // Bỏ chú thích để không báo nhầm khi tài liệu nhắc tới tên bảng.
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        assert.ok(
            !CAU_SQL.test(code),
            `${file} chứa SQL — mọi truy vấn phải nằm trong infrastructure/postgres/`
        );
    }
});

test('app bên ngoài chỉ được đi qua cổng index.js của domain', () => {
    const NGOAI = [
        fileURLToPath(new URL('../../../apps/bot/timekeep_bot.js', import.meta.url)),
        fileURLToPath(new URL('../../../apps/api/index.js', import.meta.url))
    ];

    for (const file of NGOAI) {
        const source = fs.readFileSync(file, 'utf8');
        for (const specifier of importsOf(source)) {
            if (!specifier.includes('domains/warehouse')) continue;
            assert.ok(
                specifier.endsWith('domains/warehouse/index.js'),
                `${path.basename(file)} import "${specifier}" — phải đi qua domains/warehouse/index.js`
            );
        }
    }
});

test('không còn tham chiếu tới vị trí cũ của domain kho', () => {
    // Sau khi gộp, packages/warehouse và apps/*/src/modules/warehouse không còn.
    // Chỉ xét specifier của lệnh import — nhắc tới vị trí cũ trong phần chú thích
    // để ghi lại lịch sử là hợp lệ.
    for (const file of domainFiles()) {
        for (const specifier of importsOf(readFile(file))) {
            assert.ok(
                !specifier.includes('packages/warehouse'),
                `${file} còn import từ packages/warehouse`
            );
            assert.ok(
                !specifier.includes('src/modules/warehouse'),
                `${file} còn import từ vị trí module cũ`
            );
        }
    }

    assert.equal(fs.existsSync(fileURLToPath(new URL('../../../packages/warehouse', import.meta.url))), false);
    assert.equal(fs.existsSync(fileURLToPath(new URL('../../../apps/bot/src', import.meta.url))), false);
    // Giai đoạn 2: warehouse-admin đã chuyển vào interfaces/admin-api/.
    assert.equal(fs.existsSync(fileURLToPath(new URL('../../../apps/api/src', import.meta.url))), false);
});

test('không file nào trong domain vượt quá 300 dòng', () => {
    // Ngưỡng cảnh báo sớm: file phình to là dấu hiệu đang gom nhiều trách nhiệm.
    //
    // Ba file dưới đây được miễn TẠM THỜI, là nợ kỹ thuật đã biết và sẽ tách ở
    // giai đoạn 3. Danh sách này chỉ được phép ngắn đi, không được dài thêm —
    // thêm file mới vào đây nghĩa là đang đi lùi.
    const MIEN_TRU = new Set([
        'application/warehouse-order-service.js',   // 818 dòng, lõi trừ tồn kho
        'infrastructure/outbox/outbox-worker.js',   // 422 dòng, tiến trình nền
        'interfaces/miniapp-api/export-routes.js'   // 326 dòng, luồng xuất kho cũ
    ]);

    const qua_dai = [];
    for (const file of domainFiles()) {
        if (MIEN_TRU.has(file)) continue;
        const soDong = readFile(file).split('\n').length;
        if (soDong > 300) qua_dai.push(`${file} (${soDong} dòng)`);
    }
    assert.deepEqual(qua_dai, [], 'Các file sau cần được tách nhỏ');
});

test('mọi import tương đối trong domain đều trỏ tới file có thật', () => {
    for (const file of domainFiles()) {
        for (const specifier of importsOf(readFile(file))) {
            const target = resolveLayer(file, specifier);
            if (!target) continue;
            // Bỏ qua đường dẫn ra ngoài domain (vd: packages/database).
            if (target.startsWith('..')) continue;
            assert.ok(
                fs.existsSync(path.join(DOMAIN_ROOT, target)),
                `${file} -> ${specifier}: file không tồn tại`
            );
        }
    }
});

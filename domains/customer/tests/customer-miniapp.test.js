import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as rules from '../../../apps/bot/public/customer/form/domain/record-rules.js';

/**
 * Test phía TRÌNH DUYỆT cho Mini App hồ sơ khách hàng (role customer / customer_record).
 *
 * Phía máy chủ nằm ở customer.module.test.js — hai bộ này khớp nhau ở hợp đồng
 * POST /api/customer/save, xem bảng "Hợp đồng tương thích" trong README.
 */

const PUBLIC_DIR = fileURLToPath(new URL('../../../apps/bot/public/', import.meta.url));
const APP_DIR = path.join(PUBLIC_DIR, 'customer', 'form');

const readPublicFile = name => fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
const readModule = rel => fs.readFileSync(path.join(APP_DIR, rel), 'utf8');
const stripComments = src =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const modulesIn = dir => fs.readdirSync(dir, { recursive: true })
    .map(e => String(e).split(path.sep).join('/'))
    .filter(e => e.endsWith('.js')).sort();

test('customer_form.html chỉ là shell nạp module', () => {
    const html = readPublicFile('customer_form.html');
    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /telegram-web-app\.js/);
    assert.match(html, /customer\/form\/theme\.css/);
    assert.match(html, /<script type="module" src="\/mini-app\/_v__ASSET_V__\/customer\/form\/app\.js">/);
    const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    assert.equal(inline.length, 0, 'Shell không được chứa inline script');
    assert.ok(html.length < 3000, `Shell quá lớn (${html.length} bytes)`);
});

test('mọi module có cú pháp hợp lệ và không import chết', () => {
    const modules = modulesIn(APP_DIR);
    assert.ok(modules.length >= 7, `Cần đủ module đã tách, hiện có ${modules.length}`);
    for (const rel of modules) {
        assert.doesNotThrow(
            () => execFileSync(process.execPath, ['--check', path.join(APP_DIR, rel)], { stdio: 'pipe' }),
            `Sai cú pháp: ${rel}`
        );
        for (const m of readModule(rel).matchAll(/from\s+'([^']+)'/g)) {
            assert.ok(fs.existsSync(path.resolve(path.dirname(path.join(APP_DIR, rel)), m[1])),
                `${rel} -> ${m[1]} không tồn tại`);
        }
    }
});

test('quy đổi tiền gõ tắt đúng bậc — sai là sai doanh thu', () => {
    for (const [input, expected] of [
        ['30tr', 30000000], ['30 triệu', 30000000], ['30m', 30000000], ['30 củ', 30000000],
        ['500k', 500000], ['500 nghìn', 500000], ['500 ngàn', 500000], ['500 lít', 500000],
        ['1.500.000', 1500000], ['1,500,000', 1500000], ['', 0], ['abc', 0]
    ]) {
        assert.equal(rules.parseMoney(input), expected, `parseMoney("${input}")`);
    }
});

test('còn nợ = hóa đơn − đã trả, không bao giờ âm', () => {
    assert.equal(rules.computeDebt('30tr', '500k'), 29500000);
    assert.equal(rules.computeDebt('1tr', '2tr'), 0, 'trả dư vẫn là hết nợ, không âm');
    assert.equal(rules.computeDebt('', ''), 0);
});

test('hai chế độ nộp ảnh và điều kiện gửi', () => {
    assert.equal(rules.MEDIA_MODES.MINI_APP, 'mini_app');
    assert.equal(rules.MEDIA_MODES.TELEGRAM_REPLY, 'telegram_reply');

    // Tải trong Mini App thì bắt buộc có tệp; reply thì ảnh gửi sau trong nhóm.
    assert.equal(rules.checkRecord({ phone: '0912345678', mediaMode: 'mini_app', fileCount: 0 }).ok, false);
    assert.equal(rules.checkRecord({ phone: '0912345678', mediaMode: 'telegram_reply', fileCount: 0 }).ok, true);
    assert.equal(rules.checkRecord({ phone: '0912345678', mediaMode: 'mini_app', fileCount: 1 }).ok, true);
    // Số điện thoại sai thì chặn ở cả hai chế độ.
    assert.equal(rules.checkRecord({ phone: 'abc', mediaMode: 'telegram_reply', fileCount: 0 }).ok, false);
});

test('gửi đúng contract của POST /api/customer/save', () => {
    const repo = readModule('data/customer-repo.js');
    for (const f of ['telegram_id', 'chat_id', 'ts', 'sig', 'media_mode', 'media_files']) {
        assert.ok(repo.includes(`formData.append('${f}'`), `thiếu field ${f}`);
    }
    assert.match(repo, /'x-telegram-init-data'/);
    // Phải dùng XHR: fetch không có tiến độ tải lên, hồ sơ kèm tới 20 tệp.
    assert.match(repo, /new XMLHttpRequest\(\)/);
    assert.match(repo, /request\.upload\.onprogress/);
    assert.match(repo, /MAX_MEDIA_FILES = 20/);

    // Số tiền gửi lên phải là SỐ đã quy đổi, không phải chuỗi "30tr".
    const money = readModule('sections/money-section.js');
    assert.match(money, /bill_amount: parseMoney\(/);
    assert.match(money, /debt_amount: computeDebt\(/);
});

test('không dựng HTML từ dữ liệu người dùng', () => {
    for (const rel of modulesIn(APP_DIR)) {
        assert.doesNotMatch(stripComments(readModule(rel)), /innerHTML/,
            `${rel} phải dùng h() thay vì innerHTML`);
    }
});

test('thư mục customer được bot phục vụ và có token phiên bản', () => {
    const bot = fs.readFileSync(fileURLToPath(new URL('../../../apps/bot/timekeep_bot.js', import.meta.url)), 'utf8');
    assert.match(bot, /'customer'/, 'thiếu customer trong warehouseAssetDirs');
    assert.match(bot, /customer_form\.html': path\.join/, 'shell chưa được đăng ký');
});

test('dùng chung hạ tầng shared-ui, không nhân đôi core', () => {
    for (const rel of modulesIn(APP_DIR)) {
        assert.ok(!rel.startsWith('core/'), `${rel} nhân đôi hạ tầng đã có ở shared-ui`);
    }
    assert.match(readModule('app.js'), /\.\.\/\.\.\/shared-ui\/core\//);
});

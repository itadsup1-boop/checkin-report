import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Test cấu trúc cho Mini App lịch khách.
 *
 * Backend của lịch khách vẫn nằm trong apps/bot/kpi_features.js và CHƯA tách —
 * xem docs/adr. File này chỉ chốt phần giao diện đã module hoá.
 */

const PUBLIC_DIR = fileURLToPath(new URL('../../../apps/bot/public/', import.meta.url));
const APP_DIR = path.join(PUBLIC_DIR, 'scheduling', 'schedule-client');
const SHARED_UI_DIR = path.join(PUBLIC_DIR, 'shared-ui');

const readPublicFile = name => fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
const readModule = relativePath => fs.readFileSync(path.join(APP_DIR, relativePath), 'utf8');

/**
 * Bỏ ghi chú để test soi CODE THẬT.
 * Các file ở đây có ghi chú giải thích lý do lịch sử, trong đó nhắc lại đúng
 * những tên mà test đang tìm ("innerHTML", "sig") — quét cả ghi chú sẽ báo sai.
 */
const stripComments = source =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function modulesIn(directory) {
    return fs.readdirSync(directory, { recursive: true })
        .map(entry => String(entry).split(path.sep).join('/'))
        .filter(entry => entry.endsWith('.js'))
        .sort();
}

test('schedule_client.html chỉ là shell nạp module', () => {
    const html = readPublicFile('schedule_client.html');

    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /telegram-web-app\.js/);
    assert.match(html, /shared-ui\/theme-tokens\.css/);
    assert.match(html, /scheduling\/schedule-client\/theme\.css/);
    assert.match(html, /<script type="module" src="\/mini-app\/_v__ASSET_V__\/scheduling\/schedule-client\/app\.js">/);

    const inlineBlocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    assert.equal(inlineBlocks.length, 0, 'Shell không được chứa inline script');
    assert.ok(html.length < 3000, `Shell quá lớn (${html.length} bytes)`);

    // Token màu phải nạp TRƯỚC theme của app.
    assert.ok(html.indexOf('shared-ui/theme-tokens.css') < html.indexOf('schedule-client/theme.css'));
});

test('mọi module lịch khách có cú pháp hợp lệ và không import chết', () => {
    const modules = modulesIn(APP_DIR);
    assert.ok(modules.length >= 10, `Cần đủ module đã tách, hiện có ${modules.length}`);

    for (const relativePath of modules) {
        assert.doesNotThrow(
            () => execFileSync(process.execPath, ['--check', path.join(APP_DIR, relativePath)], { stdio: 'pipe' }),
            `Sai cú pháp: ${relativePath}`
        );
        for (const match of readModule(relativePath).matchAll(/from\s+'([^']+)'/g)) {
            const target = path.resolve(path.dirname(path.join(APP_DIR, relativePath)), match[1]);
            assert.ok(fs.existsSync(target), `${relativePath} -> ${match[1]} không tồn tại`);
        }
    }
});

test('đủ 5 tab và tab Báo Bù chỉ dành cho nhóm report_tour', () => {
    const app = readModule('app.js');
    for (const key of ['check', 'add', 'edit', 'tasks', 'makeup']) {
        assert.match(app, new RegExp(`key: '${key}'`), `thiếu tab ${key}`);
    }
    // Gate vai trò: chỉ nhóm tour thấy tab Báo Bù.
    assert.match(app, /tourOnly: true/);
    assert.match(app, /!tab\.tourOnly \|\| isTour/);
    assert.match(app, /role === 'report_tour'/);
    // Lỗi mạng khi hỏi vai trò thì coi như KHÔNG phải tour.
    assert.match(app, /\.catch\(\(\) => render\(false,/);
});

test('chuyển tab bằng radio CSS, không dùng JS', () => {
    // Một tab lỗi vẫn phải chuyển sang tab khác được.
    const app = readModule('app.js');
    assert.match(app, /type: 'radio', name: 'tab'/);
    assert.match(app, /class: 'tab-radio'/);
    assert.match(app, /class: 'tab-label', for: /);
});

test('ba đường mở đặc biệt được giữ nguyên', () => {
    const app = readModule('app.js');
    assert.match(app, /params\.get\('tab'\) === 'edit'/);
    assert.match(app, /params\.get\('tab'\) === 'makeup' \|\| payload\.startsWith\('makeupclient_'\)/);
    assert.match(app, /params\.get\('action'\) === 'update'/);
    // Chế độ cập nhật phải ẩn thanh tab.
    assert.match(app, /updateId \? null : h\('div', \{ class: 'tabs' \}/);
});

test('chế độ cập nhật khoá tên, SĐT và giờ hẹn', () => {
    // Đổi ba thứ đó là thành một lịch hẹn khác, không còn là "cập nhật".
    const addTab = readModule('tabs/add-tab.js');
    assert.match(addTab, /inputs\.name\.disabled = true/);
    assert.match(addTab, /inputs\.phone\.disabled = true/);
    assert.match(addTab, /inputs\.time\.disabled = true/);
    assert.match(addTab, /updateScheduleDetails/);
});

test('báo bù công tour giữ đúng contract và quy tắc khoá ô', () => {
    const rules = readModule('domain/schedule-rules.js');
    const tab = readModule('tabs/makeup-tab.js');

    assert.match(rules, /MAKEUP_EXISTING = 'EXISTING_APPOINTMENT'/);
    assert.match(rules, /MAKEUP_MISSING = 'MISSING_APPOINTMENT'/);
    // 6 ô bị khoá khi bổ sung lịch cũ, để không sửa lệch so với lịch gốc.
    assert.match(rules, /MAKEUP_LOCKED_FIELDS/);
    assert.match(tab, /for \(const name of MAKEUP_LOCKED_FIELDS\) inputs\[name\]\.disabled = true/);
    // Bác sĩ/điều dưỡng nối vào lý do vì bảng chưa có cột riêng.
    assert.match(rules, /export function appendStaffToReason/);
    assert.match(tab, /appendStaffToReason/);
    // Thiếu trường bắt buộc hoặc thiếu ảnh thì CHẶN gửi.
    assert.match(tab, /if \(!verdict\.ok\)/);

    const repo = readModule('data/schedule-repo.js');
    assert.match(repo, /\/api\/schedules\/makeup/);
    assert.match(repo, /imageBase64/);
});

test('không dựng HTML từ dữ liệu khách hàng', () => {
    // Bản cũ nối thẳng tên khách/SĐT/tên nhân viên vào innerHTML ở 4/5 tab.
    for (const relativePath of modulesIn(APP_DIR)) {
        assert.doesNotMatch(
            stripComments(readModule(relativePath)),
            /innerHTML/,
            `${relativePath} phải dùng h() thay vì innerHTML`
        );
    }
});

test('nén ảnh khai báo một chỗ, giữ đúng hai mức chất lượng cũ', () => {
    // Bản cũ lặp y hệt đoạn canvas hai lần, khác mỗi mức nén.
    const photo = readModule('media/photo.js');
    assert.match(photo, /MAX_WIDTH = 1200/);
    assert.match(photo, /TASK_PHOTO_QUALITY = 0\.8/);
    assert.match(photo, /MAKEUP_PHOTO_QUALITY = 0\.85/);

    const withCanvas = modulesIn(APP_DIR).filter(rel => /createElement\('canvas'\)/.test(readModule(rel)));
    assert.deepEqual(withCanvas, ['media/photo.js'], 'chỉ media/photo.js được dựng canvas');
});

test('xác thực dùng đúng cơ chế của lịch khách, không mượn của kho', () => {
    // Endpoint lịch khách nhận groupId + telegram_id + header initData, KHÔNG có ts/sig.
    const repo = stripComments(readModule('data/schedule-repo.js'));
    assert.match(repo, /'x-telegram-init-data'/);
    assert.match(repo, /groupId/);
    assert.match(repo, /telegram_id/);
    // Không được gửi kèm chữ ký kiểu kho — server lịch khách không đọc ts/sig.
    assert.doesNotMatch(repo, /warehouseAuthQuery|warehouseAuthBody/);
    assert.doesNotMatch(repo, /sig:/);
});

test('thư mục scheduling được bot phục vụ và có token phiên bản', () => {
    const bot = fs.readFileSync(fileURLToPath(new URL('../../../apps/bot/timekeep_bot.js', import.meta.url)), 'utf8');
    assert.match(bot, /'scheduling'/, 'thiếu scheduling trong warehouseAssetDirs');
    assert.match(bot, /schedule_client\.html': path\.join/, 'shell chưa được đăng ký để chèn token');
});

test('dùng chung hạ tầng shared-ui, không nhân đôi core', () => {
    for (const relativePath of modulesIn(APP_DIR)) {
        assert.ok(!relativePath.startsWith('core/'), `${relativePath} nhân đôi hạ tầng đã có ở shared-ui`);
    }
    assert.match(readModule('app.js'), /\.\.\/\.\.\/shared-ui\/core\//);
    assert.ok(fs.existsSync(path.join(SHARED_UI_DIR, 'core', 'dom.js')));
});

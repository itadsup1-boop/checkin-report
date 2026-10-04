import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCustomerModule } from '../index.js';
import * as rules from '../domain/record-rules.js';
import { ACCEPT_RESULT, createAcceptTelegramMedia } from '../application/accept-telegram-media.js';
import { createCustomerRecordUseCase } from '../application/create-customer-record.js';

const DOMAIN_DIR = fileURLToPath(new URL('../', import.meta.url));

function createHarness() {
    const routes = [];
    const botEvents = [];
    const crons = [];
    let queryCount = 0;

    const moduleApi = registerCustomerModule({
        botApp: {
            post(routePath, ...handlers) { routes.push({ method: 'POST', path: routePath, handlers }); },
            get(routePath, ...handlers) { routes.push({ method: 'GET', path: routePath, handlers }); }
        },
        bot: { on(events, handler) { botEvents.push({ events, handler }); } },
        pool: {
            async query() {
                queryCount += 1;
                throw new Error('Không được truy vấn database lúc đăng ký module');
            },
            async connect() { throw new Error('Không được mở kết nối lúc đăng ký module'); }
        },
        cron: { schedule(expression, handler) { crons.push({ expression, handler }); return { stop() {} }; } },
        moment: () => ({ utcOffset: () => ({ format: () => '2026-01-01' }) }),
        fs: {},
        escapeHtml: value => String(value ?? ''),
        getGroupRole: async () => 'customer',
        authenticateTelegramMiniApp: (req, res, next) => next(),
        uploadCustomerMedia: { array: (field, max) => { uploadCalls.push({ field, max }); return (req, res, next) => next(); } },
        getOrCreateCustomerFolder: async () => ({ id: 'folder', webViewLink: 'https://drive/folder' }),
        uploadToDrive: async () => ({ webViewLink: 'https://drive/file' }),
        getCustomerDocForGroup: async () => null,
        driveParentFolderId: 'PARENT'
    });

    moduleApi.stopCustomerMediaWorker();
    return { routes, botEvents, crons, queryCount, moduleApi };
}
const uploadCalls = [];

/* ---------- Hợp đồng tương thích: đổi là gãy Mini App đang chạy ---------- */

test('module đăng ký đúng route cũ của Mini App hồ sơ khách hàng', () => {
    const harness = createHarness();

    assert.deepEqual(
        harness.routes.map(route => `${route.method} ${route.path}`),
        ['POST /api/customer/save']
    );
    // auth → multer → handler, đúng thứ tự cũ.
    assert.equal(harness.routes[0].handlers.length, 3);
    assert.equal(harness.queryCount, 0, 'không được chạm database lúc khởi động');
});

test('field tệp vẫn là media_files, tối đa 20 — Mini App gửi đúng tên này', () => {
    createHarness();
    const last = uploadCalls[uploadCalls.length - 1];
    assert.equal(last.field, 'media_files');
    assert.equal(last.max, 20);
    assert.equal(rules.MAX_MEDIA_FILES, 20);
});

test('handler nhận ảnh reply đăng ký đúng 3 loại tin của Telegram', () => {
    const harness = createHarness();
    assert.equal(harness.botEvents.length, 1);
    assert.deepEqual(harness.botEvents[0].events, ['photo', 'video', 'document']);
});

test('cron tổng kết khách hàng vẫn chạy 22:00 hằng ngày', () => {
    const harness = createHarness();
    assert.deepEqual(harness.crons.map(job => job.expression), ['0 22 * * *']);
});

/* ---------- Quy tắc nghiệp vụ ---------- */

test('mã hồ sơ CR: đọc được từ tin nhắn đích, sai định dạng thì bỏ qua', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    assert.equal(rules.extractRecordId(`Mã hồ sơ: CR:${id}`), id);
    assert.equal(rules.extractRecordId('CR:khong-phai-uuid'), null);
    assert.equal(rules.extractRecordId(''), null);
    assert.equal(rules.extractRecordId(null), null);
});

test('chỉ nhóm đang bật đúng role mới dùng được chức năng', () => {
    const usable = { bot_role: 'customer', is_active: true, is_deleted: false };
    assert.equal(rules.isUsableCustomerGroup(usable), true);
    assert.equal(rules.isUsableCustomerGroup({ ...usable, bot_role: 'customer_record' }), true);
    assert.equal(rules.isUsableCustomerGroup({ ...usable, bot_role: 'report' }), false);
    assert.equal(rules.isUsableCustomerGroup({ ...usable, is_active: false }), false);
    assert.equal(rules.isUsableCustomerGroup({ ...usable, is_deleted: true }), false);
    assert.equal(rules.isUsableCustomerGroup(null), false);
});

test('giãn cách thử lại 1 → 5 → 15 → 30 phút rồi giữ nguyên', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 9].map(rules.retryDelayMinutes), [1, 5, 15, 30, 30, 30]);
    assert.equal(rules.retryDelayMinutes(0), 1, 'lần đầu không được lùi âm');
});

test('tin nhắn chế độ reply phải mang mã hồ sơ, chế độ thường thì không', () => {
    const data = {
        employeeName: 'A', consultant: 'B', customerType: 'NEW', customerName: 'C',
        phone: '09', address: '', service: 'S', gift: '',
        billAmount: 1000, paidAmount: 0, debtAmount: 1000, operator: 'D', warranty: ''
    };
    const options = { escapeHtml: v => String(v ?? ''), displayDate: '01/01/2026 08:00' };
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

    const reply = rules.buildRecordNotification(data, id, { ...options, replyMode: true });
    assert.match(reply, new RegExp(`CR:${id}`));
    assert.equal(rules.extractRecordId(reply), id, 'phải tự đọc lại được mã mình vừa ghi');

    const plain = rules.buildRecordNotification(data, id, { ...options, replyMode: false });
    assert.doesNotMatch(plain, /CR:/);
});

test('thứ tự từ chối khi nhận ảnh reply: hồ sơ → nhóm → chủ hồ sơ → định dạng → dung lượng', async () => {
    const record = {
        telegram_group_id: '-100', bot_role: 'customer', creator_telegram_id: '111'
    };
    const media = { fileSize: 1000, fileUniqueId: 'u1', mimeType: 'image/jpeg', mediaType: 'photo' };
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

    const build = (found, enqueued = 'job-1') => createAcceptTelegramMedia({
        repository: {
            async findRecordWithGroup() { return found; },
            async enqueueMedia() { return enqueued; }
        },
        now: () => 1700000000000
    });

    const call = (accept, over = {}) => accept({
        recordId: id, chatId: '-100', senderId: '111', media, ...over
    });

    assert.equal((await call(build(null))).result, ACCEPT_RESULT.RECORD_NOT_FOUND);
    assert.equal((await call(build(record), { chatId: '-999' })).result, ACCEPT_RESULT.WRONG_GROUP);
    assert.equal((await call(build({ ...record, bot_role: 'report' }))).result, ACCEPT_RESULT.WRONG_GROUP);
    assert.equal((await call(build(record), { senderId: '222' })).result, ACCEPT_RESULT.NOT_OWNER);

    // Người ngoài gửi file sai định dạng vẫn phải nhận lời từ chối về QUYỀN trước.
    assert.equal(
        (await call(build(record), { senderId: '222', unsupportedType: true })).result,
        ACCEPT_RESULT.NOT_OWNER
    );
    assert.equal((await call(build(record), { unsupportedType: true })).result, ACCEPT_RESULT.UNSUPPORTED_TYPE);

    assert.equal(
        (await call(build(record), { media: { ...media, fileSize: 21 * 1024 * 1024 } })).result,
        ACCEPT_RESULT.TOO_LARGE
    );
    assert.equal((await call(build(record, null))).result, ACCEPT_RESULT.DUPLICATE,
        'file trùng không được tải lên Drive lần hai');
    assert.equal((await call(build(record))).result, ACCEPT_RESULT.QUEUED);
});

test('tên file tự đặt khi Telegram không gửi kèm tên', async () => {
    let captured = null;
    const accept = createAcceptTelegramMedia({
        repository: {
            async findRecordWithGroup() {
                return { telegram_group_id: '-100', bot_role: 'customer', creator_telegram_id: '111' };
            },
            async enqueueMedia(media) { captured = media; return 'job-1'; }
        },
        now: () => 1700000000000
    });

    await accept({
        recordId: '0f8fad5b-d9cb-469f-a165-70867728950e',
        chatId: '-100',
        senderId: '111',
        media: { fileSize: 10, fileUniqueId: 'u1', mimeType: 'video/quicktime', mediaType: 'video', fileName: null }
    });
    assert.equal(captured.fileName, 'Customer_0f8fad5b_1700000000000.mov');
});

test('đăng hụt tin đích của chế độ reply thì hồ sơ bị gỡ, không để lại rác', async () => {
    // Nhân viên không thể reply vào một tin nhắn không tồn tại; giữ hồ sơ lại chỉ
    // tạo ra hồ sơ vĩnh viễn không có ảnh.
    const deleted = [];
    const createRecord = createCustomerRecordUseCase({
        repository: {
            async findEmployeeByTelegramId() { return { id: 7, full_name: 'A', telegram_group_id: '-100' }; },
            async findGroup() { return { id: 1, bot_role: 'customer', is_active: true, is_deleted: false }; },
            async insertRecord() { return '0f8fad5b-d9cb-469f-a165-70867728950e'; },
            async deleteRecord(id) { deleted.push(id); }
        },
        drive: {}, sheet: {},
        notifier: { async sendHtml() { throw new Error('Telegram từ chối'); } },
        moment: () => ({ utcOffset: () => ({ format: () => '2026-01-01' }) }),
        fs: {}, escapeHtml: v => String(v ?? ''), initializationJobs: new Map()
    });

    await assert.rejects(
        () => createRecord({
            telegramId: '111', chatId: '-100', files: [], mediaMode: 'telegram_reply',
            form: { phone: '09', bill_amount: '0', paid_amount: '0', debt_amount: '0' }
        }),
        error => error.status === 502
    );
    assert.deepEqual(deleted, ['0f8fad5b-d9cb-469f-a165-70867728950e']);
});

test('nhóm sai role bị chặn 403 trước khi ghi bất cứ thứ gì', async () => {
    let inserted = 0;
    const createRecord = createCustomerRecordUseCase({
        repository: {
            async findEmployeeByTelegramId() { return { id: 7, full_name: 'A' }; },
            async findGroup() { return { id: 1, bot_role: 'report', is_active: true, is_deleted: false }; },
            async insertRecord() { inserted += 1; return 'x'; }
        },
        drive: {}, sheet: {}, notifier: {},
        moment: () => ({ utcOffset: () => ({ format: () => '2026-01-01' }) }),
        fs: {}, escapeHtml: v => String(v ?? ''), initializationJobs: new Map()
    });

    await assert.rejects(
        () => createRecord({ telegramId: '111', chatId: '-100', mediaMode: 'mini_app', form: {} }),
        error => error.status === 403
    );
    assert.equal(inserted, 0);
});

test('timekeep_bot.js chỉ lắp ghép, không còn nghiệp vụ hồ sơ khách hàng', () => {
    const source = fs.readFileSync(
        fileURLToPath(new URL('../../../apps/bot/timekeep_bot.js', import.meta.url)), 'utf8');

    assert.match(source, /registerCustomerModule\(\{/);
    assert.doesNotMatch(source, /botApp\.post\(['"]\/api\/customer\/save/);
    assert.doesNotMatch(source, /INSERT INTO public\.customer_records/);
    assert.doesNotMatch(source, /customer_record_telegram_media/);
    assert.doesNotMatch(source, /THÔNG TIN KHÁCH HÀNG THỰC TẾ/);
    assert.doesNotMatch(source, /function buildCustomerRecordNotification/);
});

/* ---------- Luật kiến trúc, nhân bản từ domains/warehouse ---------- */

function domainFiles() {
    return fs.readdirSync(DOMAIN_DIR, { recursive: true })
        .map(entry => String(entry).split(path.sep).join('/'))
        .filter(entry => entry.endsWith('.js') && !entry.startsWith('tests/'));
}

const readFile = relative => fs.readFileSync(path.join(DOMAIN_DIR, relative), 'utf8');
const stripComments = source =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('đủ 4 tầng và một cổng index.js duy nhất', () => {
    for (const required of ['index.js', 'README.md', 'domain', 'application', 'infrastructure', 'interfaces']) {
        assert.ok(fs.existsSync(path.join(DOMAIN_DIR, required)), `thiếu ${required}`);
    }
});

test('tầng domain không phụ thuộc express, pg, telegraf hay Google API', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('domain/')) continue;
        for (const match of readFile(file).matchAll(/from\s+'([^']+)'/g)) {
            assert.ok(match[1].startsWith('.'), `${file} không được import thư viện ngoài: ${match[1]}`);
        }
    }
});

test('chỉ tầng infrastructure được viết SQL', () => {
    const SQL = /\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/;
    for (const file of domainFiles()) {
        if (file.startsWith('infrastructure/')) continue;
        assert.ok(
            !SQL.test(stripComments(readFile(file))),
            `${file} chứa SQL — mọi truy vấn phải nằm trong infrastructure/postgres/`
        );
    }
});

test('domain không được phụ thuộc ngược lên tầng trên', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('domain/')) continue;
        for (const match of readFile(file).matchAll(/from\s+'([^']+)'/g)) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
            assert.ok(
                target.startsWith('domain/') || !target.includes('/'),
                `${file} không được phụ thuộc tầng trên: ${target}`
            );
        }
    }
});

test('application không được biết tới interfaces', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('application/')) continue;
        for (const match of readFile(file).matchAll(/from\s+'([^']+)'/g)) {
            assert.ok(!match[1].includes('interfaces/'), `${file} không được import interfaces: ${match[1]}`);
        }
    }
});

test('mọi import tương đối trong domain đều trỏ tới file có thật', () => {
    for (const file of domainFiles()) {
        for (const match of readFile(file).matchAll(/from\s+'(\.[^']+)'/g)) {
            const target = path.resolve(path.dirname(path.join(DOMAIN_DIR, file)), match[1]);
            assert.ok(fs.existsSync(target), `${file} -> ${match[1]} không tồn tại`);
        }
    }
});

test('không file nào trong domain vượt 300 dòng', () => {
    const tooLong = domainFiles()
        .map(file => ({ file, lines: readFile(file).split('\n').length }))
        .filter(entry => entry.lines > 300)
        .map(entry => `${entry.file} (${entry.lines} dòng)`);
    assert.deepEqual(tooLong, [], 'Các file sau cần được tách nhỏ');
});

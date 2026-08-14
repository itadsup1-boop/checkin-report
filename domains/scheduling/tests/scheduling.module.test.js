import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSchedulingModule } from '../index.js';
import * as domainRules from '../domain/makeup-rules.js';

const DOMAIN_DIR = fileURLToPath(new URL('../', import.meta.url));

function createHarness() {
    const routes = [];
    const actions = [];
    let queryCount = 0;

    const moduleApi = registerSchedulingModule({
        botApp: {
            get(routePath, ...handlers) { routes.push({ method: 'GET', path: routePath, handlers }); },
            post(routePath, ...handlers) { routes.push({ method: 'POST', path: routePath, handlers }); }
        },
        bot: {},
        kpiComposer: { action(pattern, handler) { actions.push({ pattern: pattern.toString(), handler }); } },
        syncMakeupToGoogleSheet: async () => {},
        pool: {
            async query() {
                queryCount += 1;
                throw new Error('Không được truy vấn database lúc đăng ký module');
            },
            async connect() { throw new Error('Không được mở kết nối lúc đăng ký module'); }
        },
        authenticateTelegramMiniApp: (req, res, next) => next(),
        checkPayloadLimit: limit => { checkPayloadLimit.lastLimit = limit; return (req, res, next) => next(); },
        isValidImage: () => true,
        getImageExtension: () => '.jpg',
        escapeHtml: value => String(value),
        sendPhotoToRoleGroup: async () => ({}),
        fs: {},
        path,
        moment: () => ({ format: () => '2026-01-01' }),
        uploadDir: '/tmp/uploads',
        publicBaseUrl: 'https://example.test'
    });

    return { routes, actions, queryCount, moduleApi };
}
function checkPayloadLimit() {}

test('module lịch khách đăng ký đúng 3 endpoint cũ và không chạm database lúc khởi động', () => {
    const harness = createHarness();

    assert.deepEqual(
        harness.routes.map(route => `${route.method} ${route.path}`),
        [
            'GET /api/schedules/incomplete',
            'POST /api/schedules/makeup',
            'GET /api/schedules/makeup/history'
        ]
    );
    assert.equal(harness.queryCount, 0);
    assert.equal(Object.isFrozen(harness.moduleApi), true);
});

test('module đăng ký đúng 2 nút duyệt/từ chối, giữ nguyên callback_data cũ', () => {
    // Tin nhắn CŨ trong nhóm vẫn mang nút với đúng chuỗi này — đổi là các tin đó
    // bấm không ăn nữa.
    const harness = createHarness();
    assert.equal(harness.actions.length, 2);
    assert.match(harness.actions[0].pattern, /makeup_app_/);
    assert.match(harness.actions[1].pattern, /makeup_rej_/);
});

test('ai được duyệt: chính chủ, Quản lý nhóm, hoặc Admin', () => {
    // Quy tắc do chủ hệ thống đặt 14/08/2026: người đặt lịch tự duyệt được,
    // quản lý/admin duyệt hộ. Trước đó hệ thống CẤM tự duyệt.
    const { checkReviewPermission } = domainRules;
    const request = { status: 'PENDING', telegram_id: '111', telegram_group_id: '-1' };

    const cases = [
        ['chính chủ tự duyệt', '111', false, false, true],
        ['Quản lý duyệt hộ', '222', false, true, true],
        ['Admin duyệt hộ', '333', true, false, true],
        ['người ngoài', '444', false, false, false]
    ];
    for (const [label, clickerId, isAdmin, isManager, expected] of cases) {
        const verdict = checkReviewPermission({ request, clickerId, isAdmin, isManager });
        assert.equal(verdict.ok, expected, label);
    }

    // Yêu cầu đã xử lý rồi thì không ai bấm lại được, kể cả chính chủ.
    assert.equal(
        checkReviewPermission({
            request: { ...request, status: 'APPROVED' },
            clickerId: '111', isAdmin: true, isManager: true
        }).ok,
        false,
        'yêu cầu đã xử lý phải bị chặn'
    );
});

test('vai trò Quản lý phải đúng trong nhóm của yêu cầu', () => {
    // Quản lý nhóm khác không được duyệt hộ nhóm này.
    const repo = fs.readFileSync(
        path.join(DOMAIN_DIR, 'infrastructure', 'postgres', 'makeup-repository.js'), 'utf8');
    assert.match(repo, /e\.role = 'Quản lý'/);
    assert.match(repo, /m\.status = 'ACTIVE'/);
    assert.match(repo, /m\.telegram_group_id = \$2/);
});

test('tự duyệt phải để lại dấu vết trên tin nhắn', () => {
    // Bỏ chốt tiền kiểm thì dấu này là cách duy nhất hậu kiểm xem yêu cầu đã qua
    // người thứ hai hay chưa.
    const service = fs.readFileSync(
        path.join(DOMAIN_DIR, 'application', 'review-makeup-request.js'), 'utf8');
    assert.match(service, /isSelfReview: request\.telegram_id === clicker\.id/);

    const actions = fs.readFileSync(
        path.join(DOMAIN_DIR, 'interfaces', 'telegram', 'register-makeup-actions.js'), 'utf8');
    assert.match(actions, /isSelfReview \? ' <i>\(tự duyệt\)<\/i>' : ''/);
});

test('giới hạn payload giữ đúng 14MB như bản cũ', () => {
    // Ảnh base64 phình ~33% so với ảnh gốc; hạ mức này là chặn nhầm ảnh hợp lệ.
    const rules = fs.readFileSync(path.join(DOMAIN_DIR, 'domain', 'makeup-rules.js'), 'utf8');
    assert.match(rules, /MAX_PAYLOAD_BYTES = 14 \* 1024 \* 1024/);
    assert.match(rules, /MAX_PROOF_BYTES = 10 \* 1024 \* 1024/);
    assert.match(rules, /MAKEUP_WINDOW_HOURS = 48/);
});

test('kpi_features.js chỉ lắp ghép, không còn khai báo route báo bù trực tiếp', () => {
    const source = fs.readFileSync(
        fileURLToPath(new URL('../../../apps/bot/kpi_features.js', import.meta.url)), 'utf8');

    assert.match(source, /registerSchedulingModule\(\{/);
    assert.doesNotMatch(source, /botApp\.(get|post)\(['"]\/api\/schedules\/makeup/);
    assert.doesNotMatch(source, /botApp\.get\(['"]\/api\/schedules\/incomplete/);
    // Handler duyệt/từ chối cũng đã rời khỏi file này.
    assert.doesNotMatch(source, /kpiComposer\.action\(\/\^makeup_/);

    // SQL của việc TẠO yêu cầu phải rời khỏi file này.
    assert.doesNotMatch(source, /INSERT INTO tour_makeup_requests/);
    assert.doesNotMatch(source, /status = ANY\(\$5::text\[\]\)/);

    // Phần DUYỆT (makeup_app_/makeup_rej_) và đồng bộ Sheet CỐ Ý còn ở lại: nó nằm
    // sát vùng đang có người sửa dở, tách bây giờ sẽ đụng công của họ. Ghi rõ ở
    // đây để lần sau biết còn nợ gì, và để test không báo sai.
    // Đồng bộ Sheet CỐ Ý còn ở lại: nằm sát vùng đang có người sửa dở.
    assert.match(source, /syncMakeupToGoogleSheetWithRetry/, 'đồng bộ Sheet vẫn phải chạy');
});

test('module phải đăng ký TRƯỚC route /api/schedules/:id', () => {
    // Express khớp route theo thứ tự đăng ký. ':id' dùng ký tự đại diện nên nó nuốt
    // luôn '/api/schedules/incomplete'. Đăng ký module sau ':id' thì chữ "incomplete"
    // bị đem xuống database như số nguyên -> lỗi 500, ô "Chọn lịch thiếu cần bổ sung"
    // không tải được. Lỗi này từng tồn tại thật, đừng để tái diễn.
    const source = fs.readFileSync(
        fileURLToPath(new URL('../../../apps/bot/kpi_features.js', import.meta.url)), 'utf8');

    const moduleAt = source.indexOf('registerSchedulingModule({');
    const wildcardAt = source.indexOf("botApp.get('/api/schedules/:id'");

    assert.ok(moduleAt > 0, 'không tìm thấy lời gọi module');
    assert.ok(wildcardAt > 0, 'không tìm thấy route :id');
    assert.ok(
        moduleAt < wildcardAt,
        'registerSchedulingModule phải đứng TRƯỚC route /api/schedules/:id'
    );
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

test('tầng domain không phụ thuộc express, pg, telegraf hay Google API', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('domain/')) continue;
        const imports = [...readFile(file).matchAll(/from\s+'([^']+)'/g)].map(match => match[1]);
        for (const specifier of imports) {
            assert.ok(
                specifier.startsWith('.'),
                `${file} không được import thư viện ngoài: ${specifier}`
            );
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
            assert.ok(
                !match[1].includes('interfaces/'),
                `${file} không được import interfaces: ${match[1]}`
            );
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

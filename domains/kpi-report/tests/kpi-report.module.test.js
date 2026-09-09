import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerKpiReportModule } from '../index.js';

const DOMAIN_DIR = fileURLToPath(new URL('../', import.meta.url));

function createHarness() {
    const routes = [];
    const middlewares = [];
    const crons = [];
    const textHandlers = [];
    const photoHandlers = [];
    const commands = [];
    const actions = [];
    let queryCount = 0;

    const moduleApi = registerKpiReportModule({
        botApp: {
            get(routePath, ...handlers) { routes.push({ method: 'GET', path: routePath, handlers }); },
            post(routePath, ...handlers) { routes.push({ method: 'POST', path: routePath, handlers }); },
            use(routePath, handler) { middlewares.push({ path: routePath, handler }); }
        },
        bot: {},
        pool: {
            async query() {
                queryCount += 1;
                throw new Error('Không được truy vấn database lúc đăng ký module');
            },
            async connect() { throw new Error('Không được mở kết nối lúc đăng ký module'); }
        },
        kpiComposer: {
            on(event, handler) {
                if (event === 'text') textHandlers.push(handler);
                else photoHandlers.push({ event, handler });
            },
            command(name, handler) { commands.push({ name, handler }); },
            action(pattern, handler) { actions.push({ pattern: pattern.toString(), handler }); }
        },
        cron: { schedule(expression, handler) { crons.push({ expression, handler }); return { stop() {} }; } },
        authenticateTelegramMiniApp: (req, res, next) => next(),
        checkAdmin: () => true,
        getGroupRole: async () => 'report',
        sendMessageToRoleGroup: async () => ({}),
        sendMediaGroupToRoleGroup: async () => ({}),
        getKpiDocForGroup: async () => null,
        getEmployeeMembership: async () => null,
        computeHashFromBase64: async () => null,
        findDuplicateImages: async () => [],
        saveHashesToDB: async () => {},
        crypto: { createHmac: () => ({ update: () => ({ digest: () => 'x' }) }) }
    });

    return { routes, middlewares, crons, textHandlers, photoHandlers, commands, actions, queryCount, moduleApi };
}

test('module báo cáo KPI đăng ký đúng 2 endpoint và không chạm database lúc khởi động', () => {
    const harness = createHarness();
    assert.deepEqual(
        harness.routes.map(route => `${route.method} ${route.path}`),
        ['GET /api/bot/get-report-today', 'POST /api/bot/submit-report']
    );
    assert.equal(harness.queryCount, 0);
    assert.equal(Object.isFrozen(harness.moduleApi), true);
});

test('module đăng ký middleware role-guard cho /api/bot', () => {
    const harness = createHarness();
    assert.deepEqual(harness.middlewares.map(m => m.path), ['/api/bot']);
});

test('module đăng ký đúng 1 handler text và 1 handler photo/video', () => {
    const harness = createHarness();
    assert.equal(harness.textHandlers.length, 1);
    assert.deepEqual(harness.photoHandlers.map(h => h.event), [['photo', 'video']]);
});

test('module đăng ký đúng 6 lệnh cấu hình báo cáo', () => {
    const harness = createHarness();
    assert.deepEqual(
        harness.commands.map(c => c.name),
        ['hengio', 'phatvipham', 'phatbaocao', 'kpi', 'lichbaocao', 'taocaulenh']
    );
});

test('module đăng ký đúng 4 callback, giữ nguyên callback_data cũ', () => {
    const harness = createHarness();
    assert.deepEqual(
        harness.actions.map(a => a.pattern),
        ["REQUEST_LEAVE", '/^CANCEL_LEAVE_(\\d+)$/', '/^CONFIRM_LEAVE_(\\d+)$/', "CHECK_UPDATE_REPORT"]
    );
});

test('2 cron báo cáo KPI giữ nguyên tần suất mỗi phút', () => {
    const harness = createHarness();
    assert.deepEqual(harness.crons.map(job => job.expression), ['* * * * *', '* * * * *']);
});

/* ---------- Luật kiến trúc, nhân bản từ domains/warehouse và domains/scheduling ---------- */

function domainFiles() {
    return fs.readdirSync(DOMAIN_DIR, { recursive: true })
        .map(entry => String(entry).split(path.sep).join('/'))
        .filter(entry => entry.endsWith('.js') && !entry.startsWith('tests/'));
}

const readFile = relative => fs.readFileSync(path.join(DOMAIN_DIR, relative), 'utf8');
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('tầng domain không phụ thuộc express, pg, telegraf hay Google API', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('domain/')) continue;
        const imports = [...readFile(file).matchAll(/from\s+'([^']+)'/g)].map(match => match[1]);
        for (const specifier of imports) {
            assert.ok(specifier.startsWith('.'), `${file} không được import thư viện ngoài: ${specifier}`);
        }
    }
});

test('chỉ tầng infrastructure được viết SQL', () => {
    const SQL = /\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/;
    for (const file of domainFiles()) {
        if (file.startsWith('infrastructure/')) continue;
        assert.ok(!SQL.test(stripComments(readFile(file))), `${file} chứa SQL — mọi truy vấn phải nằm trong infrastructure/postgres/`);
    }
});

test('domain không được phụ thuộc ngược lên tầng trên', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('domain/')) continue;
        for (const match of readFile(file).matchAll(/from\s+'([^']+)'/g)) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
            assert.ok(target.startsWith('domain/') || !target.includes('/'), `${file} không được phụ thuộc tầng trên: ${target}`);
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

test('kpi_features.js chỉ lắp ghép, không còn khai báo báo cáo KPI trực tiếp', () => {
    const source = fs.readFileSync(
        fileURLToPath(new URL('../../../apps/bot/kpi_features.js', import.meta.url)), 'utf8');

    assert.match(source, /registerKpiReportModule\(\{/);
    assert.doesNotMatch(source, /function parseReport\(/);
    assert.doesNotMatch(source, /function processReport\(/);
    assert.doesNotMatch(source, /botApp\.(get|post)\(['"]\/api\/bot\/(get-report-today|submit-report)/);
    assert.doesNotMatch(source, /INSERT INTO daily_reports/);
    assert.doesNotMatch(source, /INSERT INTO pending_reports/);
    assert.doesNotMatch(source, /kpiComposer\.command\('hengio'/);
    assert.doesNotMatch(source, /kpiComposer\.command\('phatvipham'/);
    assert.doesNotMatch(source, /kpiComposer\.action\('REQUEST_LEAVE'/);
});

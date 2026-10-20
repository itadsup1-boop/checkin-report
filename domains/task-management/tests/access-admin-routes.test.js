import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTaskManagementAdminRoutes } from '../interfaces/admin-routes.js';
import { createTaskAccessService } from '../application/access-service.js';

function createFakeApp() {
    const routes = [];
    return {
        routes,
        get(path, ...handlers) { routes.push({ method: 'GET', path, handlers }); },
        post(path, ...handlers) { routes.push({ method: 'POST', path, handlers }); }
    };
}

function createFakeRepo() {
    const state = { codes: [], accounts: [], audit: [] };
    let seq = 1;
    return {
        state,
        async createAccessCode({ codeHash, role, scope, expiresAt, createdBy, boundTelegramUserId }) {
            const record = {
                id: `code-${seq++}`, role, scope, expires_at: expiresAt,
                status: 'ACTIVE', bound_telegram_user_id: boundTelegramUserId,
                created_by: createdBy, created_at: new Date()
            };
            state.codes.push(record);
            return record;
        },
        async listAccessCodes() { return state.codes; },
        async cancelAccessCode(codeId) {
            const code = state.codes.find(c => c.id === codeId && c.status === 'ACTIVE');
            if (code) code.status = 'CANCELLED';
            return code || null;
        },
        async listManagerAccounts() { return state.accounts; },
        async revokeManagerAccount(telegramUserId) {
            const account = state.accounts.find(a => a.telegram_user_id === String(telegramUserId) && a.status === 'ACTIVE');
            if (account) account.status = 'REVOKED';
            return account || null;
        },
        async appendAuditLog(entry) { state.audit.push(entry); }
    };
}

function createHarness() {
    const repo = createFakeRepo();
    const accessService = createTaskAccessService({ accessRepository: repo });
    const app = createFakeApp();
    const calls = { superAdmin: 0 };
    const requireSuperAdmin = (req, res, next) => { calls.superAdmin += 1; next(); };
    registerTaskManagementAdminRoutes({ app, accessService, requireSuperAdmin });
    return { repo, app, accessService, calls };
}

function createRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

function createReq(overrides = {}) {
    return { admin: { username: 'boss' }, params: {}, body: {}, ...overrides };
}

function findRoute(app, method, path) {
    const route = app.routes.find(r => r.method === method && r.path === path);
    assert.ok(route, `thiếu route ${method} ${path}`);
    return route;
}

async function run(route, req) {
    const res = createRes();
    for (const handler of route.handlers) {
        if (res.body !== null || res.statusCode !== 200) break;
        await handler(req, res, () => {});
    }
    return res;
}

test('mọi route web-admin đều nằm sau requireSuperAdmin', () => {
    const { app } = createHarness();
    const paths = [
        ['GET', '/api/admin/task-management/access-codes'],
        ['POST', '/api/admin/task-management/access-codes'],
        ['POST', '/api/admin/task-management/access-codes/:id/cancel'],
        ['POST', '/api/admin/task-management/managers/revoke']
    ];
    assert.equal(app.routes.length, paths.length);
    for (const [method, path] of paths) {
        const route = findRoute(app, method, path);
        assert.equal(route.handlers.length, 2, `${method} ${path} phải có middleware + handler`);
    }
});

test('POST tạo mã: scope rỗng (tất cả nhóm), createdBy ghi nguồn web-admin, kiểm tra đầu vào', async () => {
    const { app, repo } = createHarness();
    const route = findRoute(app, 'POST', '/api/admin/task-management/access-codes');

    const ok = await run(route, createReq({ body: { role: 'MANAGER', bindTelegramUserId: ' 111 ', expiresInHours: '48' } }));
    assert.equal(ok.statusCode, 200);
    assert.match(ok.body.code, /^TM-/);
    assert.deepEqual(ok.body.scope, []);
    assert.deepEqual(repo.state.codes[0].scope, []);
    assert.equal(repo.state.codes[0].bound_telegram_user_id, '111');
    assert.equal(repo.state.codes[0].created_by, 'web-admin:boss');
    const expectedExpiry = new Date(repo.state.codes[0].expires_at).getTime() - new Date(repo.state.codes[0].created_at).getTime();
    assert.ok(expectedExpiry > 47 * 3600 * 1000 && expectedExpiry <= 48 * 3600 * 1000);

    for (const bad of [
        { role: 'SUPER_BOSS' },
        { role: 'MANAGER', bindTelegramUserId: 'abc' },
        { role: 'MANAGER', expiresInHours: 0 },
        { role: 'MANAGER', expiresInHours: 169 }
    ]) {
        const res = await run(route, createReq({ body: bad }));
        assert.equal(res.statusCode, 400, `phải chặn đầu vào ${JSON.stringify(bad)}`);
    }
    assert.equal(repo.state.codes.length, 1);
});

test('POST tạo mã: bỏ trống thời hạn dùng mặc định 24 giờ', async () => {
    const { app, repo } = createHarness();
    const route = findRoute(app, 'POST', '/api/admin/task-management/access-codes');
    await run(route, createReq({ body: { role: 'TEAM_LEAD' } }));
    const expiry = new Date(repo.state.codes[0].expires_at).getTime() - new Date(repo.state.codes[0].created_at).getTime();
    assert.ok(expiry > 23 * 3600 * 1000 && expiry <= 24 * 3600 * 1000);
});

test('POST cancel: mã ACTIVE mới hủy được, mã khác trạng thái trả 400', async () => {
    const { app, repo, calls } = createHarness();
    const createRoute = findRoute(app, 'POST', '/api/admin/task-management/access-codes');
    const cancelRoute = findRoute(app, 'POST', '/api/admin/task-management/access-codes/:id/cancel');
    await run(createRoute, createReq({ body: { role: 'MANAGER' } }));
    const codeId = repo.state.codes[0].id;

    const ok = await run(cancelRoute, createReq({ params: { id: codeId } }));
    assert.equal(ok.statusCode, 200);
    assert.ok(calls.superAdmin >= 2);
    assert.ok(repo.state.audit.some(e => e.action === 'ACCESS_CODE_CANCELLED'));

    const again = await run(cancelRoute, createReq({ params: { id: codeId } }));
    assert.equal(again.statusCode, 400);
});

test('POST revoke: thiếu/sai Telegram ID trả 400, ID không tồn tại trả 400', async () => {
    const { app } = createHarness();
    const route = findRoute(app, 'POST', '/api/admin/task-management/managers/revoke');

    const bad = await run(route, createReq({ body: { telegramUserId: 'abc' } }));
    assert.equal(bad.statusCode, 400);

    const missing = await run(route, createReq({ body: { telegramUserId: '999' } }));
    assert.equal(missing.statusCode, 400);
    assert.match(missing.body.error, /Không tìm thấy/);
});

test('GET danh sách: trả codes + managers', async () => {
    const { app, repo } = createHarness();
    repo.state.accounts.push({ id: 'acc-1', telegram_user_id: '42', role: 'MANAGER', status: 'ACTIVE', activated_at: new Date() });
    const route = findRoute(app, 'GET', '/api/admin/task-management/access-codes');
    const res = await run(route, createReq());
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.codes));
    assert.equal(res.body.managers.length, 1);
});

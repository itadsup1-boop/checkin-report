import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    createAdminSessionToken,
    hashAdminPassword,
    hashAdminSessionToken,
    validateAdminPassword,
    verifyAdminPassword
} from '../../packages/shared/admin-auth-crypto.js';
import { createAdminAuth } from './admin-auth.js';

function fakeResponse() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

test('mật khẩu Admin dùng scrypt có salt và so sánh an toàn', async () => {
    const first = await hashAdminPassword('Mat khau rat dai 2026!');
    const second = await hashAdminPassword('Mat khau rat dai 2026!');
    assert.match(first, /^scrypt\$/);
    assert.notEqual(first, second, 'cùng mật khẩu vẫn phải có salt khác nhau');
    assert.equal((await verifyAdminPassword('Mat khau rat dai 2026!', first)).valid, true);
    assert.equal((await verifyAdminPassword('sai mat khau', first)).valid, false);
    assert.deepEqual(await verifyAdminPassword('legacy-secret', 'legacy-secret'), {
        valid: true,
        needsRehash: true
    });
});

test('mật khẩu mới tối thiểu 12 ký tự và không chứa username', () => {
    assert.equal(validateAdminPassword('ngan', 'admin').ok, false);
    assert.equal(validateAdminPassword('admin-mat-khau-rat-dai', 'admin').ok, false);
    assert.equal(validateAdminPassword('Mat khau rieng 2026!', 'admin').ok, true);
});

test('session token đủ ngẫu nhiên và database chỉ nhận bản băm', () => {
    const first = createAdminSessionToken();
    const second = createAdminSessionToken();
    assert.notEqual(first, second);
    assert.ok(first.length >= 40);
    assert.match(hashAdminSessionToken(first), /^[a-f0-9]{64}$/);
    assert.notEqual(hashAdminSessionToken(first), first);
});

test('middleware bỏ qua header vai trò tự khai và chỉ tin session trong database', async () => {
    const token = createAdminSessionToken();
    const queries = [];
    const pool = {
        async query(sql) {
            queries.push(sql);
            if (sql.includes('FROM admin_sessions session')) {
                return { rows: [{
                    session_id: 'session-1',
                    id: 'admin-db-id',
                    username: 'staff-admin',
                    full_name: 'Staff Admin',
                    role: 'ADMIN',
                    is_active: true
                }] };
            }
            if (sql.includes('FROM admin_group_mappings')) {
                return { rows: [{ telegram_group_id: '-100' }] };
            }
            return { rows: [] };
        }
    };
    const auth = createAdminAuth({ pool });

    const forgedReq = { headers: { 'x-admin-id': 'fake', 'x-admin-role': 'SUPER_ADMIN' } };
    const forgedRes = fakeResponse();
    await auth.authenticateAdmin(forgedReq, forgedRes, () => assert.fail('header giả không được đi tiếp'));
    assert.equal(forgedRes.statusCode, 401);

    const req = {
        headers: {
            authorization: `Bearer ${token}`,
            'x-admin-role': 'SUPER_ADMIN'
        }
    };
    const res = fakeResponse();
    let continued = false;
    await auth.authenticateAdmin(req, res, () => { continued = true; });
    assert.equal(continued, true);
    assert.equal(req.admin.id, 'admin-db-id');
    assert.equal(req.admin.role, 'ADMIN');
    assert.equal(req.admin.isSuperAdmin, false);
    assert.deepEqual(req.admin.allowedGroupIds, ['-100']);
    assert.ok(queries.some(sql => sql.includes('token_hash = $1')));
});

test('route đăng nhập đứng trước middleware; route nghiệp vụ đứng sau middleware', () => {
    const apiSource = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
    const loginAt = apiSource.indexOf('adminAuth.registerLoginRoute(app)');
    const middlewareAt = apiSource.indexOf("app.use('/api/admin', adminAuth.authenticateAdmin)");
    const businessAt = apiSource.indexOf('registerWarehouseAdminRoutes({ app, pool })');
    assert.ok(loginAt > 0 && loginAt < middlewareAt);
    assert.ok(middlewareAt < businessAt);
    assert.doesNotMatch(apiSource, /admin-token-123|token-\$\{|password_hash !== password/);
});

test('migration session có hạn dùng, thu hồi và không lưu token thô', () => {
    const migration = fs.readFileSync(
        new URL('../../packages/database/migrations/v31_admin_security.sql', import.meta.url),
        'utf8'
    );
    for (const field of ['token_hash', 'expires_at', 'last_used_at', 'revoked_at']) {
        assert.match(migration, new RegExp(field), field);
    }
    assert.doesNotMatch(migration, /\btoken\s+VARCHAR/i);
});

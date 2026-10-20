import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskAccessService, ROLE_PERMISSIONS } from '../application/access-service.js';

function createMockRepo() {
    const state = { codes: [], accounts: [], permissions: [], scopes: [], audit: [] };
    let seq = 1;
    return {
        state,
        async createAccessCode({ codeHash, role, scope, expiresAt, createdBy, boundTelegramUserId }) {
            const record = {
                id: `code-${seq++}`, code_hash: codeHash, role, scope,
                expires_at: expiresAt, max_attempts: 5, attempt_count: 0,
                status: 'ACTIVE', bound_telegram_user_id: boundTelegramUserId,
                created_by: createdBy
            };
            state.codes.push(record);
            return record;
        },
        async findAccessCodeByHash(hash) {
            return state.codes.find(c => c.code_hash === hash) || null;
        },
        async incrementAccessCodeAttempts(codeId) {
            const code = state.codes.find(c => c.id === codeId);
            code.attempt_count += 1;
            return { attempt_count: code.attempt_count, max_attempts: code.max_attempts };
        },
        async lockAccessCode(codeId) {
            state.codes.find(c => c.id === codeId).status = 'CANCELLED';
        },
        async markAccessCodeRedeemed(codeId, telegramUserId) {
            const code = state.codes.find(c => c.id === codeId);
            code.status = 'REDEEMED';
            code.redeemed_by_telegram_user_id = telegramUserId;
            return code;
        },
        async upsertManagerAccount({ employeeId, telegramUserId, role, grantedBy }) {
            let account = state.accounts.find(a => a.telegram_user_id === telegramUserId);
            if (account) {
                Object.assign(account, { role, status: 'ACTIVE', revoked_at: null, granted_by: grantedBy, employee_id: employeeId });
            } else {
                account = {
                    id: `acc-${seq++}`, employee_id: employeeId, telegram_user_id: telegramUserId,
                    role, status: 'ACTIVE', activated_at: new Date(), revoked_at: null, granted_by: grantedBy
                };
                state.accounts.push(account);
            }
            return account;
        },
        async replaceManagerPermissions(accountId, permissions) {
            state.permissions = state.permissions.filter(p => p.manager_account_id !== accountId);
            for (const permission of permissions) {
                state.permissions.push({ manager_account_id: accountId, permission });
            }
        },
        async replaceManagerScopes(accountId, scopes) {
            state.scopes = state.scopes.filter(s => s.manager_account_id !== accountId);
            for (const scope of scopes) {
                state.scopes.push({ manager_account_id: accountId, ...scope });
            }
        },
        async getManagerAccountByTelegramId(telegramUserId) {
            const account = state.accounts.find(a => a.telegram_user_id === String(telegramUserId) && a.status === 'ACTIVE');
            if (!account) return null;
            return {
                ...account,
                permissions: state.permissions.filter(p => p.manager_account_id === account.id).map(p => p.permission),
                scopes: state.scopes.filter(s => s.manager_account_id === account.id).map(s => ({ type: s.type, value: s.value }))
            };
        },
        async revokeManagerAccount(telegramUserId) {
            const account = state.accounts.find(a => a.telegram_user_id === String(telegramUserId) && a.status === 'ACTIVE');
            if (!account) return null;
            account.status = 'REVOKED';
            account.revoked_at = new Date();
            return account;
        },
        async listAccessCodes() {
            return state.codes.map(({ code_hash, ...rest }) => rest);
        },
        async cancelAccessCode(codeId) {
            const code = state.codes.find(c => c.id === codeId && c.status === 'ACTIVE');
            if (code) code.status = 'CANCELLED';
            return code || null;
        },
        async listManagerAccounts() {
            return state.accounts.map(a => ({ ...a, full_name: a.telegram_user_id === '42' ? 'Nguyễn Văn A' : null }));
        },
        async appendAuditLog(entry) {
            state.audit.push(entry);
        }
    };
}

function createService() {
    const repo = createMockRepo();
    return { repo, service: createTaskAccessService({ accessRepository: repo }) };
}

test('tạo mã: đúng format 128-bit, hash chuẩn hoá, ghi audit', async () => {
    const { repo, service } = createService();
    const created = await service.createAccessCode({ role: 'MANAGER', createdBy: 'admin-1' });

    assert.match(created.code, /^TM-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
    assert.equal(repo.state.codes[0].code_hash, service.hashCode(created.code));
    assert.equal(repo.state.codes[0].role, 'MANAGER');
    assert.ok(repo.state.audit.some(e => e.action === 'ACCESS_CODE_CREATED' && e.actorType === 'ADMIN'));

    await assert.rejects(
        service.createAccessCode({ role: 'SUPER_BOSS', createdBy: 'admin-1' }),
        error => error.code === 'INVALID_ROLE'
    );
});

test('redeem mã hợp lệ: cấp đúng quyền theo role, copy scope, mã thành REDEEMED', async () => {
    const { repo, service } = createService();
    const created = await service.createAccessCode({
        role: 'MANAGER',
        scope: [{ type: 'TELEGRAM_GROUP', value: '-100123' }],
        createdBy: 'admin-1'
    });

    const result = await service.redeemCode({ code: created.code.toLowerCase(), telegramUserId: 42 });

    assert.equal(result.role, 'MANAGER');
    assert.deepEqual(result.permissions, ROLE_PERMISSIONS.MANAGER);
    assert.deepEqual(result.scope, [{ type: 'TELEGRAM_GROUP', value: '-100123' }]);
    assert.equal(result.account.status, 'ACTIVE');
    assert.equal(result.account.telegram_user_id, '42');
    assert.equal(repo.state.codes[0].status, 'REDEEMED');
    assert.equal(repo.state.codes[0].redeemed_by_telegram_user_id, '42');
    assert.ok(repo.state.audit.some(e => e.action === 'MANAGER_ACTIVATED'));
});

test('mã sai → CODE_INVALID, ghi audit REDEEM_FAILED', async () => {
    const { repo, service } = createService();
    await assert.rejects(
        service.redeemCode({ code: 'TM-0000-0000-0000-0000-0000-0000-0000-0000', telegramUserId: 1 }),
        error => error.code === 'CODE_INVALID'
    );
    assert.ok(repo.state.audit.some(e => e.action === 'REDEEM_FAILED'));
});

test('mã hết hạn → CODE_EXPIRED và bị khóa khi nhập sai đủ số lần', async () => {
    const { repo, service } = createService();
    const expired = await service.createAccessCode({ role: 'MANAGER', createdBy: 'admin-1', expiresInHours: -1 });
    repo.state.codes[0].max_attempts = 1;

    await assert.rejects(
        service.redeemCode({ code: expired.code, telegramUserId: 1 }),
        error => error.code === 'CODE_EXPIRED'
    );
    assert.equal(repo.state.codes[0].status, 'CANCELLED');

    await assert.rejects(
        service.redeemCode({ code: expired.code, telegramUserId: 1 }),
        error => error.code === 'CODE_LOCKED'
    );
});

test('mã đã dùng → CODE_USED', async () => {
    const { service } = createService();
    const created = await service.createAccessCode({ role: 'TEAM_LEAD', createdBy: 'admin-1' });
    await service.redeemCode({ code: created.code, telegramUserId: 7 });

    await assert.rejects(
        service.redeemCode({ code: created.code, telegramUserId: 8 }),
        error => error.code === 'CODE_USED'
    );
});

test('mã ràng buộc Telegram ID khác → CODE_BOUND_TO_OTHER', async () => {
    const { service } = createService();
    const created = await service.createAccessCode({
        role: 'MANAGER', createdBy: 'admin-1', boundTelegramUserId: '111'
    });

    await assert.rejects(
        service.redeemCode({ code: created.code, telegramUserId: 222 }),
        error => error.code === 'CODE_BOUND_TO_OTHER'
    );
    const ok = await service.redeemCode({ code: created.code, telegramUserId: '111' });
    assert.equal(ok.account.telegram_user_id, '111');
});

test('thu hồi quyền; thu hồi lần hai báo không tìm thấy', async () => {
    const { repo, service } = createService();
    const created = await service.createAccessCode({ role: 'MANAGER', createdBy: 'admin-1' });
    await service.redeemCode({ code: created.code, telegramUserId: 9 });

    const revoked = await service.revokeManager({ telegramUserId: 9, revokedBy: 'admin-1' });
    assert.equal(revoked.status, 'REVOKED');
    assert.equal(await service.getManager(9), null);
    assert.ok(repo.state.audit.some(e => e.action === 'MANAGER_REVOKED'));

    await assert.rejects(
        service.revokeManager({ telegramUserId: 9, revokedBy: 'admin-1' }),
        error => error.code === 'ACCOUNT_NOT_FOUND'
    );
});

test('hasPermission và isWithinScope kiểm tra trạng thái và phạm vi', async () => {
    const { service } = createService();
    const created = await service.createAccessCode({
        role: 'MANAGER',
        scope: [{ type: 'TELEGRAM_GROUP', value: '-1001' }],
        createdBy: 'admin-1'
    });
    const { account } = await service.redeemCode({ code: created.code, telegramUserId: 5 });
    const manager = await service.getManager(5);

    assert.equal(service.hasPermission(manager, 'tasks.create'), true);
    assert.equal(service.hasPermission(manager, 'excel.sync'), false);
    assert.equal(service.isWithinScope(manager, { telegramGroupId: '-1001' }), true);
    assert.equal(service.isWithinScope(manager, { telegramGroupId: '-1002' }), false);
    assert.equal(service.hasPermission({ ...manager, status: 'REVOKED' }, 'tasks.create'), false);
    assert.equal(account.id, manager.id);
});

test('web-admin: list mã không lộ hash, cancel chỉ hiệu lực với mã ACTIVE, ghi audit', async () => {
    const { repo, service } = createService();
    const active = await service.createAccessCode({ role: 'MANAGER', createdBy: 'admin-1' });
    const used = await service.createAccessCode({ role: 'OWNER', createdBy: 'admin-1' });
    await service.redeemCode({ code: used.code, telegramUserId: 42 });

    const listed = await service.listAccessCodes();
    assert.equal(listed.length, 2);
    assert.ok(listed.every(code => !('code_hash' in code)));

    const cancelled = await service.cancelAccessCode({ codeId: active.id, cancelledBy: 'web-admin:boss' });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.ok(repo.state.audit.some(e => e.action === 'ACCESS_CODE_CANCELLED' && e.actorId === 'web-admin:boss'));

    await assert.rejects(
        service.cancelAccessCode({ codeId: used.id, cancelledBy: 'web-admin:boss' }),
        error => error.code === 'CODE_NOT_ACTIVE'
    );
    await assert.rejects(
        service.cancelAccessCode({ codeId: active.id, cancelledBy: 'web-admin:boss' }),
        error => error.code === 'CODE_NOT_ACTIVE'
    );
});

test('web-admin: listManagerAccounts trả tên nhân viên theo account', async () => {
    const { service } = createService();
    const created = await service.createAccessCode({ role: 'MANAGER', createdBy: 'admin-1' });
    await service.redeemCode({ code: created.code, telegramUserId: 42 });

    const managers = await service.listManagerAccounts();
    assert.equal(managers.length, 1);
    assert.equal(managers[0].telegram_user_id, '42');
    assert.equal(managers[0].full_name, 'Nguyễn Văn A');
});

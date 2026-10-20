import crypto from 'node:crypto';

const ALL_PERMISSIONS = [
    'tasks.create', 'tasks.extend', 'tasks.view_team',
    'reports.form.create', 'reports.aggregate', 'reports.evaluate',
    'excel.import', 'excel.export', 'excel.sync',
    'messages.send_individual', 'messages.send_bulk',
    'rules.manage', 'alerts.view', 'employees.evaluate'
];

export const ROLE_PERMISSIONS = {
    OWNER: ALL_PERMISSIONS,
    MANAGER: [
        'tasks.create', 'tasks.extend', 'tasks.view_team',
        'reports.aggregate', 'reports.evaluate',
        'excel.import', 'excel.export',
        'messages.send_individual', 'alerts.view'
    ],
    TEAM_LEAD: ['tasks.create', 'tasks.view_team', 'alerts.view']
};

const DEFAULT_EXPIRY_HOURS = 24;

function fail(code, message) {
    throw Object.assign(new Error(message), { code });
}

export function createTaskAccessService({ accessRepository, now = () => new Date() }) {
    function normalizeCode(raw) {
        return String(raw || '').replace(/[\s-]/g, '').toUpperCase();
    }

    function hashCode(raw) {
        return crypto.createHash('sha256').update(normalizeCode(raw)).digest('hex');
    }

    function generateCode() {
        // 128-bit entropy (mục 23.3 kế hoạch): 16 byte hex, hiển thị theo nhóm 4 ký tự
        const hex = crypto.randomBytes(16).toString('hex').toUpperCase();
        return 'TM-' + hex.match(/.{4}/g).join('-');
    }

    async function createAccessCode({ role, scope = [], expiresInHours = DEFAULT_EXPIRY_HOURS, createdBy, boundTelegramUserId = null }) {
        if (!ROLE_PERMISSIONS[role]) {
            fail('INVALID_ROLE', `Vai trò không hợp lệ. Chọn một trong: ${Object.keys(ROLE_PERMISSIONS).join(', ')}.`);
        }
        const code = generateCode();
        const expiresAt = new Date(now().getTime() + expiresInHours * 3600 * 1000);
        const record = await accessRepository.createAccessCode({
            codeHash: hashCode(code),
            role,
            scope,
            expiresAt,
            createdBy,
            boundTelegramUserId
        });
        await accessRepository.appendAuditLog({
            actorType: 'ADMIN',
            actorId: createdBy,
            action: 'ACCESS_CODE_CREATED',
            entityType: 'access_code',
            entityId: record.id,
            details: { role, scope, expiresInHours, boundTelegramUserId }
        });
        return { id: record.id, code, role, scope, expiresAt };
    }

    async function redeemCode({ code, telegramUserId, employeeId = null }) {
        const record = await accessRepository.findAccessCodeByHash(hashCode(code));
        if (!record) {
            await accessRepository.appendAuditLog({
                actorType: 'MANAGER',
                actorId: String(telegramUserId),
                action: 'REDEEM_FAILED',
                entityType: 'access_code',
                entityId: null,
                details: { reason: 'CODE_NOT_FOUND' }
            });
            fail('CODE_INVALID', '❌ Mã không đúng hoặc không tồn tại.');
        }

        if (record.status === 'REDEEMED') {
            fail('CODE_USED', '❌ Mã này đã được sử dụng trước đó.');
        }
        if (record.status === 'CANCELLED') {
            fail('CODE_LOCKED', '❌ Mã này đã bị khóa do nhập sai quá nhiều lần.');
        }

        const failedValidation = async (errorCode, message) => {
            await punishFailedAttempt(record, telegramUserId, errorCode);
            fail(errorCode, message);
        };

        if (new Date(record.expires_at).getTime() <= now().getTime()) {
            await failedValidation('CODE_EXPIRED', '❌ Mã đã hết hạn.');
        }
        if (record.bound_telegram_user_id && record.bound_telegram_user_id !== String(telegramUserId)) {
            await failedValidation('CODE_BOUND_TO_OTHER', '❌ Mã này được cấp riêng cho một Telegram ID khác.');
        }

        const account = await accessRepository.upsertManagerAccount({
            employeeId,
            telegramUserId: String(telegramUserId),
            role: record.role,
            grantedBy: record.created_by
        });
        await accessRepository.replaceManagerPermissions(account.id, ROLE_PERMISSIONS[record.role]);
        await accessRepository.replaceManagerScopes(account.id, record.scope || []);
        await accessRepository.markAccessCodeRedeemed(record.id, String(telegramUserId));
        await accessRepository.appendAuditLog({
            actorType: 'MANAGER',
            actorId: String(telegramUserId),
            action: 'MANAGER_ACTIVATED',
            entityType: 'manager_account',
            entityId: account.id,
            details: { role: record.role, access_code_id: record.id }
        });

        return {
            account,
            role: record.role,
            permissions: ROLE_PERMISSIONS[record.role],
            scope: record.scope || []
        };
    }

    async function punishFailedAttempt(record, telegramUserId, reason) {
        const updated = await accessRepository.incrementAccessCodeAttempts(record.id);
        await accessRepository.appendAuditLog({
            actorType: 'MANAGER',
            actorId: String(telegramUserId),
            action: 'REDEEM_FAILED',
            entityType: 'access_code',
            entityId: record.id,
            details: { reason }
        });
        if (updated && updated.attempt_count >= updated.max_attempts) {
            await accessRepository.lockAccessCode(record.id);
            await accessRepository.appendAuditLog({
                actorType: 'SYSTEM',
                actorId: String(telegramUserId),
                action: 'ACCESS_CODE_LOCKED',
                entityType: 'access_code',
                entityId: record.id,
                details: { reason }
            });
        }
    }

    async function revokeManager({ telegramUserId, revokedBy }) {
        const revoked = await accessRepository.revokeManagerAccount(String(telegramUserId));
        if (!revoked) {
            fail('ACCOUNT_NOT_FOUND', '❌ Không tìm thấy tài khoản quản lý đang hoạt động với Telegram ID này.');
        }
        await accessRepository.appendAuditLog({
            actorType: 'ADMIN',
            actorId: revokedBy,
            action: 'MANAGER_REVOKED',
            entityType: 'manager_account',
            entityId: revoked.id,
            details: { revokedTelegramUserId: String(telegramUserId) }
        });
        return revoked;
    }

    async function getManager(telegramUserId) {
        return accessRepository.getManagerAccountByTelegramId(String(telegramUserId));
    }

    function hasPermission(manager, permission) {
        if (!manager || manager.status !== 'ACTIVE') return false;
        return (manager.permissions || []).includes(permission);
    }

    function isWithinScope(manager, { telegramGroupId = null, employeeId = null } = {}) {
        if (!manager || manager.status !== 'ACTIVE') return false;
        const scopes = manager.scopes || [];
        if (!scopes.length) return true;
        if (telegramGroupId && scopes.some(s => s.type === 'TELEGRAM_GROUP' && s.value === String(telegramGroupId))) {
            return true;
        }
        if (employeeId && scopes.some(s => s.type === 'EMPLOYEE' && s.value === String(employeeId))) {
            return true;
        }
        return false;
    }

    async function listAccessCodes() {
        return accessRepository.listAccessCodes();
    }

    async function cancelAccessCode({ codeId, cancelledBy }) {
        const cancelled = await accessRepository.cancelAccessCode(codeId);
        if (!cancelled) {
            fail('CODE_NOT_ACTIVE', 'Mã này không còn ở trạng thái chờ kích hoạt (đã dùng, đã thu hồi hoặc đã khóa).');
        }
        await accessRepository.appendAuditLog({
            actorType: 'ADMIN',
            actorId: cancelledBy,
            action: 'ACCESS_CODE_CANCELLED',
            entityType: 'access_code',
            entityId: cancelled.id,
            details: { role: cancelled.role }
        });
        return cancelled;
    }

    async function listManagerAccounts() {
        return accessRepository.listManagerAccounts();
    }

    return {
        normalizeCode,
        hashCode,
        createAccessCode,
        redeemCode,
        revokeManager,
        getManager,
        hasPermission,
        isWithinScope,
        listAccessCodes,
        cancelAccessCode,
        listManagerAccounts,
        ROLE_PERMISSIONS
    };
}

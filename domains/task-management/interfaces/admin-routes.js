import { createTaskAccessRepository } from '../infrastructure/postgres/access-repository.js';
import { createTaskAccessService, ROLE_PERMISSIONS } from '../application/access-service.js';

const CODE_EXPIRY_MAX_HOURS = 168;

function adminActor(req) {
    return `web-admin:${req.admin.username}`;
}

function isTelegramId(value) {
    return /^\d{3,20}$/.test(String(value || ''));
}

export function registerTaskManagementAdminRoutes({ app, accessService, requireSuperAdmin }) {
    const ROLES = Object.keys(ROLE_PERMISSIONS);

    app.get('/api/admin/task-management/access-codes', requireSuperAdmin, async (req, res) => {
        try {
            const [codes, managers] = await Promise.all([
                accessService.listAccessCodes(),
                accessService.listManagerAccounts()
            ]);
            res.json({ codes, managers });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // scope: [] — không giới hạn nhóm, quản lý điều hành được mọi nhóm hiện có và nhóm thêm sau.
    app.post('/api/admin/task-management/access-codes', requireSuperAdmin, async (req, res) => {
        try {
            const { role, bindTelegramUserId, expiresInHours } = req.body || {};
            if (!ROLES.includes(role)) {
                return res.status(400).json({ error: `Vai trò không hợp lệ. Chọn một trong: ${ROLES.join(', ')}.` });
            }
            const bind = bindTelegramUserId ? String(bindTelegramUserId).trim() : null;
            if (bind && !isTelegramId(bind)) {
                return res.status(400).json({ error: 'Telegram ID ràng buộc phải là dãy số.' });
            }
            let hours;
            if (expiresInHours !== undefined && expiresInHours !== null && expiresInHours !== '') {
                hours = Number(expiresInHours);
                if (!Number.isInteger(hours) || hours < 1 || hours > CODE_EXPIRY_MAX_HOURS) {
                    return res.status(400).json({ error: `Thời hạn phải là số nguyên từ 1 đến ${CODE_EXPIRY_MAX_HOURS} giờ.` });
                }
            }
            const created = await accessService.createAccessCode({
                role,
                scope: [],
                createdBy: adminActor(req),
                boundTelegramUserId: bind,
                ...(hours !== undefined ? { expiresInHours: hours } : {})
            });
            res.json({ code: created.code, role: created.role, scope: created.scope, expiresAt: created.expiresAt });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/admin/task-management/access-codes/:id/cancel', requireSuperAdmin, async (req, res) => {
        try {
            await accessService.cancelAccessCode({ codeId: req.params.id, cancelledBy: adminActor(req) });
            res.json({ success: true });
        } catch (error) {
            res.status(error.code === 'CODE_NOT_ACTIVE' ? 400 : 500).json({ error: error.message });
        }
    });

    app.post('/api/admin/task-management/managers/revoke', requireSuperAdmin, async (req, res) => {
        try {
            const { telegramUserId } = req.body || {};
            if (!isTelegramId(telegramUserId)) {
                return res.status(400).json({ error: 'Telegram ID không hợp lệ.' });
            }
            await accessService.revokeManager({ telegramUserId: String(telegramUserId), revokedBy: adminActor(req) });
            res.json({ success: true });
        } catch (error) {
            res.status(error.code === 'ACCOUNT_NOT_FOUND' ? 400 : 500).json({ error: error.message });
        }
    });
}

export function registerTaskManagementAdminModule({ app, pool, requireSuperAdmin }) {
    const accessRepository = createTaskAccessRepository({ pool });
    const accessService = createTaskAccessService({ accessRepository });
    registerTaskManagementAdminRoutes({ app, accessService, requireSuperAdmin });
    return { accessService };
}

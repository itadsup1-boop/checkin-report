/**
 * Xác định "ai đang thao tác và được phép làm gì".
 *
 * Gom một chỗ vì đây là điểm quyết định phân quyền của toàn bộ nghiệp vụ kho:
 * mọi use case đều bắt đầu bằng việc dựng ngữ cảnh này. Rải rác nhiều nơi thì
 * rất khó rà soát khi cần kiểm tra bảo mật.
 *
 * Quy tắc: quyền duyệt do Admin gán theo từng nhóm (tk_warehouse_permissions),
 * KHÔNG lấy từ chức danh nhân viên tự chọn.
 */

import { WarehouseError } from '../../domain/constants.js';

function parseAdminIds(adminIds) {
    if (adminIds instanceof Set) return adminIds;
    if (Array.isArray(adminIds)) return new Set(adminIds.map(String));
    return new Set(String(adminIds || '').split(',').map(value => value.trim()).filter(Boolean));
}

export function createActorContextResolver({ pool, repository, adminIds = [] }) {
    const adminTelegramIds = parseAdminIds(adminIds);

    /**
     * Ngữ cảnh của người thao tác từ Telegram.
     * @param {object} db client của transaction, hoặc pool khi chỉ đọc.
     */
    async function getActorContext(db, telegramId, chatId, { requireEmployee = false } = {}) {
        const group = await repository.getActiveGroup(chatId, db);
        const isAdmin = adminTelegramIds.has(String(telegramId));

        let employee = null;
        try {
            employee = await repository.getActiveEmployee(telegramId, chatId, db);
        } catch (error) {
            // Admin hệ thống có thể chưa có bản ghi nhân sự trong nhóm này.
            if (!isAdmin || requireEmployee) throw error;
        }

        const permissions = employee
            ? await repository.getPermissionSet(employee.id, chatId, db)
            : new Set();

        if (employee && !isAdmin) {
            const isGroupMember = await repository.hasActiveGroupMembership(employee.id, chatId, db);
            if (!isGroupMember && permissions.size === 0) {
                throw new WarehouseError('Bạn không phải thành viên của nhóm kho này.', {
                    status: 403,
                    code: 'WAREHOUSE_GROUP_MEMBERSHIP_REQUIRED'
                });
            }
        }

        return {
            group,
            employee,
            permissions,
            isAdmin,
            telegramId: String(telegramId)
        };
    }

    /**
     * Ngữ cảnh cho thao tác phát sinh từ Web Admin.
     * Admin đã được xác thực ở tầng HTTP nên ở đây mặc định có toàn quyền.
     */
    async function getAdminActorContext(db, groupId, adminId) {
        const group = await repository.getWarehouseGroupById(groupId, db);
        if (!group) {
            throw new WarehouseError('Không tìm thấy group kho đang hoạt động.', { status: 404 });
        }
        return {
            group,
            employee: null,
            permissions: new Set(),
            isAdmin: true,
            telegramId: `admin:${adminId}`
        };
    }

    /** Dùng cho các route chỉ cần kiểm tra quyền truy cập, không mở transaction. */
    async function authorizeActor({ telegramId, chatId, requireEmployee = false }) {
        return getActorContext(pool, telegramId, chatId, { requireEmployee });
    }

    return { getActorContext, getAdminActorContext, authorizeActor };
}

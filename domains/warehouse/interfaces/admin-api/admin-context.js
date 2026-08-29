/**
 * Xác thực phiên Admin và phạm vi nhóm kho được phép quản trị.
 *
 * Tách riêng để 20 route không lặp lại logic này, và để chỗ quyết định
 * "ai được làm gì" nằm gọn một nơi khi cần rà soát bảo mật.
 */

import { WarehouseError } from '../../domain/constants.js';

/** Chuẩn hoá mã dịch vụ do Admin nhập. */
export function normalizeServiceCode(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]+/g, '_')
        .slice(0, 50);
}

/** Chuẩn hoá lỗi trả về cho Web Admin. */
export function sendError(res, error) {
    if (error instanceof WarehouseError || error?.name === 'WarehouseError') {
        return res.status(error.status || 400).json({
            success: false,
            code: error.code,
            message: error.message,
            details: error.details || undefined
        });
    }
    console.error('[Warehouse Admin API]', error);
    return res.status(500).json({ success: false, message: error.message || 'Lỗi máy chủ.' });
}

/**
 * Tạo bộ kiểm tra phiên Admin dùng chung cho mọi nhóm route.
 */
export function createAdminContext({ pool }) {
    async function getContext(req) {
        if (!req.admin?.id || !req.admin?.role) {
            throw new WarehouseError('Phiên đăng nhập Admin không hợp lệ.', { status: 401 });
        }
        return {
            adminId: String(req.admin.id),
            role: req.admin.role,
            isSuperAdmin: req.admin.isSuperAdmin,
            allowedGroupIds: (req.admin.allowedGroupIds || []).map(String)
        };
    }

    async function requireWarehouseGroup(context, groupId) {
        const normalized = String(groupId || '').trim();
        if (!normalized || normalized === 'ALL') {
            throw new WarehouseError('Vui lòng chọn một nhóm quản lý kho.', { status: 400 });
        }
        if (!context.isSuperAdmin && !context.allowedGroupIds.includes(normalized)) {
            throw new WarehouseError('Bạn không được phân quyền quản trị nhóm này.', { status: 403 });
        }
        const groupResult = await pool.query(
            `SELECT id, telegram_group_id, group_name, warehouse_service_order_enabled
             FROM telegram_groups
             WHERE telegram_group_id = $1
               AND bot_role = 'warehouse'
               AND is_active = TRUE
               AND COALESCE(is_deleted, FALSE) = FALSE
             LIMIT 1`,
            [normalized]
        );
        if (!groupResult.rows[0]) {
            throw new WarehouseError('Nhóm được chọn không có role quản lý kho.', { status: 400 });
        }
        return groupResult.rows[0];
    }

    async function requireWarehouseCatalogAccess(context) {
        if (context.isSuperAdmin) return;
        if (!context.allowedGroupIds.length) {
            throw new WarehouseError('Bạn chưa được phân quyền quản trị kho.', { status: 403 });
        }
        const result = await pool.query(
            `SELECT 1
             FROM telegram_groups
             WHERE telegram_group_id::text = ANY($1::text[])
               AND bot_role = 'warehouse'
               AND is_active = TRUE
               AND COALESCE(is_deleted, FALSE) = FALSE
             LIMIT 1`,
            [context.allowedGroupIds]
        );
        if (!result.rows[0]) {
            throw new WarehouseError('Bạn chưa được phân quyền quản trị kho.', { status: 403 });
        }
    }

    return { getContext, requireWarehouseGroup, requireWarehouseCatalogAccess };
}

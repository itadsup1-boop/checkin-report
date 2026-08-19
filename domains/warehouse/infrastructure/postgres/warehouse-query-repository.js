import { WarehouseError } from '../../domain/constants.js';

export function createWarehouseQueryRepository(pool) {
    async function getActiveGroup(chatId, db = pool) {
        const result = await db.query(
            `SELECT id, telegram_group_id, group_name, bot_role,
                    warehouse_service_order_enabled
             FROM telegram_groups
             WHERE telegram_group_id = $1
               AND bot_role = 'warehouse'
               AND is_active = TRUE
               AND COALESCE(is_deleted, FALSE) = FALSE
             LIMIT 1`,
            [String(chatId)]
        );
        if (!result.rows[0]) {
            throw new WarehouseError('Nhóm chưa được bật chức năng quản lý kho.', {
                status: 403,
                code: 'WAREHOUSE_GROUP_REQUIRED'
            });
        }
        return result.rows[0];
    }

    async function getActiveEmployee(telegramId, chatId = null, db = pool) {
        const query = chatId
            ? `SELECT id, telegram_id, telegram_group_id, full_name, role, is_active
               FROM employees
               WHERE telegram_id = $1 AND is_active = TRUE
               ORDER BY CASE
                    -- Dữ liệu cũ có thể có nhiều employees cùng Telegram ID, mỗi dòng
                    -- được tạo khi nhân sự đăng ký ở một nhóm khác. Phải ưu tiên dòng
                    -- thực sự thuộc nhóm đang mở, không được lấy dòng cũ nhất toàn hệ thống.
                    WHEN telegram_group_id = $2 THEN 0
                    WHEN EXISTS (
                        SELECT 1 FROM employee_group_memberships m
                        WHERE m.employee_id = employees.id
                          AND m.telegram_group_id = $2
                          AND m.status = 'ACTIVE'
                    ) THEN 1
                    WHEN EXISTS (
                        SELECT 1 FROM tk_warehouse_permissions wp
                        WHERE wp.employee_id = employees.id
                          AND wp.telegram_group_id = $2
                          AND wp.is_active = TRUE
                    ) THEN 2
                    ELSE 3
               END ASC, created_at ASC
               LIMIT 1`
            : `SELECT id, telegram_id, telegram_group_id, full_name, role, is_active
               FROM employees
               WHERE telegram_id = $1 AND is_active = TRUE
               ORDER BY created_at ASC
               LIMIT 1`;
        const params = chatId ? [String(telegramId), String(chatId)] : [String(telegramId)];
        const result = await db.query(query, params);
        if (!result.rows[0]) {
            throw new WarehouseError('Nhân sự chưa đăng ký hoặc đã bị vô hiệu hóa.', {
                status: 403,
                code: 'WAREHOUSE_EMPLOYEE_REQUIRED'
            });
        }
        return result.rows[0];
    }

    async function hasActiveGroupMembership(employeeId, chatId, db = pool) {
        const result = await db.query(
            `SELECT EXISTS (
                SELECT 1
                FROM employees e
                WHERE e.id = $1
                  AND e.telegram_group_id = $2
                  AND e.is_active = TRUE
                UNION ALL
                SELECT 1
                FROM employee_group_memberships m
                WHERE m.employee_id = $1
                  AND m.telegram_group_id = $2
                  AND m.status = 'ACTIVE'
             ) AS allowed`,
            [employeeId, String(chatId)]
        );
        return result.rows[0]?.allowed === true;
    }

    async function getPermissionSet(employeeId, chatId, db = pool) {
        const result = await db.query(
            `SELECT permission_code
             FROM tk_warehouse_permissions
             WHERE employee_id = $1
               AND telegram_group_id = $2
               AND is_active = TRUE`,
            [employeeId, String(chatId)]
        );
        return new Set(result.rows.map(row => row.permission_code));
    }

    /** Tìm group kho theo id nội bộ, dùng cho thao tác phát sinh từ Web Admin. */
    async function getWarehouseGroupById(groupId, db = pool) {
        const result = await db.query(
            `SELECT id, telegram_group_id, group_name, bot_role,
                    warehouse_service_order_enabled
             FROM telegram_groups
             WHERE id = $1 AND bot_role = 'warehouse'
               AND is_active = TRUE AND COALESCE(is_deleted, FALSE) = FALSE
             LIMIT 1`,
            [groupId]
        );
        return result.rows[0] || null;
    }

    async function getBootstrap(chatId) {
        const group = await getActiveGroup(chatId);
        if (!group.warehouse_service_order_enabled) {
            return { group, services: [], products: [], inventory: [] };
        }

        const [servicesResult, productsResult, inventoryResult] = await Promise.all([
            pool.query(
                `SELECT s.id, s.service_code, s.service_name, s.description, s.display_order,
                        COALESCE(
                            JSON_AGG(
                                JSON_BUILD_OBJECT(
                                    'id', sp.id,
                                    'product_id', p.id,
                                    'product_name', p.product_name,
                                    'barcode', p.barcode,
                                    'quantity_mode', p.quantity_mode,
                                    'base_unit', p.base_unit,
                                    'import_unit', p.import_unit,
                                    'conversion_rate', p.conversion_rate,
                                    'default_quantity', sp.default_quantity,
                                    'display_order', sp.display_order
                                )
                                ORDER BY sp.display_order, p.product_name
                            ) FILTER (WHERE sp.id IS NOT NULL AND p.id IS NOT NULL),
                            '[]'::JSON
                        ) AS items
                 FROM tk_warehouse_services s
                 LEFT JOIN tk_warehouse_service_products sp
                   ON sp.service_id = s.id AND sp.is_active = TRUE
                 LEFT JOIN tk_products p
                   ON p.id = sp.product_id AND p.is_active = TRUE
                 WHERE s.is_active = TRUE
                 GROUP BY s.id
                 ORDER BY s.display_order, s.service_name`
            ),
            pool.query(
                `SELECT id, barcode, product_name, quantity_mode, base_unit, import_unit, conversion_rate
                 FROM tk_products
                 WHERE is_active = TRUE
                 ORDER BY product_name`
            ),
            pool.query(
                `SELECT p.id AS product_id,
                        COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'US'), 0) AS stock_us,
                        COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'UK'), 0) AS stock_uk
                 FROM tk_products p
                 LEFT JOIN tk_inventory i ON i.product_id = p.id
                 WHERE p.is_active = TRUE
                 GROUP BY p.id`
            )
        ]);

        return {
            group,
            services: servicesResult.rows,
            products: productsResult.rows,
            inventory: inventoryResult.rows
        };
    }

    async function getOrderDetail(orderId, db = pool) {
        const orderResult = await db.query(
            `SELECT o.*, g.telegram_group_id, g.group_name,
                    COALESCE(creator.full_name,
                        CASE WHEN o.created_by IS NULL THEN 'Admin' END) AS creator_name,
                    COALESCE(approver.full_name,
                        CASE WHEN o.approved_at IS NOT NULL THEN 'Admin' END) AS approver_name,
                    COALESCE(rejector.full_name,
                        CASE WHEN o.rejected_at IS NOT NULL THEN 'Admin' END) AS rejector_name
             FROM tk_warehouse_orders o
             JOIN telegram_groups g ON g.id = o.group_id
             LEFT JOIN employees creator ON creator.id = o.created_by
             LEFT JOIN employees approver ON approver.id = o.approved_by
             LEFT JOIN employees rejector ON rejector.id = o.rejected_by
             WHERE o.id = $1`,
            [orderId]
        );
        const order = orderResult.rows[0];
        if (!order) return null;

        const [servicesResult, transfersResult] = await Promise.all([
            db.query(
                `SELECT os.id, os.service_id, os.service_code_snapshot,
                        os.service_name_snapshot, os.display_order,
                        COALESCE(
                            JSON_AGG(
                                JSON_BUILD_OBJECT(
                                    'id', oi.id,
                                    'product_id', oi.product_id,
                                    'product_name', oi.product_name_snapshot,
                                    'barcode', oi.barcode_snapshot,
                                    'unit', COALESCE(oi.unit_snapshot, p.base_unit, 'chiếc'),
                                    'base_unit', p.base_unit,
                                    'import_unit', p.import_unit,
                                    'conversion_rate', p.conversion_rate,
                                    'template_quantity', oi.template_quantity,
                                    'actual_quantity', oi.actual_quantity,
                                    'item_source', oi.item_source,
                                    'is_removed', oi.is_removed,
                                    'display_order', oi.display_order,
                                    'local_allocated_quantity', oi.local_allocated_quantity,
                                    'transfer_allocated_quantity', oi.transfer_allocated_quantity,
                                    'transfer_from_branch', oi.transfer_from_branch
                                )
                                ORDER BY oi.display_order, oi.created_at
                            ) FILTER (WHERE oi.id IS NOT NULL),
                            '[]'::JSON
                        ) AS items
                 FROM tk_warehouse_order_services os
                 LEFT JOIN tk_warehouse_order_items oi ON oi.order_service_id = os.id
                 LEFT JOIN tk_products p ON p.id = oi.product_id
                 WHERE os.order_id = $1
                 GROUP BY os.id
                 ORDER BY os.display_order, os.created_at`,
                [orderId]
            ),
            db.query(
                `SELECT t.id, t.transfer_code, t.from_branch, t.to_branch,
                        t.status, t.confirmed_at,
                        COALESCE(
                            JSON_AGG(
                                JSON_BUILD_OBJECT(
                                    'product_id', ti.product_id,
                                    'product_name', p.product_name,
                                    'barcode', p.barcode,
                                    'quantity', ti.quantity
                                )
                                ORDER BY p.product_name
                            ) FILTER (WHERE ti.id IS NOT NULL),
                            '[]'::JSON
                        ) AS items
                 FROM tk_warehouse_transfers t
                 LEFT JOIN tk_warehouse_transfer_items ti ON ti.transfer_id = t.id
                 LEFT JOIN tk_products p ON p.id = ti.product_id
                 WHERE t.order_id = $1
                 GROUP BY t.id
                 ORDER BY t.created_at`,
                [orderId]
            )
        ]);

        return {
            ...order,
            services: servicesResult.rows,
            transfers: transfersResult.rows
        };
    }

    return {
        getActiveGroup,
        getWarehouseGroupById,
        getActiveEmployee,
        hasActiveGroupMembership,
        getPermissionSet,
        getBootstrap,
        getOrderDetail
    };
}

import {
    createWarehouseOrderService,
    WAREHOUSE_PERMISSIONS,
    WarehouseError
} from '../../../../../packages/warehouse/index.js';

function normalizeServiceCode(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]+/g, '_')
        .slice(0, 50);
}

function sendError(res, error) {
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

export function registerWarehouseAdminRoutes({ app, pool }) {
    const warehouseOrderService = createWarehouseOrderService({ pool });

    async function getContext(req) {
        const headerId = String(req.headers['x-admin-id'] || '').trim();
        const headerRole = String(req.headers['x-admin-role'] || '').trim();
        if (!headerId || !headerRole) {
            throw new WarehouseError('Phiên đăng nhập Admin không hợp lệ.', { status: 401 });
        }

        if (headerId === 'super-admin-id' && headerRole === 'SUPER_ADMIN') {
            return { adminId: headerId, role: headerRole, isSuperAdmin: true, allowedGroupIds: [] };
        }

        const adminResult = await pool.query(
            `SELECT id, role
             FROM admin_accounts
             WHERE id = $1 AND is_active = TRUE
             LIMIT 1`,
            [headerId]
        );
        const admin = adminResult.rows[0];
        if (!admin) throw new WarehouseError('Tài khoản Admin không tồn tại hoặc đã bị khóa.', { status: 401 });

        const groups = await pool.query(
            'SELECT telegram_group_id FROM admin_group_mappings WHERE admin_id = $1',
            [admin.id]
        );
        return {
            adminId: String(admin.id),
            role: admin.role,
            isSuperAdmin: admin.role === 'SUPER_ADMIN',
            allowedGroupIds: groups.rows.map(row => String(row.telegram_group_id))
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

    app.get('/api/admin/warehouse/services', async (req, res) => {
        try {
            const context = await getContext(req);
            await requireWarehouseCatalogAccess(context);
            const result = await pool.query(
                `SELECT s.*,
                        COUNT(sp.id) FILTER (WHERE sp.is_active = TRUE) AS active_product_count
                 FROM tk_warehouse_services s
                 LEFT JOIN tk_warehouse_service_products sp ON sp.service_id = s.id
                 GROUP BY s.id
                 ORDER BY s.display_order, s.service_name`
            );
            res.json({ success: true, services: result.rows });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post('/api/admin/warehouse/services', async (req, res) => {
        try {
            const context = await getContext(req);
            await requireWarehouseCatalogAccess(context);
            const serviceCode = normalizeServiceCode(req.body.service_code);
            const serviceName = String(req.body.service_name || '').trim();
            if (!serviceCode || !serviceName) {
                throw new WarehouseError('Mã và tên dịch vụ là bắt buộc.');
            }
            const result = await pool.query(
                `INSERT INTO tk_warehouse_services
                    (service_code, service_name, description, display_order,
                     created_by_admin_id, updated_by_admin_id)
                 VALUES ($1, $2, $3, $4, $5, $5)
                 RETURNING *`,
                [
                    serviceCode,
                    serviceName,
                    String(req.body.description || '').trim() || null,
                    Number.isInteger(Number(req.body.display_order)) ? Number(req.body.display_order) : 0,
                    context.adminId
                ]
            );
            await pool.query(
                `INSERT INTO tk_warehouse_template_audit
                    (service_id, action, after_data, actor_admin_id)
                 VALUES ($1, 'CREATE_SERVICE', $2::jsonb, $3)`,
                [result.rows[0].id, JSON.stringify(result.rows[0]), context.adminId]
            );
            // Keep both shapes during rollout so an older Web Admin bundle can
            // consume the catalog response while the new bundle reads service.
            res.status(201).json({
                success: true,
                service: result.rows[0],
                data: { service: result.rows[0] }
            });
        } catch (error) {
            if (error.code === '23505') {
                return res.status(409).json({ success: false, message: 'Mã dịch vụ đã tồn tại.' });
            }
            sendError(res, error);
        }
    });

    app.put('/api/admin/warehouse/services/:serviceId', async (req, res) => {
        const client = await pool.connect();
        try {
            const context = await getContext(req);
            await requireWarehouseCatalogAccess(context);
            await client.query('BEGIN');
            const beforeResult = await client.query(
                'SELECT * FROM tk_warehouse_services WHERE id = $1 FOR UPDATE',
                [req.params.serviceId]
            );
            const before = beforeResult.rows[0];
            if (!before) throw new WarehouseError('Không tìm thấy dịch vụ.', { status: 404 });

            const serviceName = req.body.service_name !== undefined
                ? String(req.body.service_name).trim()
                : before.service_name;
            if (!serviceName) throw new WarehouseError('Tên dịch vụ không được để trống.');
            const result = await client.query(
                `UPDATE tk_warehouse_services
                 SET service_name = $2,
                     description = $3,
                     is_active = $4,
                     display_order = $5,
                     updated_by_admin_id = $6,
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [
                    before.id,
                    serviceName,
                    req.body.description !== undefined ? String(req.body.description || '').trim() || null : before.description,
                    req.body.is_active !== undefined ? !!req.body.is_active : before.is_active,
                    Number.isInteger(Number(req.body.display_order)) ? Number(req.body.display_order) : before.display_order,
                    context.adminId
                ]
            );
            await client.query(
                `INSERT INTO tk_warehouse_template_audit
                    (service_id, action, before_data, after_data, actor_admin_id)
                 VALUES ($1, 'UPDATE_SERVICE', $2::jsonb, $3::jsonb, $4)`,
                [before.id, JSON.stringify(before), JSON.stringify(result.rows[0]), context.adminId]
            );
            await client.query('COMMIT');
            res.json({ success: true, service: result.rows[0] });
        } catch (error) {
            await client.query('ROLLBACK');
            sendError(res, error);
        } finally {
            client.release();
        }
    });

    app.get('/api/admin/warehouse/products', async (req, res) => {
        try {
            const context = await getContext(req);
            await requireWarehouseCatalogAccess(context);
            const result = await pool.query(
                `SELECT p.id, p.barcode, p.product_name, p.is_active,
                        COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'US'), 0)::int AS stock_us,
                        COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'UK'), 0)::int AS stock_uk
                 FROM tk_products p
                 LEFT JOIN tk_inventory i ON i.product_id = p.id
                 GROUP BY p.id
                 ORDER BY p.product_name`
            );
            res.json({ success: true, products: result.rows });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.put('/api/admin/warehouse/products/:productId', async (req, res) => {
        const client = await pool.connect();
        try {
            const context = await getContext(req);
            await requireWarehouseCatalogAccess(context);
            if (typeof req.body.is_active !== 'boolean') {
                throw new WarehouseError('Trạng thái sản phẩm không hợp lệ.');
            }
            await client.query('BEGIN');
            const beforeResult = await client.query(
                'SELECT * FROM tk_products WHERE id = $1 FOR UPDATE',
                [req.params.productId]
            );
            const before = beforeResult.rows[0];
            if (!before) throw new WarehouseError('Không tìm thấy sản phẩm.', { status: 404 });
            const result = await client.query(
                `UPDATE tk_products
                 SET is_active = $2
                 WHERE id = $1
                 RETURNING *`,
                [before.id, req.body.is_active]
            );
            await client.query(
                `INSERT INTO tk_warehouse_template_audit
                    (action, before_data, after_data, actor_admin_id)
                 VALUES ('UPDATE_PRODUCT_VISIBILITY', $1::jsonb, $2::jsonb, $3)`,
                [JSON.stringify(before), JSON.stringify(result.rows[0]), context.adminId]
            );
            await client.query('COMMIT');
            res.json({ success: true, product: result.rows[0] });
        } catch (error) {
            await client.query('ROLLBACK');
            sendError(res, error);
        } finally {
            client.release();
        }
    });

    app.get('/api/admin/warehouse/products/audit', async (req, res) => {
        try {
            const context = await getContext(req);
            await requireWarehouseCatalogAccess(context);
            const result = await pool.query(
                `SELECT *
                 FROM tk_warehouse_template_audit
                 WHERE action = 'UPDATE_PRODUCT_VISIBILITY'
                 ORDER BY created_at DESC
                 LIMIT 200`
            );
            res.json({ success: true, audit: result.rows });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.get('/api/admin/warehouse/services/:serviceId/products', async (req, res) => {
        try {
            const context = await getContext(req);
            await requireWarehouseCatalogAccess(context);
            const result = await pool.query(
                `SELECT sp.*, p.product_name, p.barcode
                 FROM tk_warehouse_service_products sp
                 JOIN tk_products p ON p.id = sp.product_id
                 WHERE sp.service_id = $1
                 ORDER BY sp.display_order, p.product_name`,
                [req.params.serviceId]
            );
            res.json({ success: true, items: result.rows });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.put('/api/admin/warehouse/services/:serviceId/products', async (req, res) => {
        const client = await pool.connect();
        try {
            const context = await getContext(req);
            await requireWarehouseCatalogAccess(context);
            const items = Array.isArray(req.body.items) ? req.body.items : [];
            const productIds = items.map(item => String(item.product_id || ''));
            if (new Set(productIds).size !== productIds.length) {
                throw new WarehouseError('Một sản phẩm không được xuất hiện hai lần trong cùng dịch vụ.');
            }
            for (const item of items) {
                if (!item.product_id || !Number.isInteger(Number(item.default_quantity)) || Number(item.default_quantity) <= 0) {
                    throw new WarehouseError('Sản phẩm mẫu phải có số lượng nguyên dương.');
                }
            }

            await client.query('BEGIN');
            const service = await client.query(
                'SELECT id FROM tk_warehouse_services WHERE id = $1 FOR UPDATE',
                [req.params.serviceId]
            );
            if (!service.rows[0]) throw new WarehouseError('Không tìm thấy dịch vụ.', { status: 404 });
            const beforeResult = await client.query(
                'SELECT * FROM tk_warehouse_service_products WHERE service_id = $1 ORDER BY display_order',
                [req.params.serviceId]
            );

            await client.query(
                `UPDATE tk_warehouse_service_products
                 SET is_active = FALSE,
                     updated_by_admin_id = $2,
                     updated_at = NOW()
                 WHERE service_id = $1`,
                [req.params.serviceId, context.adminId]
            );

            if (productIds.length) {
                const products = await client.query(
                    `SELECT id FROM tk_products
                     WHERE id = ANY($1::uuid[])`,
                    [productIds]
                );
                if (products.rows.length !== productIds.length) {
                    throw new WarehouseError('Có sản phẩm không tồn tại.');
                }
            }

            for (let index = 0; index < items.length; index += 1) {
                const item = items[index];
                await client.query(
                    `INSERT INTO tk_warehouse_service_products
                        (service_id, product_id, default_quantity, is_active,
                         display_order, updated_by_admin_id, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, NOW())
                     ON CONFLICT (service_id, product_id) DO UPDATE SET
                        default_quantity = EXCLUDED.default_quantity,
                        is_active = EXCLUDED.is_active,
                        display_order = EXCLUDED.display_order,
                        updated_by_admin_id = EXCLUDED.updated_by_admin_id,
                        updated_at = NOW()`,
                    [
                        req.params.serviceId,
                        item.product_id,
                        Number(item.default_quantity),
                        item.is_active !== false,
                        Number.isInteger(Number(item.display_order)) ? Number(item.display_order) : index,
                        context.adminId
                    ]
                );
            }

            const afterResult = await client.query(
                'SELECT * FROM tk_warehouse_service_products WHERE service_id = $1 ORDER BY display_order',
                [req.params.serviceId]
            );
            await client.query(
                `INSERT INTO tk_warehouse_template_audit
                    (service_id, action, before_data, after_data, actor_admin_id)
                 VALUES ($1, 'REPLACE_TEMPLATE', $2::jsonb, $3::jsonb, $4)`,
                [
                    req.params.serviceId,
                    JSON.stringify(beforeResult.rows),
                    JSON.stringify(afterResult.rows),
                    context.adminId
                ]
            );
            await client.query('COMMIT');
            res.json({ success: true, items: afterResult.rows });
        } catch (error) {
            await client.query('ROLLBACK');
            sendError(res, error);
        } finally {
            client.release();
        }
    });

    app.get('/api/admin/warehouse/services/:serviceId/audit', async (req, res) => {
        try {
            const context = await getContext(req);
            await requireWarehouseCatalogAccess(context);
            const result = await pool.query(
                `SELECT *
                 FROM tk_warehouse_template_audit
                 WHERE service_id = $1
                 ORDER BY created_at DESC
                 LIMIT 100`,
                [req.params.serviceId]
            );
            res.json({ success: true, audit: result.rows });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.get('/api/admin/warehouse/groups/:groupId/permissions', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const result = await pool.query(
                `SELECT e.id, e.full_name, e.telegram_id, e.role, e.is_active,
                        COALESCE(
                            ARRAY_AGG(wp.permission_code ORDER BY wp.permission_code)
                                FILTER (WHERE wp.is_active = TRUE),
                            '{}'
                        ) AS permissions
                 FROM employees e
                 LEFT JOIN tk_warehouse_permissions wp
                   ON wp.employee_id = e.id
                  AND wp.telegram_group_id = $1
                 LEFT JOIN employee_group_memberships gm
                   ON gm.employee_id = e.id
                  AND gm.telegram_group_id = $1
                  AND gm.status = 'ACTIVE'
                 WHERE e.telegram_group_id = $1
                    OR gm.employee_id IS NOT NULL
                    OR wp.employee_id IS NOT NULL
                 GROUP BY e.id
                 ORDER BY e.full_name`,
                [group.telegram_group_id]
            );
            res.json({
                success: true,
                warehouse_service_order_enabled: group.warehouse_service_order_enabled === true,
                permission_codes: WAREHOUSE_PERMISSIONS,
                employees: result.rows
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.put('/api/admin/warehouse/groups/:groupId/permissions/:employeeId', async (req, res) => {
        const client = await pool.connect();
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const permissions = [...new Set(
                (Array.isArray(req.body.permissions) ? req.body.permissions : []).map(String)
            )];
            if (permissions.some(code => !WAREHOUSE_PERMISSIONS.includes(code))) {
                throw new WarehouseError('Có mã quyền kho không hợp lệ.');
            }

            await client.query('BEGIN');
            const employee = await client.query(
                'SELECT id FROM employees WHERE id = $1 AND is_active = TRUE FOR UPDATE',
                [req.params.employeeId]
            );
            if (!employee.rows[0]) throw new WarehouseError('Không tìm thấy nhân viên.', { status: 404 });
            const existingResult = await client.query(
                `SELECT permission_code, is_active
                 FROM tk_warehouse_permissions
                 WHERE employee_id = $1 AND telegram_group_id = $2`,
                [req.params.employeeId, group.telegram_group_id]
            );
            const existing = new Map(existingResult.rows.map(row => [row.permission_code, row.is_active]));

            for (const code of WAREHOUSE_PERMISSIONS) {
                const nextActive = permissions.includes(code);
                const oldActive = existing.get(code) ?? null;
                if (oldActive === nextActive) continue;
                await client.query(
                    `INSERT INTO tk_warehouse_permissions
                        (employee_id, telegram_group_id, permission_code,
                         is_active, granted_by_admin_id, granted_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                     ON CONFLICT (employee_id, telegram_group_id, permission_code) DO UPDATE SET
                        is_active = EXCLUDED.is_active,
                        granted_by_admin_id = EXCLUDED.granted_by_admin_id,
                        granted_at = NOW(),
                        updated_at = NOW()`,
                    [req.params.employeeId, group.telegram_group_id, code, nextActive, context.adminId]
                );
                await client.query(
                    `INSERT INTO tk_warehouse_permission_audit
                        (employee_id, telegram_group_id, permission_code,
                         old_is_active, new_is_active, actor_admin_id)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        req.params.employeeId,
                        group.telegram_group_id,
                        code,
                        oldActive,
                        nextActive,
                        context.adminId
                    ]
                );
            }
            await client.query('COMMIT');
            res.json({ success: true, permissions });
        } catch (error) {
            await client.query('ROLLBACK');
            sendError(res, error);
        } finally {
            client.release();
        }
    });

    app.get('/api/admin/warehouse/groups/:groupId/permission-audit', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const result = await pool.query(
                `SELECT a.*, e.full_name
                 FROM tk_warehouse_permission_audit a
                 JOIN employees e ON e.id = a.employee_id
                 WHERE a.telegram_group_id = $1
                 ORDER BY a.created_at DESC
                 LIMIT 200`,
                [group.telegram_group_id]
            );
            res.json({ success: true, audit: result.rows });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.put('/api/admin/warehouse/groups/:groupId/feature-flag', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const enabled = req.body.enabled === true;
            await pool.query(
                `UPDATE telegram_groups
                 SET warehouse_service_order_enabled = $2
                 WHERE telegram_group_id = $1`,
                [group.telegram_group_id, enabled]
            );
            res.json({ success: true, enabled, group_id: group.telegram_group_id });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.get('/api/admin/warehouse/groups/:groupId/orders', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const result = await pool.query(
                `SELECT o.id, o.order_code, o.customer_name, o.customer_phone,
                        o.branch, o.status, o.sync_status, o.created_at,
                        o.approved_at, o.reversed_at, o.reversed_by_admin_id,
                        COALESCE(creator.full_name,
                            CASE WHEN o.created_by IS NULL THEN 'Admin' END) AS creator_name,
                        COALESCE(approver.full_name,
                            CASE WHEN o.approved_at IS NOT NULL THEN 'Admin' END) AS approver_name,
                        COALESCE((
                            SELECT JSON_AGG(
                                JSON_BUILD_OBJECT(
                                    'item_id', oi.id,
                                    'service_name', os.service_name_snapshot,
                                    'product_id', oi.product_id,
                                    'product_name', oi.product_name_snapshot,
                                    'barcode', oi.barcode_snapshot,
                                    'quantity', oi.actual_quantity,
                                    'stock_us', COALESCE((
                                        SELECT quantity FROM tk_inventory
                                        WHERE product_id = oi.product_id AND branch = 'US'
                                    ), 0),
                                    'stock_uk', COALESCE((
                                        SELECT quantity FROM tk_inventory
                                        WHERE product_id = oi.product_id AND branch = 'UK'
                                    ), 0)
                                )
                                ORDER BY os.display_order, oi.display_order
                            )
                            FROM tk_warehouse_order_services os
                            JOIN tk_warehouse_order_items oi ON oi.order_service_id = os.id
                            WHERE os.order_id = o.id AND oi.is_removed = FALSE
                        ), '[]'::JSON) AS order_lines
                 FROM tk_warehouse_orders o
                 LEFT JOIN employees creator ON creator.id = o.created_by
                 LEFT JOIN employees approver ON approver.id = o.approved_by
                 WHERE o.group_id = $1
                 ORDER BY o.created_at DESC
                 LIMIT 200`,
                [group.id]
            );
            res.json({ success: true, orders: result.rows });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post('/api/admin/warehouse/groups/:groupId/orders/:orderId/approve', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const order = await warehouseOrderService.approveOrderAsAdmin({
                orderId: req.params.orderId,
                groupId: group.id,
                adminId: context.adminId
            });
            res.json({ success: true, order });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post('/api/admin/warehouse/groups/:groupId/orders/:orderId/reject', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const order = await warehouseOrderService.rejectOrderAsAdmin({
                orderId: req.params.orderId,
                groupId: group.id,
                adminId: context.adminId
            });
            res.json({ success: true, order });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post('/api/admin/warehouse/groups/:groupId/orders/:orderId/reverse', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const order = await warehouseOrderService.reverseOrder({
                orderId: req.params.orderId,
                groupId: group.id,
                adminId: context.adminId
            });
            res.json({ success: true, order });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.get('/api/admin/warehouse/groups/:groupId/ledger', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const branch = String(req.query.branch || '').toUpperCase();
            if (branch && !['US', 'UK'].includes(branch)) {
                throw new WarehouseError('Cơ sở lọc báo cáo không hợp lệ.');
            }
            const from = String(req.query.from || '').trim() || null;
            const to = String(req.query.to || '').trim() || null;
            const result = await pool.query(
                `SELECT l.id, l.event_key, l.event_type, l.branch,
                        l.quantity_delta, l.balance_before, l.balance_after,
                        l.actor_telegram_id, l.created_at, l.metadata,
                        p.product_name, p.barcode, o.order_code, t.transfer_code
                 FROM tk_warehouse_ledger l
                 JOIN tk_products p ON p.id = l.product_id
                 LEFT JOIN tk_warehouse_orders o ON o.id = l.order_id
                 LEFT JOIN tk_warehouse_transfers t ON t.id = l.transfer_id
                 WHERE l.group_id = $1
                   AND ($2::text IS NULL OR l.branch = $2)
                   AND ($3::timestamptz IS NULL OR l.created_at >= $3::timestamptz)
                   AND ($4::timestamptz IS NULL OR l.created_at < $4::timestamptz + INTERVAL '1 day')
                 ORDER BY l.created_at DESC
                 LIMIT 1000`,
                [group.id, branch || null, from, to]
            );
            res.json({ success: true, ledger: result.rows });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.get('/api/admin/warehouse/groups/:groupId/outbox', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const result = await pool.query(
                `SELECT ob.id, ob.aggregate_type, ob.aggregate_id, ob.event_type,
                        ob.status, ob.attempts, ob.next_retry_at, ob.last_error,
                        ob.created_at, ob.processed_at
                 FROM tk_warehouse_outbox ob
                 WHERE (
                    ob.aggregate_type = 'WAREHOUSE_ORDER'
                    AND EXISTS (
                        SELECT 1 FROM tk_warehouse_orders o
                        WHERE o.id = ob.aggregate_id AND o.group_id = $1
                    )
                 ) OR (
                    ob.aggregate_type = 'WAREHOUSE_IMPORT'
                    AND ob.payload->>'groupId' = $1::text
                 ) OR (
                    ob.aggregate_type = 'LEGACY_WAREHOUSE_EXPORT'
                    AND ob.payload->>'groupId' = $1::text
                 )
                 ORDER BY ob.created_at DESC
                 LIMIT 500`,
                [group.id]
            );
            res.json({ success: true, events: result.rows });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post('/api/admin/warehouse/groups/:groupId/outbox/:eventId/retry', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const result = await pool.query(
                `UPDATE tk_warehouse_outbox ob
                 SET status = 'PENDING', attempts = 0, next_retry_at = NOW(),
                     last_error = NULL, processed_at = NULL
                 WHERE ob.id = $2
                   AND ob.status <> 'DONE'
                   AND (
                        (
                            ob.aggregate_type = 'WAREHOUSE_ORDER'
                            AND EXISTS (
                                SELECT 1 FROM tk_warehouse_orders o
                                WHERE o.id = ob.aggregate_id AND o.group_id = $1
                            )
                        )
                        OR (
                            ob.aggregate_type = 'WAREHOUSE_IMPORT'
                            AND ob.payload->>'groupId' = $1::text
                        )
                        OR (
                            ob.aggregate_type = 'LEGACY_WAREHOUSE_EXPORT'
                            AND ob.payload->>'groupId' = $1::text
                        )
                   )
                 RETURNING id, aggregate_type, aggregate_id, event_type,
                           status, attempts, next_retry_at`,
                [group.id, req.params.eventId]
            );
            if (!result.rows[0]) {
                throw new WarehouseError('Không tìm thấy tác vụ lỗi thuộc group này.', { status: 404 });
            }
            const event = result.rows[0];
            if (event.aggregate_type === 'WAREHOUSE_ORDER'
                && ['SYNC_ORDER_SHEET', 'SYNC_ORDER_REVERSAL_SHEET'].includes(event.event_type)) {
                await pool.query(
                    `UPDATE tk_warehouse_orders
                     SET sync_status = 'PENDING', updated_at = NOW()
                     WHERE id = $1`,
                    [event.aggregate_id]
                );
            }
            res.json({ success: true, event });
        } catch (error) {
            sendError(res, error);
        }
    });
}

/**
 * Dịch vụ và mẫu sản phẩm theo dịch vụ.
 *
 * Cắt nguyên văn từ apps/api/src/modules/warehouse-admin/index.js (777 dòng),
 * không đổi một dòng logic nào.
 */

import { sendError, normalizeServiceCode } from '../admin-context.js';
import { WarehouseError } from '../../../domain/constants.js';
import { parseQuantity, quantityModeLabel } from '../../../domain/quantity-rules.js';

export function registerServiceRoutes({ app, pool, getContext, requireWarehouseCatalogAccess }) {
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

    app.get('/api/admin/warehouse/services/:serviceId/products', async (req, res) => {
        try {
            const context = await getContext(req);
            await requireWarehouseCatalogAccess(context);
            const result = await pool.query(
                `SELECT sp.*, p.product_name, p.barcode, p.quantity_mode
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
                if (!item.product_id) throw new WarehouseError('Sản phẩm mẫu không hợp lệ.');
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
                    `SELECT id, product_name, quantity_mode FROM tk_products
                     WHERE id = ANY($1::uuid[])`,
                    [productIds]
                );
                if (products.rows.length !== productIds.length) {
                    throw new WarehouseError('Có sản phẩm không tồn tại.');
                }
                const productMap = new Map(products.rows.map(product => [product.id, product]));
                for (const item of items) {
                    const product = productMap.get(String(item.product_id));
                    if (parseQuantity(item.default_quantity, product.quantity_mode) === null) {
                        throw new WarehouseError(
                            `Số lượng mặc định của ${product.product_name} phải là ${quantityModeLabel(product.quantity_mode)}.`
                        );
                    }
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
}

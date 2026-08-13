/**
 * Danh mục sản phẩm và lịch sử bật/tắt hiển thị.
 *
 * Cắt nguyên văn từ apps/api/src/modules/warehouse-admin/index.js (777 dòng),
 * không đổi một dòng logic nào.
 */

import { sendError } from '../admin-context.js';
import { WarehouseError } from '../../../domain/constants.js';

export function registerProductRoutes({ app, pool, getContext, requireWarehouseCatalogAccess }) {
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
}

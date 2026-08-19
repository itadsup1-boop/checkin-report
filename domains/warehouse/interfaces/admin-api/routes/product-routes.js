/**
 * Danh mục sản phẩm và lịch sử bật/tắt hiển thị.
 *
 * Cắt nguyên văn từ apps/api/src/modules/warehouse-admin/index.js (777 dòng),
 * không đổi một dòng logic nào.
 */

import { sendError } from '../admin-context.js';
import { WarehouseError } from '../../../domain/constants.js';
import { QUANTITY_MODES } from '../../../domain/quantity-rules.js';
import { validateConversionConfig } from '../../../domain/unit-conversion.js';

export function registerProductRoutes({ app, pool, getContext, requireWarehouseCatalogAccess }) {
    app.get('/api/admin/warehouse/products', async (req, res) => {
        try {
            const context = await getContext(req);
            await requireWarehouseCatalogAccess(context);
            const result = await pool.query(
                `SELECT p.id, p.barcode, p.product_name, p.is_active, p.quantity_mode,
                        p.base_unit, p.import_unit, p.conversion_rate,
                        COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'US'), 0) AS stock_us,
                        COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'UK'), 0) AS stock_uk
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
            const hasVisibility = typeof req.body.is_active === 'boolean';
            const hasQuantityMode = req.body.quantity_mode !== undefined;
            const hasUnits = req.body.base_unit !== undefined || req.body.import_unit !== undefined || req.body.conversion_rate !== undefined;

            if (!hasVisibility && !hasQuantityMode && !hasUnits) {
                throw new WarehouseError('Không có thay đổi sản phẩm hợp lệ.');
            }
            if (hasQuantityMode && !Object.values(QUANTITY_MODES).includes(req.body.quantity_mode)) {
                throw new WarehouseError('Kiểu số lượng sản phẩm không hợp lệ.');
            }

            await client.query('BEGIN');
            const beforeResult = await client.query(
                'SELECT * FROM tk_products WHERE id = $1 FOR UPDATE',
                [req.params.productId]
            );
            const before = beforeResult.rows[0];
            if (!before) throw new WarehouseError('Không tìm thấy sản phẩm.', { status: 404 });

            if (hasQuantityMode && req.body.quantity_mode === QUANTITY_MODES.INTEGER) {
                const fractionalTemplate = await client.query(
                    `SELECT EXISTS (
                        SELECT 1 FROM tk_warehouse_service_products
                        WHERE product_id = $1
                          AND is_active = TRUE
                          AND default_quantity <> TRUNC(default_quantity)
                    ) AS found`,
                    [before.id]
                );
                if (fractionalTemplate.rows[0].found) {
                    throw new WarehouseError(
                        'Sản phẩm đang có số lượng thập phân trong mẫu dịch vụ. Hãy đổi các mẫu về số nguyên trước.'
                    );
                }
            }

            let normalizedUnits = {
                base_unit: before.base_unit || 'chiếc',
                import_unit: before.import_unit,
                conversion_rate: before.conversion_rate || 1.0
            };

            if (hasUnits) {
                try {
                    normalizedUnits = validateConversionConfig({
                        base_unit: req.body.base_unit !== undefined ? req.body.base_unit : before.base_unit,
                        import_unit: req.body.import_unit !== undefined ? req.body.import_unit : before.import_unit,
                        conversion_rate: req.body.conversion_rate !== undefined ? req.body.conversion_rate : before.conversion_rate
                    });
                } catch (validationErr) {
                    throw new WarehouseError(validationErr.message);
                }
            }

            const result = await client.query(
                `UPDATE tk_products
                 SET is_active = $2,
                     quantity_mode = $3,
                     base_unit = $4,
                     import_unit = $5,
                     conversion_rate = $6
                 WHERE id = $1
                 RETURNING *`,
                [
                    before.id,
                    hasVisibility ? req.body.is_active : before.is_active,
                    hasQuantityMode ? req.body.quantity_mode : before.quantity_mode,
                    normalizedUnits.base_unit,
                    normalizedUnits.import_unit,
                    normalizedUnits.conversion_rate
                ]
            );

            if (req.body.sync_inventory && normalizedUnits.conversion_rate > 1) {
                const mult = Number(req.body.inventory_multiplier) > 0 ? Number(req.body.inventory_multiplier) : normalizedUnits.conversion_rate;
                const invRes = await client.query(
                    'SELECT branch, quantity FROM tk_inventory WHERE product_id = $1 FOR UPDATE',
                    [before.id]
                );
                for (const inv of invRes.rows) {
                    const oldQty = Number(inv.quantity) || 0;
                    if (oldQty > 0) {
                        const newQty = Number((oldQty * mult).toFixed(1));
                        const delta = Number((newQty - oldQty).toFixed(1));
                        await client.query(
                            'UPDATE tk_inventory SET quantity = $1, updated_at = NOW() WHERE product_id = $2 AND branch = $3',
                            [newQty, before.id, inv.branch]
                        );
                        await client.query(
                            `INSERT INTO tk_warehouse_ledger
                                (product_id, branch, event_type, quantity_delta, balance_before, balance_after, actor_telegram_id, metadata)
                             VALUES ($1, $2, 'ADJUSTMENT', $3, $4, $5, $6, $7)`,
                            [
                                before.id,
                                inv.branch,
                                delta,
                                oldQty,
                                newQty,
                                `admin:${context.adminId || 'web'}`,
                                JSON.stringify({ reason: `Đồng bộ quy đổi tồn kho cũ sang ${normalizedUnits.base_unit} (hệ số x${mult})` })
                            ]
                        );
                    }
                }
            }

            await client.query(
                `INSERT INTO tk_warehouse_template_audit
                    (action, before_data, after_data, actor_admin_id)
                 VALUES ($1, $2::jsonb, $3::jsonb, $4)`,
                [
                    hasUnits ? 'UPDATE_PRODUCT_UNITS' : (hasQuantityMode ? 'UPDATE_PRODUCT_QUANTITY_MODE' : 'UPDATE_PRODUCT_VISIBILITY'),
                    JSON.stringify(before),
                    JSON.stringify(result.rows[0]),
                    context.adminId
                ]
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
                 WHERE action IN ('UPDATE_PRODUCT_VISIBILITY', 'UPDATE_PRODUCT_QUANTITY_MODE', 'UPDATE_PRODUCT_UNITS')
                 ORDER BY created_at DESC
                 LIMIT 200`
            );
            res.json({ success: true, audit: result.rows });
        } catch (error) {
            sendError(res, error);
        }
    });
}

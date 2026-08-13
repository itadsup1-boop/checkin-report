/**
 * Xem, duyệt, từ chối và hoàn tác đơn xuất kho.
 *
 * Cắt nguyên văn từ apps/api/src/modules/warehouse-admin/index.js (777 dòng),
 * không đổi một dòng logic nào.
 */

import { sendError } from '../admin-context.js';

export function registerOrderRoutes({ app, pool, getContext, requireWarehouseGroup, warehouseOrderService }) {
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
}

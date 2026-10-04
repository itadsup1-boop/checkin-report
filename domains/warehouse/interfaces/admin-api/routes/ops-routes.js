/**
 * Sổ biến động kho và hàng đợi tác vụ nền (outbox).
 *
 * Cắt nguyên văn từ apps/api/src/modules/warehouse-admin/index.js (777 dòng),
 * không đổi một dòng logic nào.
 */

import { sendError } from '../admin-context.js';
import { WarehouseError } from '../../../domain/constants.js';

export function registerOpsRoutes({ app, pool, getContext, requireWarehouseGroup }) {
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

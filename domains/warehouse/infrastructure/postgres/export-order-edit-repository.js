/**
 * Kho dữ liệu hỗ trợ chỉnh sửa đơn xuất kho khách hàng trong vòng 24h.
 */
export function createExportOrderEditRepository(pool) {
    async function findExportOrderForEdit(orderId) {
        const orderRes = await pool.query(
            `SELECT o.*,
                    creator.full_name AS creator_name,
                    creator.telegram_id AS creator_telegram_id
             FROM tk_warehouse_orders o
             LEFT JOIN employees creator ON creator.id = o.created_by
             WHERE o.id = $1`,
            [orderId]
        );
        const order = orderRes.rows[0];
        if (!order) return null;

        const itemsRes = await pool.query(
            `SELECT oi.id, oi.order_service_id, oi.product_id,
                    oi.product_name_snapshot, oi.barcode_snapshot,
                    oi.actual_quantity, oi.template_quantity,
                    oi.local_allocated_quantity, oi.transfer_allocated_quantity,
                    oi.unit_snapshot, oi.unit_price_snapshot,
                    oi.is_removed, os.service_name_snapshot
             FROM tk_warehouse_order_items oi
             JOIN tk_warehouse_order_services os ON os.id = oi.order_service_id
             WHERE os.order_id = $1
             ORDER BY os.display_order, oi.display_order`,
            [orderId]
        );

        const productIds = [...new Set(itemsRes.rows.map(r => r.product_id))];
        let stockMap = {};
        if (productIds.length > 0) {
            const stockRes = await pool.query(
                `SELECT product_id, quantity
                 FROM tk_inventory
                 WHERE product_id = ANY($1::uuid[]) AND branch = $2`,
                [productIds, order.branch]
            );
            for (const row of stockRes.rows) {
                stockMap[row.product_id] = Number(row.quantity) || 0;
            }
        }

        return {
            order,
            items: itemsRes.rows,
            stockMap
        };
    }

    async function applyExportOrderEdit(client, {
        order,
        editorEmployeeId,
        editorTelegramId,
        editReason,
        deltas,
        changesSnapshot
    }) {
        const orderId = order.id;
        const branch = order.branch;
        const groupId = order.group_id;

        for (const d of deltas) {
            if (d.delta === 0) continue;

            if (d.itemId) {
                if (d.isRemoved) {
                    await client.query(
                        `UPDATE tk_warehouse_order_items
                         SET is_removed = TRUE,
                             actual_quantity = 0,
                             local_allocated_quantity = 0
                         WHERE id = $1`,
                        [d.itemId]
                    );
                } else {
                    await client.query(
                        `UPDATE tk_warehouse_order_items
                         SET actual_quantity = $1,
                             local_allocated_quantity = $1
                         WHERE id = $2`,
                        [d.newQuantity, d.itemId]
                    );
                }
            }

            const invRes = await client.query(
                `SELECT quantity FROM tk_inventory
                 WHERE product_id = $1 AND branch = $2 FOR UPDATE`,
                [d.productId, branch]
            );
            const balanceBefore = Number(invRes.rows[0]?.quantity) || 0;
            let balanceAfter;
            let eventType;
            let quantityDelta;

            if (d.delta > 0) {
                quantityDelta = -d.delta;
                balanceAfter = Number((balanceBefore - d.delta).toFixed(1));
                eventType = 'CUSTOMER_EXPORT';
            } else {
                quantityDelta = d.stockRefund;
                balanceAfter = Number((balanceBefore + d.stockRefund).toFixed(1));
                eventType = 'REVERSAL';
            }

            await client.query(
                `UPDATE tk_inventory
                 SET quantity = $1, updated_at = NOW()
                 WHERE product_id = $2 AND branch = $3`,
                [balanceAfter, d.productId, branch]
            );

            const eventKey = `${orderId}:${d.productId}:${branch}:edit-${Date.now()}`;
            await client.query(
                `INSERT INTO tk_warehouse_ledger
                    (event_key, event_type, order_id, group_id, product_id, branch,
                     quantity_delta, balance_before, balance_after,
                     actor_employee_id, actor_telegram_id, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
                [
                    eventKey,
                    eventType,
                    orderId,
                    groupId,
                    d.productId,
                    branch,
                    quantityDelta,
                    balanceBefore,
                    balanceAfter,
                    editorEmployeeId || null,
                    String(editorTelegramId),
                    JSON.stringify({
                        reason: 'ORDER_EDIT',
                        note: editReason,
                        old_quantity: d.oldQuantity,
                        new_quantity: d.newQuantity,
                        delta: d.delta
                    })
                ]
            );
        }

        await client.query(
            `UPDATE tk_warehouse_orders
             SET edit_count = edit_count + 1,
                 last_edited_at = NOW(),
                 last_edited_by = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [editorEmployeeId || null, orderId]
        );

        await client.query(
            `INSERT INTO tk_warehouse_order_edits
                (target_type, order_id, editor_employee_id, editor_telegram_id, edit_reason, changes_snapshot)
             VALUES ('EXPORT', $1, $2, $3, $4, $5::jsonb)`,
            [
                orderId,
                editorEmployeeId || null,
                String(editorTelegramId),
                editReason,
                JSON.stringify(changesSnapshot)
            ]
        );

        await client.query(
            `INSERT INTO tk_warehouse_outbox
                (aggregate_type, aggregate_id, event_type, payload)
             VALUES ('WAREHOUSE_ORDER', $1, 'ORDER_EDITED', $2::jsonb)
             ON CONFLICT (aggregate_type, aggregate_id, event_type) DO NOTHING`,
            [
                orderId,
                JSON.stringify({
                    orderId,
                    editReason,
                    editorTelegramId,
                    deltas: deltas.filter(d => d.delta !== 0)
                })
            ]
        );
    }

    return {
        findExportOrderForEdit,
        applyExportOrderEdit
    };
}

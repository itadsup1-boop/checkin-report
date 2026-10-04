/**
 * Kho dữ liệu hỗ trợ chỉnh sửa giao dịch nhập kho trong vòng 24h.
 */
export function createImportOrderEditRepository(pool) {
    async function findImportTransactionForEdit(transactionId) {
        const transRes = await pool.query(
            `SELECT t.*, p.product_name, p.barcode, p.base_unit, p.import_unit, p.conversion_rate,
                    u.full_name AS creator_name, u.telegram_id AS creator_telegram_id,
                    g.telegram_group_id
             FROM tk_warehouse_transactions t
             JOIN tk_products p ON p.id = t.product_id
             JOIN employees u ON u.id = t.user_id
             JOIN telegram_groups g ON g.id = t.group_id
             WHERE t.id = $1 AND t.transaction_type = 'IMPORT'`,
            [transactionId]
        );
        const trans = transRes.rows[0];
        if (!trans) return null;

        const invRes = await pool.query(
            `SELECT quantity FROM tk_inventory WHERE product_id = $1 AND branch = $2`,
            [trans.product_id, trans.branch]
        );
        const currentStock = Number(invRes.rows[0]?.quantity) || 0;

        return {
            transaction: trans,
            currentStock
        };
    }

    async function applyImportTransactionEdit(client, {
        transaction,
        editorEmployeeId,
        editorTelegramId,
        editReason,
        delta,
        newQuantity,
        changesSnapshot
    }) {
        const transactionId = transaction.id;
        const productId = transaction.product_id;
        const branch = transaction.branch;
        const groupId = transaction.group_id;

        await client.query(
            `UPDATE tk_warehouse_transactions
             SET quantity = $1,
                 edit_count = edit_count + 1,
                 last_edited_at = NOW(),
                 last_edited_by = $2
             WHERE id = $3`,
            [newQuantity, editorEmployeeId || null, transactionId]
        );

        const invRes = await client.query(
            `SELECT quantity FROM tk_inventory
             WHERE product_id = $1 AND branch = $2 FOR UPDATE`,
            [productId, branch]
        );
        const balanceBefore = Number(invRes.rows[0]?.quantity) || 0;
        const balanceAfter = Number((balanceBefore + delta).toFixed(1));

        await client.query(
            `UPDATE tk_inventory
             SET quantity = $1, updated_at = NOW()
             WHERE product_id = $2 AND branch = $3`,
            [balanceAfter, productId, branch]
        );

        const eventType = delta > 0 ? 'PRODUCT_IMPORT' : 'ADJUSTMENT_DECREASE';
        const eventKey = `import-edit:${transactionId}:${Date.now()}`;
        await client.query(
            `INSERT INTO tk_warehouse_ledger
                (event_key, event_type, legacy_transaction_id, group_id, product_id, branch,
                 quantity_delta, balance_before, balance_after,
                 actor_employee_id, actor_telegram_id, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
            [
                eventKey,
                eventType,
                transactionId,
                groupId,
                productId,
                branch,
                delta,
                balanceBefore,
                balanceAfter,
                editorEmployeeId || null,
                String(editorTelegramId),
                JSON.stringify({
                    reason: 'IMPORT_EDIT',
                    note: editReason,
                    old_quantity: transaction.quantity,
                    new_quantity: newQuantity,
                    delta
                })
            ]
        );

        await client.query(
            `INSERT INTO tk_warehouse_order_edits
                (target_type, transaction_id, editor_employee_id, editor_telegram_id, edit_reason, changes_snapshot)
             VALUES ('IMPORT', $1, $2, $3, $4, $5::jsonb)`,
            [
                transactionId,
                editorEmployeeId || null,
                String(editorTelegramId),
                editReason,
                JSON.stringify(changesSnapshot)
            ]
        );

        await client.query(
            `INSERT INTO tk_warehouse_outbox
                (aggregate_type, aggregate_id, event_type, payload)
             VALUES ('WAREHOUSE_TRANSACTION', $1, 'IMPORT_EDITED', $2::jsonb)
             ON CONFLICT (aggregate_type, aggregate_id, event_type) DO NOTHING`,
            [
                transactionId,
                JSON.stringify({
                    transactionId,
                    editReason,
                    editorTelegramId,
                    oldQuantity: transaction.quantity,
                    newQuantity,
                    delta,
                    productName: transaction.product_name,
                    branch
                })
            ]
        );
    }

    return {
        findImportTransactionForEdit,
        applyImportTransactionEdit
    };
}

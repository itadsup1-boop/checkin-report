export function createReceiptRepository() {
    async function createImportTransaction(db, {
        groupId, productId, quantity, branch, adminId
    }) {
        const result = await db.query(
            `INSERT INTO tk_warehouse_transactions
                (group_id, user_id, transaction_type, product_id, quantity,
                 status, approved_by, approved_at, request_group_id, branch)
             VALUES ($1, NULL, 'IMPORT', $2, $3, 'APPROVED', NULL, NOW(), $4, $5)
             RETURNING id, created_at`,
            [groupId, productId, quantity, `WEB_ADMIN:${adminId}`, branch]
        );
        return result.rows[0];
    }

    return { createImportTransaction };
}


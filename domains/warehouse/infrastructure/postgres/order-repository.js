/**
 * Đơn xuất kho theo khách hàng
 * (tk_warehouse_orders, tk_warehouse_order_services, tk_warehouse_order_items).
 */

export function createOrderRepository(pool) {
    /** Tìm đơn đã tạo trước đó bằng khoá chống gửi trùng. */
    async function findByIdempotencyKey(db, groupId, idempotencyKey) {
        const result = await db.query(
            `SELECT id FROM tk_warehouse_orders
             WHERE group_id = $1 AND idempotency_key = $2`,
            [groupId, idempotencyKey]
        );
        return result.rows[0] || null;
    }

    /** Đọc và KHOÁ đơn, chống hai người duyệt cùng lúc. */
    async function getForUpdate(db, orderId, groupId) {
        const result = await db.query(
            `SELECT * FROM tk_warehouse_orders
             WHERE id = $1 AND group_id = $2
             FOR UPDATE`,
            [orderId, groupId]
        );
        return result.rows[0] || null;
    }

    async function getStatus(db, orderId, groupId) {
        const result = await db.query(
            'SELECT status FROM tk_warehouse_orders WHERE id = $1 AND group_id = $2',
            [orderId, groupId]
        );
        return result.rows[0] || null;
    }

    async function create(db, {
        orderCode, groupId, createdBy, createdByTelegramId,
        customerName, customerPhone, branch, status, idempotencyKey, telegramChatId
    }) {
        const result = await db.query(
            `INSERT INTO tk_warehouse_orders
                (order_code, group_id, created_by, created_by_telegram_id,
                 customer_name, customer_phone, branch, status,
                 idempotency_key, telegram_chat_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                orderCode, groupId, createdBy, createdByTelegramId,
                customerName, customerPhone, branch, status,
                idempotencyKey, telegramChatId
            ]
        );
        return result.rows[0];
    }

    async function addService(db, { orderId, serviceId, serviceCode, serviceName, displayOrder }) {
        const result = await db.query(
            `INSERT INTO tk_warehouse_order_services
                (order_id, service_id, service_code_snapshot,
                 service_name_snapshot, display_order)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [orderId, serviceId, serviceCode, serviceName, displayOrder]
        );
        return result.rows[0];
    }

    async function addItem(db, {
        orderServiceId, productId, productName, barcode,
        templateQuantity, actualQuantity, itemSource, isRemoved, displayOrder
    }) {
        const result = await db.query(
            `INSERT INTO tk_warehouse_order_items
                (order_service_id, product_id, product_name_snapshot,
                 barcode_snapshot, template_quantity, actual_quantity,
                 item_source, is_removed, display_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, product_id, actual_quantity, is_removed`,
            [
                orderServiceId, productId, productName, barcode,
                templateQuantity, actualQuantity, itemSource, isRemoved, displayOrder
            ]
        );
        return result.rows[0];
    }

    /** Các dòng hàng của đơn, giữ đúng thứ tự hiển thị theo dịch vụ. */
    async function listItems(db, orderId) {
        const result = await db.query(
            `SELECT oi.id, oi.product_id, oi.actual_quantity, oi.is_removed,
                    oi.display_order, os.display_order AS service_display_order
             FROM tk_warehouse_order_items oi
             JOIN tk_warehouse_order_services os ON os.id = oi.order_service_id
             WHERE os.order_id = $1
             ORDER BY os.display_order, oi.display_order, oi.id`,
            [orderId]
        );
        return result.rows;
    }

    /** Ghi lại việc dòng hàng này lấy bao nhiêu tại chỗ, bao nhiêu từ cơ sở kia. */
    async function setItemAllocation(db, itemId, { localQuantity, transferQuantity, transferFromBranch }) {
        await db.query(
            `UPDATE tk_warehouse_order_items
             SET local_allocated_quantity = $2,
                 transfer_allocated_quantity = $3,
                 transfer_from_branch = $4
             WHERE id = $1`,
            [itemId, localQuantity, transferQuantity, transferFromBranch]
        );
    }

    async function markApproved(db, orderId, actor) {
        await db.query(
            `UPDATE tk_warehouse_orders
             SET status = 'APPROVED', approved_by = $2,
                 approved_by_telegram_id = $3, approved_at = NOW(),
                 updated_at = NOW(), sync_status = 'PENDING'
             WHERE id = $1`,
            [orderId, actor.employeeId, actor.telegramId]
        );
    }

    /**
     * Từ chối đơn, chỉ thành công khi đơn còn đang chờ duyệt.
     * @returns {Promise<boolean>} false nghĩa là đơn đã được xử lý trước đó.
     */
    async function markRejected(db, orderId, groupId, { employeeId, telegramId }) {
        const result = await db.query(
            `UPDATE tk_warehouse_orders
             SET status = 'REJECTED', rejected_by = $3,
                 rejected_by_telegram_id = $4, rejected_at = NOW(),
                 updated_at = NOW(), sync_status = 'PENDING'
             WHERE id = $1 AND group_id = $2 AND status = 'PENDING_APPROVAL'
             RETURNING id`,
            [orderId, groupId, employeeId, telegramId]
        );
        return Boolean(result.rows[0]);
    }

    async function markReversed(db, orderId, adminId) {
        await db.query(
            `UPDATE tk_warehouse_orders
             SET status = 'REVERSED', reversed_by_admin_id = $2,
                 reversed_at = NOW(), sync_status = 'PENDING', updated_at = NOW()
             WHERE id = $1`,
            [orderId, String(adminId)]
        );
    }

    return {
        findByIdempotencyKey,
        getForUpdate,
        getStatus,
        create,
        addService,
        addItem,
        listItems,
        setItemAllocation,
        markApproved,
        markRejected,
        markReversed
    };
}

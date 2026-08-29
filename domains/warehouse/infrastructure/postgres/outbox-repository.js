/**
 * Hàng đợi tác vụ nền (bảng tk_warehouse_outbox).
 *
 * Vì sao cần: sau khi trừ tồn phải báo Telegram và ghi Google Sheet. Hai việc đó
 * có thể lỗi (mất mạng, hết quota) nhưng KHÔNG được kéo theo việc rollback tồn
 * kho. Nên chúng được xếp vào hàng đợi trong cùng transaction với việc trừ tồn,
 * rồi một tiến trình nền xử lý sau và tự thử lại khi lỗi.
 */

export function createOutboxRepository(pool) {
    /**
     * Xếp một việc vào hàng đợi.
     *
     * Khoá duy nhất (aggregate_type, aggregate_id, event_type) khiến gọi lại
     * nhiều lần cũng chỉ tạo một việc — cần thiết vì thao tác duyệt có thể bị
     * Telegram gửi lại hai lần.
     */
    async function enqueue(db, orderId, eventType, payload = {}) {
        await db.query(
            `INSERT INTO tk_warehouse_outbox
                (aggregate_type, aggregate_id, event_type, payload)
             VALUES ('WAREHOUSE_ORDER', $1, $2, $3::jsonb)
             ON CONFLICT (aggregate_type, aggregate_id, event_type) DO NOTHING`,
            [orderId, eventType, JSON.stringify(payload)]
        );
    }

    /**
     * Xếp việc thông báo chuyển kho — aggregate riêng (WAREHOUSE_STOCK_TRANSFER)
     * vì `enqueue()` ở trên khoá cứng 'WAREHOUSE_ORDER', không dùng chung được.
     */
    async function enqueueStockTransfer(db, transferId, eventType, payload = {}) {
        await db.query(
            `INSERT INTO tk_warehouse_outbox
                (aggregate_type, aggregate_id, event_type, payload)
             VALUES ('WAREHOUSE_STOCK_TRANSFER', $1, $2, $3::jsonb)
             ON CONFLICT (aggregate_type, aggregate_id, event_type) DO NOTHING`,
            [transferId, eventType, JSON.stringify(payload)]
        );
    }

    return { enqueue, enqueueStockTransfer };
}

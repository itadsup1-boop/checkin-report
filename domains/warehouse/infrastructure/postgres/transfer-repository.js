/**
 * Phiếu điều chuyển giữa hai cơ sở (tk_warehouse_transfers, tk_warehouse_transfer_items).
 *
 * Điều chuyển ở đây là "dùng ngay": khi cơ sở đang đứng không đủ hàng, hệ thống
 * lấy bù từ cơ sở kia và giao thẳng cho khách, không chờ vận chuyển xong mới trừ.
 * Phiếu sinh ra để đối chiếu và thông báo, không phải để chờ xác nhận.
 */

export function createTransferRepository(pool) {
    async function create(db, { transferCode, orderId, telegramGroupId, fromBranch, toBranch, actor }) {
        const result = await db.query(
            `INSERT INTO tk_warehouse_transfers
                (transfer_code, order_id, telegram_group_id, from_branch, to_branch,
                 status, confirmed_by, confirmed_by_telegram_id, confirmed_at)
             VALUES ($1, $2, $3, $4, $5, 'NOTIFIED', $6, $7, NOW())
             RETURNING *`,
            [
                transferCode,
                orderId,
                telegramGroupId,
                fromBranch,
                toBranch,
                actor.employeeId,
                actor.telegramId
            ]
        );
        return result.rows[0];
    }

    async function addItem(db, transferId, productId, quantity) {
        await db.query(
            `INSERT INTO tk_warehouse_transfer_items (transfer_id, product_id, quantity)
             VALUES ($1, $2, $3)`,
            [transferId, productId, quantity]
        );
    }

    /** Đánh dấu mọi phiếu điều chuyển của đơn là đã hoàn tác. */
    async function markReversedByOrder(db, orderId) {
        await db.query(
            `UPDATE tk_warehouse_transfers
             SET status = 'REVERSED'
             WHERE order_id = $1`,
            [orderId]
        );
    }

    return { create, addItem, markReversedByOrder };
}

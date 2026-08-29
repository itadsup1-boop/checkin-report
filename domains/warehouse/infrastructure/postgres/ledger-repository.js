/**
 * Sổ biến động tồn kho (bảng tk_warehouse_ledger).
 *
 * Sổ này BẤT BIẾN: chỉ ghi thêm, không sửa và không xoá. Mỗi bút toán có
 * `event_key` duy nhất nên chạy lại cùng một thao tác cũng không ghi trùng.
 *
 * Ghi sổ phải nằm cùng transaction với việc trừ tồn — nếu tách ra, một bên
 * thành công một bên thất bại là sổ lệch với tồn thực vĩnh viễn.
 */

import { roundQuantity } from '../../domain/quantity-rules.js';

export function createLedgerRepository(pool) {
    /** Bút toán xuất kho lấy từ chính cơ sở đang đứng. */
    async function recordLocalExport(db, {
        order, productId, branch, quantity, balanceBefore, balanceAfter, actor
    }) {
        await db.query(
            `INSERT INTO tk_warehouse_ledger
                (event_key, event_type, order_id, group_id, product_id, branch,
                 quantity_delta, balance_before, balance_after,
                 actor_employee_id, actor_telegram_id,
                 approved_by_employee_id, metadata)
             VALUES ($1, 'CUSTOMER_EXPORT', $2, $3, $4, $5,
                     $6, $7, $8, $9, $10, $9, $11::jsonb)`,
            [
                `${order.id}:${productId}:customer-local`,
                order.id,
                order.group_id,
                productId,
                branch,
                -quantity,
                balanceBefore,
                balanceAfter,
                actor.employeeId,
                actor.telegramId,
                JSON.stringify({ allocation: 'LOCAL' })
            ]
        );
    }

    /**
     * Ba bút toán của một lần lấy hàng từ cơ sở kia dùng ngay:
     * xuất khỏi cơ sở nguồn, nhập ảo vào cơ sở đích, rồi xuất cho khách.
     * Ghi trong MỘT câu lệnh để không thể tồn tại trạng thái nửa vời.
     */
    async function recordTransferExport(db, {
        order, transferId, productId, fromBranch, toBranch, quantity,
        fromBalanceBefore, fromBalanceAfter, toBalanceAfterLocal, actor
    }) {
        await db.query(
            `INSERT INTO tk_warehouse_ledger
                (event_key, event_type, order_id, transfer_id, group_id, product_id,
                 branch, quantity_delta, balance_before, balance_after,
                 actor_employee_id, actor_telegram_id,
                 approved_by_employee_id, metadata)
             VALUES
                ($1, 'TRANSFER_OUT', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, $12::jsonb),
                ($13, 'TRANSFER_IN_DIRECT_USE', $2, $3, $4, $5, $14, $15, $16, $17, $10, $11, $10, $18::jsonb),
                ($19, 'CUSTOMER_EXPORT', $2, $3, $4, $5, $14, $20, $17, $16, $10, $11, $10, $21::jsonb)`,
            [
                `${order.id}:${productId}:transfer-out`,
                order.id,
                transferId,
                order.group_id,
                productId,
                fromBranch,
                -quantity,
                fromBalanceBefore,
                fromBalanceAfter,
                actor.employeeId,
                actor.telegramId,
                JSON.stringify({ to_branch: toBranch, direct_use: true }),
                `${order.id}:${productId}:transfer-in`,
                toBranch,
                quantity,
                toBalanceAfterLocal,
                roundQuantity(toBalanceAfterLocal + quantity),
                JSON.stringify({ from_branch: fromBranch, direct_use: true, virtual_balance: true }),
                `${order.id}:${productId}:customer-transfer`,
                -quantity,
                JSON.stringify({ allocation: 'TRANSFER', from_branch: fromBranch, virtual_balance: true })
            ]
        );
    }

    /**
     * Gom các bút toán làm giảm tồn VẬT LÝ của một đơn, để biết cần trả lại
     * bao nhiêu vào cơ sở nào khi hoàn tác.
     *
     * Bỏ qua bút toán có metadata.virtual_balance = true: đó là dòng ghi ảo của
     * luồng điều chuyển dùng ngay, không phải hàng thật rời kho.
     */
    async function listPhysicalMovements(db, orderId) {
        const result = await db.query(
            `SELECT product_id, branch,
                    SUM(-quantity_delta) AS restore_quantity,
                    ARRAY_AGG(id ORDER BY created_at, id) AS source_ledger_ids
             FROM tk_warehouse_ledger
             WHERE order_id = $1
               AND event_type IN ('CUSTOMER_EXPORT', 'TRANSFER_OUT')
               AND quantity_delta < 0
               AND COALESCE(metadata->>'virtual_balance', 'false') <> 'true'
             GROUP BY product_id, branch
             ORDER BY product_id, branch`,
            [orderId]
        );
        return result.rows;
    }

    /** Bút toán đảo khi Admin hoàn tác đơn đã duyệt. */
    async function recordReversal(db, {
        order, productId, branch, quantity, balanceBefore, balanceAfter,
        adminId, sourceLedgerIds
    }) {
        await db.query(
            `INSERT INTO tk_warehouse_ledger
                (event_key, event_type, order_id, group_id, product_id, branch,
                 quantity_delta, balance_before, balance_after,
                 actor_employee_id, actor_telegram_id, metadata)
             VALUES ($1, 'REVERSAL', $2, $3, $4, $5,
                     $6, $7, $8, NULL, $9, $10::jsonb)`,
            [
                `${order.id}:${productId}:${branch}:reversal`,
                order.id,
                order.group_id,
                productId,
                branch,
                quantity,
                balanceBefore,
                balanceAfter,
                `admin:${adminId}`,
                JSON.stringify({
                    reason: 'ADMIN_CORRECTION',
                    actor_admin_id: String(adminId),
                    source_ledger_ids: sourceLedgerIds
                })
            ]
        );
    }

    /**
     * Bút toán chuyển kho THẬT — khác `recordTransferExport` ở chỗ hàng thực sự
     * nằm lại cơ sở đích (không có bước CUSTOMER_EXPORT tiêu thụ ngay, không đánh
     * dấu `virtual_balance`). Ghi cả hai đầu trong một câu lệnh để không lệch sổ
     * nếu nửa chừng lỗi.
     */
    async function recordStockTransfer(db, {
        transferId, groupId, productId, fromBranch, toBranch, quantity,
        fromBalanceBefore, fromBalanceAfter, toBalanceBefore, toBalanceAfter, actor
    }) {
        await db.query(
            `INSERT INTO tk_warehouse_ledger
                (event_key, event_type, transfer_id, group_id, product_id,
                 branch, quantity_delta, balance_before, balance_after,
                 actor_employee_id, actor_telegram_id, metadata)
             VALUES
                ($1, 'TRANSFER_OUT', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb),
                ($12, 'TRANSFER_IN', $2, $3, $4, $13, $14, $15, $16, $9, $10, $17::jsonb)`,
            [
                `${transferId}:${productId}:transfer-out`,
                transferId,
                groupId,
                productId,
                fromBranch,
                -quantity,
                fromBalanceBefore,
                fromBalanceAfter,
                actor.employeeId,
                actor.telegramId,
                JSON.stringify({ to_branch: toBranch }),
                `${transferId}:${productId}:transfer-in`,
                toBranch,
                quantity,
                toBalanceBefore,
                toBalanceAfter,
                JSON.stringify({ from_branch: fromBranch })
            ]
        );
    }

    return {
        recordLocalExport,
        recordTransferExport,
        recordStockTransfer,
        listPhysicalMovements,
        recordReversal
    };
}

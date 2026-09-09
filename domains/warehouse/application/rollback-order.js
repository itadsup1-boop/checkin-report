/**
 * Hoàn tác một đơn ĐÃ DUYỆT — trả hàng về kho khi Admin phát hiện sai.
 *
 * Nguyên tắc: KHÔNG xoá bút toán cũ. Sổ ledger là bất biến, nên hoàn tác được
 * ghi thành bút toán đảo mới. Nhìn vào sổ vẫn thấy đầy đủ "đã xuất rồi đã trả",
 * chứ không phải lịch sử bị sửa cho biến mất.
 *
 * Chỉ trả lại phần hàng RỜI KHO THẬT. Luồng điều chuyển dùng ngay có sinh thêm
 * bút toán ảo (metadata.virtual_balance = true) để cân sổ; nếu cộng cả chúng thì
 * sẽ trả dư hàng.
 */

import { WAREHOUSE_ORDER_STATUSES, WarehouseError } from '../domain/constants.js';

export function createRollbackOrderUseCase({
    repository, orderRepo, inventoryRepo, ledgerRepo, transferRepo, outboxRepo, withTransaction
}) {
    async function reverseOrder({ orderId, groupId, adminId }) {
        const reversedId = await withTransaction(async client => {
            const order = await orderRepo.getForUpdate(client, orderId, groupId);
            if (!order) {
                throw new WarehouseError('Không tìm thấy đơn trong nhóm này.', { status: 404 });
            }
            // Bấm hoàn tác hai lần thì lần sau không làm gì thêm.
            if (order.status === WAREHOUSE_ORDER_STATUSES.REVERSED) {
                return order.id;
            }
            if (order.status !== WAREHOUSE_ORDER_STATUSES.APPROVED) {
                throw new WarehouseError('Chỉ đơn đã duyệt mới có thể hoàn tác.', {
                    status: 409,
                    code: 'ORDER_NOT_APPROVED'
                });
            }

            const physicalMovements = await ledgerRepo.listPhysicalMovements(client, order.id);
            if (!physicalMovements.length) {
                throw new WarehouseError('Đơn không có bút toán kho vật lý để hoàn tác.', {
                    status: 409,
                    code: 'REVERSAL_LEDGER_NOT_FOUND'
                });
            }

            for (const movement of physicalMovements) {
                const inventoryRow = await inventoryRepo.getForUpdate(
                    client, movement.product_id, movement.branch
                );
                if (!inventoryRow) {
                    throw new WarehouseError('Không tìm thấy dòng tồn kho cần hoàn tác.', {
                        status: 409,
                        code: 'REVERSAL_INVENTORY_NOT_FOUND'
                    });
                }
                const before = Number(inventoryRow.quantity);
                const quantity = Number(movement.restore_quantity);
                const after = before + quantity;

                await inventoryRepo.setQuantity(client, movement.product_id, movement.branch, after);
                await ledgerRepo.recordReversal(client, {
                    order,
                    productId: movement.product_id,
                    branch: movement.branch,
                    quantity,
                    balanceBefore: before,
                    balanceAfter: after,
                    adminId,
                    sourceLedgerIds: movement.source_ledger_ids
                });
            }

            await orderRepo.markReversed(client, order.id, adminId);
            await transferRepo.markReversedByOrder(client, order.id);
            await outboxRepo.enqueue(client, order.id, 'ORDER_REVERSED');
            await outboxRepo.enqueue(client, order.id, 'SYNC_ORDER_REVERSAL_SHEET');
            return order.id;
        });

        return repository.getOrderDetail(reversedId);
    }

    return { reverseOrder };
}

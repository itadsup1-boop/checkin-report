/**
 * Duyệt đơn xuất kho — nơi hàng thật rời khỏi kho.
 *
 * Đây là phần nhạy cảm nhất của domain: sai một bước là tồn kho lệch với thực tế
 * và sổ ledger không còn đối chiếu được. Bốn bước dưới đây phải nằm trong CÙNG
 * một transaction:
 *
 *   1. Trừ phần lấy được ngay tại cơ sở đang đứng
 *   2. Phần còn thiếu thì lấy bù từ cơ sở kia (dùng ngay, có phiếu điều chuyển)
 *   3. Ghi lại từng dòng hàng lấy bao nhiêu tại chỗ, bao nhiêu lấy bù
 *   4. Chốt trạng thái đơn, xếp việc báo Telegram và ghi Sheet vào hàng đợi
 *
 * Việc báo Telegram và ghi Sheet KHÔNG làm trực tiếp ở đây: chúng có thể lỗi
 * (mất mạng, hết quota Google) nhưng không được kéo theo rollback tồn kho.
 */

import { WAREHOUSE_ORDER_STATUSES, WarehouseError } from '../domain/constants.js';
import { makeCode } from './_shared/codes.js';

export function createApproveOrderUseCase({
    repository, orderRepo, inventoryRepo, ledgerRepo, transferRepo, outboxRepo,
    availability: availabilityService, actorContext: actorContextResolver, withTransaction
}) {
    const { getAvailability } = availabilityService;
    const { getActorContext, getAdminActorContext } = actorContextResolver;

    /**
     * Duyệt một đơn ĐÃ được khoá bằng SELECT ... FOR UPDATE.
     *
     * Tách riêng vì được dùng ở ba nơi: nhân viên có quyền tự duyệt lúc tạo đơn,
     * quản lý duyệt qua Telegram, và Admin duyệt trên Web Admin.
     */
    async function approveLockedOrder(client, order, actorContext) {
        if (order.status === WAREHOUSE_ORDER_STATUSES.APPROVED) {
            // Telegram có thể gửi lại cùng một callback hai lần.
            return { alreadyProcessed: true };
        }
        if (order.status !== WAREHOUSE_ORDER_STATUSES.PENDING) {
            throw new WarehouseError(`Đơn đang ở trạng thái ${order.status}, không thể duyệt.`, {
                status: 409,
                code: 'ORDER_NOT_PENDING'
            });
        }
        if (!actorContext.isAdmin && !actorContext.permissions.has('APPROVE_EXPORT')) {
            throw new WarehouseError('Bạn không có quyền duyệt đơn xuất kho trong nhóm này.', {
                status: 403,
                code: 'APPROVE_PERMISSION_REQUIRED'
            });
        }

        const orderItems = await orderRepo.listItems(client, order.id);
        const activeItems = orderItems.filter(item => !item.is_removed);
        const availability = await getAvailability(client, activeItems, { lock: true });
        if (availability.shortages.length) {
            throw new WarehouseError('Tổng tồn hai cơ sở không đủ để duyệt đơn.', {
                status: 409,
                code: 'INSUFFICIENT_STOCK',
                details: availability.shortages
            });
        }

        const otherBranch = order.branch === 'US' ? 'UK' : 'US';
        const requiresTransfer = availability.allocations.some(allocation =>
            allocation.required > allocation[order.branch]
        );
        if (requiresTransfer && !actorContext.isAdmin && !actorContext.permissions.has('APPROVE_TRANSFER')) {
            throw new WarehouseError('Đơn cần điều chuyển nhưng bạn chưa có quyền duyệt điều chuyển.', {
                status: 403,
                code: 'TRANSFER_PERMISSION_REQUIRED'
            });
        }

        const actor = {
            employeeId: actorContext.employee?.id || null,
            telegramId: actorContext.telegramId
        };

        let transfer = null;
        if (requiresTransfer) {
            transfer = await transferRepo.create(client, {
                transferCode: makeCode('TRF'),
                orderId: order.id,
                telegramGroupId: actorContext.group.telegram_group_id,
                fromBranch: otherBranch,
                toBranch: order.branch,
                actor
            });
        }

        for (const allocation of availability.allocations) {
            const localBefore = allocation[order.branch];
            const otherBefore = allocation[otherBranch];
            const localDeduct = Math.min(allocation.required, localBefore);
            const transferDeduct = allocation.required - localDeduct;
            const localAfter = localBefore - localDeduct;
            const otherAfter = otherBefore - transferDeduct;

            // Bước 1: trừ phần lấy được ngay tại cơ sở đang đứng.
            if (localDeduct > 0) {
                const truDuoc = await inventoryRepo.deduct(
                    client, allocation.product_id, order.branch, localDeduct
                );
                if (!truDuoc) {
                    throw new WarehouseError('Tồn kho vừa thay đổi, vui lòng duyệt lại.', {
                        status: 409,
                        code: 'CONCURRENT_STOCK_CHANGE'
                    });
                }
                await ledgerRepo.recordLocalExport(client, {
                    order,
                    productId: allocation.product_id,
                    branch: order.branch,
                    quantity: localDeduct,
                    balanceBefore: localBefore,
                    balanceAfter: localAfter,
                    actor
                });
            }

            // Bước 2: phần còn thiếu thì lấy bù từ cơ sở kia, dùng ngay cho khách.
            if (transferDeduct > 0) {
                const truDuoc = await inventoryRepo.deduct(
                    client, allocation.product_id, otherBranch, transferDeduct
                );
                if (!truDuoc) {
                    throw new WarehouseError('Tồn kho nguồn điều chuyển vừa thay đổi, vui lòng duyệt lại.', {
                        status: 409,
                        code: 'CONCURRENT_STOCK_CHANGE'
                    });
                }
                await transferRepo.addItem(client, transfer.id, allocation.product_id, transferDeduct);
                await ledgerRepo.recordTransferExport(client, {
                    order,
                    transferId: transfer.id,
                    productId: allocation.product_id,
                    fromBranch: otherBranch,
                    toBranch: order.branch,
                    quantity: transferDeduct,
                    fromBalanceBefore: otherBefore,
                    fromBalanceAfter: otherAfter,
                    toBalanceAfterLocal: localAfter,
                    actor
                });
            }

            // Bước 3: ghi lại từng dòng hàng lấy bao nhiêu tại chỗ, bao nhiêu lấy bù.
            let remainingLocal = localDeduct;
            const productItems = activeItems.filter(item => item.product_id === allocation.product_id);
            for (const item of productItems) {
                const quantity = Number(item.actual_quantity);
                const itemLocal = Math.min(quantity, remainingLocal);
                const itemTransfer = quantity - itemLocal;
                remainingLocal -= itemLocal;
                await orderRepo.setItemAllocation(client, item.id, {
                    localQuantity: itemLocal,
                    transferQuantity: itemTransfer,
                    transferFromBranch: itemTransfer > 0 ? otherBranch : null
                });
            }
        }

        // Bước 4: chốt trạng thái và xếp việc báo Telegram + ghi Sheet vào hàng đợi.
        await orderRepo.markApproved(client, order.id, actor);
        await outboxRepo.enqueue(client, order.id, 'ORDER_APPROVED', {
            has_transfer: requiresTransfer
        });
        await outboxRepo.enqueue(client, order.id, 'SYNC_ORDER_SHEET');
        return { alreadyProcessed: false, requiresTransfer };
    }

    /** Quản lý duyệt đơn từ Telegram. */
    async function approveOrder({ orderId, telegramId, chatId }) {
        const approvedId = await withTransaction(async client => {
            const actorContext = await getActorContext(client, telegramId, chatId);
            const order = await orderRepo.getForUpdate(client, orderId, actorContext.group.id);
            if (!order) throw new WarehouseError('Không tìm thấy đơn trong nhóm này.', { status: 404 });
            await approveLockedOrder(client, order, actorContext);
            return order.id;
        });
        // Đọc lại SAU khi commit: repository dùng pool riêng nên trước đó chưa thấy dữ liệu.
        return repository.getOrderDetail(approvedId);
    }

    /** Admin duyệt đơn trên Web Admin. */
    async function approveOrderAsAdmin({ orderId, groupId, adminId }) {
        const approvedId = await withTransaction(async client => {
            const actorContext = await getAdminActorContext(client, groupId, adminId);
            const order = await orderRepo.getForUpdate(client, orderId, actorContext.group.id);
            if (!order) throw new WarehouseError('Không tìm thấy đơn trong group này.', { status: 404 });
            await approveLockedOrder(client, order, actorContext);
            return order.id;
        });
        return repository.getOrderDetail(approvedId);
    }

    return { approveLockedOrder, approveOrder, approveOrderAsAdmin };
}

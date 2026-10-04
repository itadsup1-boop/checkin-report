/**
 * Từ chối đơn xuất kho.
 *
 * Không đụng tới tồn kho — đơn chờ duyệt chưa trừ hàng. Chỉ đổi trạng thái và
 * báo lại nhóm.
 *
 * Điều kiện `status = 'PENDING_APPROVAL'` nằm ngay trong câu UPDATE nên hai
 * người bấm từ chối cùng lúc thì chỉ một người thành công, người sau nhận thông
 * báo đơn đã được xử lý.
 */

import { WarehouseError } from '../domain/constants.js';

export function createRejectOrderUseCase({
    repository, orderRepo, outboxRepo, actorContext: actorContextResolver, withTransaction
}) {
    const { getActorContext, getAdminActorContext } = actorContextResolver;

    /** Dùng chung cho cả hai đường: Telegram và Web Admin. */
    async function rejectWithinTransaction(client, { orderId, groupId, actor }) {
        const tuChoiDuoc = await orderRepo.markRejected(client, orderId, groupId, actor);
        if (!tuChoiDuoc) {
            const existing = await orderRepo.getStatus(client, orderId, groupId);
            if (!existing) throw new WarehouseError('Không tìm thấy đơn.', { status: 404 });
            throw new WarehouseError(`Đơn đã được xử lý: ${existing.status}`, {
                status: 409,
                code: 'ORDER_NOT_PENDING'
            });
        }
        await outboxRepo.enqueue(client, orderId, 'ORDER_REJECTED');
    }

    /** Quản lý từ chối đơn từ Telegram. */
    async function rejectOrder({ orderId, telegramId, chatId }) {
        await withTransaction(async client => {
            const actorContext = await getActorContext(client, telegramId, chatId);
            if (!actorContext.isAdmin && !actorContext.permissions.has('APPROVE_EXPORT')) {
                throw new WarehouseError('Bạn không có quyền từ chối đơn trong nhóm này.', {
                    status: 403
                });
            }
            await rejectWithinTransaction(client, {
                orderId,
                groupId: actorContext.group.id,
                actor: {
                    employeeId: actorContext.employee?.id || null,
                    telegramId: actorContext.telegramId
                }
            });
        });
        return repository.getOrderDetail(orderId);
    }

    /** Admin từ chối đơn trên Web Admin. */
    async function rejectOrderAsAdmin({ orderId, groupId, adminId }) {
        await withTransaction(async client => {
            await getAdminActorContext(client, groupId, adminId);
            await rejectWithinTransaction(client, {
                orderId,
                groupId,
                actor: { employeeId: null, telegramId: `admin:${adminId}` }
            });
        });
        return repository.getOrderDetail(orderId);
    }

    return { rejectOrder, rejectOrderAsAdmin };
}

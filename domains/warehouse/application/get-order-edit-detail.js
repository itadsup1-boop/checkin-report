import { WarehouseError } from '../domain/constants.js';
import { validateEditWindow, validateOrderEditAuthorization } from '../domain/order-edit-rules.js';

/**
 * Use case: Tra cứu chi tiết đơn xuất/nhập kho và kiểm tra điều kiện được phép sửa trong vòng 24h.
 */
export function createGetOrderEditDetailUseCase({ orderEditRepo, warehouseOrderService }) {
    return async function getOrderEditDetail({ targetType = 'EXPORT', id, telegramId, chatId }) {
        if (!id) {
            throw new WarehouseError('Thiếu mã đơn/giao dịch cần kiểm tra.', { status: 400 });
        }

        const actor = await warehouseOrderService.authorizeActor({
            telegramId,
            chatId,
            requireEmployee: true
        });

        if (targetType === 'EXPORT') {
            const data = await orderEditRepo.findExportOrderForEdit(id);
            if (!data || !data.order) {
                throw new WarehouseError('Không tìm thấy đơn xuất kho.', { status: 404 });
            }

            const windowCheck = validateEditWindow(data.order.created_at);
            const authCheck = validateOrderEditAuthorization({ actor, order: data.order });

            return {
                targetType: 'EXPORT',
                order: data.order,
                items: data.items,
                stockMap: data.stockMap,
                windowCheck,
                authCheck,
                canEdit: windowCheck.allowed && authCheck.allowed
            };
        } else if (targetType === 'IMPORT') {
            const data = await orderEditRepo.findImportTransactionForEdit(id);
            if (!data || !data.transaction) {
                throw new WarehouseError('Không tìm thấy giao dịch nhập kho.', { status: 404 });
            }

            const windowCheck = validateEditWindow(data.transaction.created_at);
            const authCheck = validateOrderEditAuthorization({ actor, order: data.transaction });

            return {
                targetType: 'IMPORT',
                transaction: data.transaction,
                currentStock: data.currentStock,
                windowCheck,
                authCheck,
                canEdit: windowCheck.allowed && authCheck.allowed
            };
        } else {
            throw new WarehouseError('Loại đơn không hợp lệ (chỉ hỗ trợ EXPORT hoặc IMPORT).', { status: 400 });
        }
    };
}

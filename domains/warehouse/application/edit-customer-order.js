import { WarehouseError } from '../domain/constants.js';
import {
    validateEditWindow,
    validateOrderEditAuthorization,
    calculateExportDeltas,
    validateExportStockAvailability
} from '../domain/order-edit-rules.js';

/**
 * Use case: Chỉnh sửa đơn xuất kho khách hàng trong vòng 24h.
 * Đảm bảo:
 * - Không sửa đơn quá 24h
 * - Phân quyền người sửa
 * - Chống âm kho khi tăng xuất
 * - Ghi bù trừ sổ cái (Ledger) và hàng đợi outbox
 */
export function createEditCustomerOrderUseCase({ orderEditRepo, warehouseOrderService, withTransaction }) {
    return async function editCustomerOrder({
        orderId,
        telegramId,
        chatId,
        editReason,
        updatedItems
    }) {
        if (!orderId) {
            throw new WarehouseError('Thiếu mã đơn hàng.', { status: 400 });
        }
        if (!editReason || !editReason.trim()) {
            throw new WarehouseError('Vui lòng nhập lý do chỉnh sửa đơn.', { status: 400 });
        }
        if (!Array.isArray(updatedItems)) {
            throw new WarehouseError('Danh sách sản phẩm không hợp lệ.', { status: 400 });
        }

        const actor = await warehouseOrderService.authorizeActor({
            telegramId,
            chatId,
            requireEmployee: true
        });

        return await withTransaction(async client => {
            const data = await orderEditRepo.findExportOrderForEdit(orderId);
            if (!data || !data.order) {
                throw new WarehouseError('Không tìm thấy đơn xuất kho.', { status: 404 });
            }

            const { order, items, stockMap } = data;

            if (order.status !== 'APPROVED') {
                throw new WarehouseError(`Chỉ có thể sửa đơn ở trạng thái ĐÃ DUYỆT (hiện tại: ${order.status}).`, { status: 400 });
            }

            const windowCheck = validateEditWindow(order.created_at);
            if (!windowCheck.allowed) {
                throw new WarehouseError(windowCheck.message, { status: 400, code: windowCheck.reason });
            }

            const authCheck = validateOrderEditAuthorization({ actor, order });
            if (!authCheck.allowed) {
                throw new WarehouseError(authCheck.message, { status: 403, code: authCheck.reason });
            }

            const { deltas, hasChanges } = calculateExportDeltas({
                currentItems: items,
                updatedItems
            });

            if (!hasChanges) {
                return {
                    success: true,
                    modified: false,
                    message: 'Không có thay đổi nào về số lượng sản phẩm.'
                };
            }

            const stockCheck = validateExportStockAvailability({
                deltas,
                availableStockMap: stockMap
            });

            if (!stockCheck.valid) {
                const names = stockCheck.insufficientProducts
                    .map(p => `• ${p.productName}: thiếu ${p.shortage} (còn ${p.available})`)
                    .join('\n');
                throw new WarehouseError(`Không đủ tồn kho để tăng số lượng xuất:\n${names}`, {
                    status: 400,
                    code: 'INSUFFICIENT_STOCK',
                    details: stockCheck.insufficientProducts
                });
            }

            await orderEditRepo.applyExportOrderEdit(client, {
                order,
                editorEmployeeId: actor.employee?.id,
                editorTelegramId: telegramId,
                editReason: editReason.trim(),
                deltas,
                changesSnapshot: {
                    editReason: editReason.trim(),
                    deltas,
                    timestamp: new Date().toISOString()
                }
            });

            return {
                success: true,
                modified: true,
                orderId,
                deltas: deltas.filter(d => d.delta !== 0)
            };
        });
    };
}

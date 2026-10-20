import { WarehouseError } from '../domain/constants.js';
import {
    validateEditWindow,
    validateOrderEditAuthorization,
    calculateImportDeltas,
    validateImportStockReduction
} from '../domain/order-edit-rules.js';

/**
 * Use case: Chỉnh sửa giao dịch nhập kho trong vòng 24h.
 * Đảm bảo:
 * - Không sửa giao dịch quá 24h
 * - Phân quyền người sửa (chính chủ hoặc Quản lý/Admin)
 * - Chống âm kho khi giảm số lượng nhập (đã bị xuất dùng)
 * - Ghi bù trừ sổ cái (Ledger) và hàng đợi outbox
 */
export function createEditWarehouseImportUseCase({ orderEditRepo, warehouseOrderService, withTransaction }) {
    return async function editWarehouseImport({
        transactionId,
        telegramId,
        chatId,
        editReason,
        newQuantity
    }) {
        if (!transactionId) {
            throw new WarehouseError('Thiếu mã giao dịch nhập kho.', { status: 400 });
        }
        if (!editReason || !editReason.trim()) {
            throw new WarehouseError('Vui lòng nhập lý do chỉnh sửa giao dịch.', { status: 400 });
        }
        const parsedQuantity = Number(newQuantity);
        if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
            throw new WarehouseError('Số lượng mới phải là số dương lớn hơn 0.', { status: 400 });
        }

        const actor = await warehouseOrderService.authorizeActor({
            telegramId,
            chatId,
            requireEmployee: true
        });

        return await withTransaction(async client => {
            const data = await orderEditRepo.findImportTransactionForEdit(transactionId);
            if (!data || !data.transaction) {
                throw new WarehouseError('Không tìm thấy giao dịch nhập kho.', { status: 404 });
            }

            const { transaction, currentStock } = data;

            if (transaction.status !== 'APPROVED') {
                throw new WarehouseError(`Chỉ có thể sửa giao dịch ở trạng thái ĐÃ DUYỆT (hiện tại: ${transaction.status}).`, { status: 400 });
            }

            const windowCheck = validateEditWindow(transaction.created_at);
            if (!windowCheck.allowed) {
                throw new WarehouseError(windowCheck.message, { status: 400, code: windowCheck.reason });
            }

            const authCheck = validateOrderEditAuthorization({ actor, order: transaction });
            if (!authCheck.allowed) {
                throw new WarehouseError(authCheck.message, { status: 403, code: authCheck.reason });
            }

            const { delta, oldQuantity } = calculateImportDeltas({
                currentQuantity: transaction.quantity,
                newQuantity: parsedQuantity
            });

            if (delta === 0) {
                return {
                    success: true,
                    modified: false,
                    message: 'Số lượng không thay đổi.'
                };
            }

            const reductionCheck = validateImportStockReduction({ delta, currentStock });
            if (!reductionCheck.valid) {
                throw new WarehouseError(reductionCheck.message, {
                    status: 400,
                    code: reductionCheck.reason,
                    details: {
                        currentStock: reductionCheck.currentStock,
                        requestedReduction: reductionCheck.requestedReduction,
                        shortage: reductionCheck.shortage
                    }
                });
            }

            await orderEditRepo.applyImportTransactionEdit(client, {
                transaction,
                editorEmployeeId: actor.employee?.id,
                editorTelegramId: telegramId,
                editReason: editReason.trim(),
                delta,
                newQuantity: parsedQuantity,
                changesSnapshot: {
                    editReason: editReason.trim(),
                    oldQuantity,
                    newQuantity: parsedQuantity,
                    delta,
                    timestamp: new Date().toISOString()
                }
            });

            return {
                success: true,
                modified: true,
                transactionId,
                oldQuantity,
                newQuantity: parsedQuantity,
                delta
            };
        });
    };
}

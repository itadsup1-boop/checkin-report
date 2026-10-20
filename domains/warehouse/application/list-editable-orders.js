/**
 * Use case: Lấy danh sách các đơn xuất hoặc phiếu nhập gần đây để nhân viên chọn sửa.
 * Phân biệt rõ các đơn còn trong hạn 24h và đã quá hạn.
 */
export function createListEditableOrdersUseCase({ orderEditRepo, warehouseOrderService }) {
    return async function listEditableOrders({ targetType = 'EXPORT', telegramId, chatId, limit = 30 }) {
        const actor = await warehouseOrderService.authorizeActor({
            telegramId,
            chatId,
            requireEmployee: true
        });

        const role = actor?.employee?.role || actor?.role;
        const isAdminOrManager = role === 'admin' || role === 'Quản lý';
        const employeeId = actor?.employee?.id || actor?.id;
        const groupId = actor?.group?.id || null;

        const isExport = String(targetType).toUpperCase() === 'EXPORT';

        let list = [];
        if (isExport) {
            list = await orderEditRepo.listEditableExportOrders({
                employeeId,
                telegramId,
                isAdminOrManager,
                groupId,
                limit
            });
        } else {
            list = await orderEditRepo.listEditableImportTransactions({
                employeeId,
                telegramId,
                isAdminOrManager,
                groupId,
                limit
            });
        }

        return {
            targetType: isExport ? 'EXPORT' : 'IMPORT',
            isAdminOrManager,
            actorName: actor?.employee?.full_name || 'Nhân viên',
            orders: list
        };
    };
}

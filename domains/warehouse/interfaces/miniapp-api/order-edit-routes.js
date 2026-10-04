import { WarehouseError } from '../../domain/constants.js';

function sendWarehouseError(res, error) {
    if (error instanceof WarehouseError || error?.name === 'WarehouseError') {
        return res.status(error.status || 400).json({
            success: false,
            code: error.code,
            message: error.message,
            details: error.details || undefined
        });
    }
    console.error('[Warehouse Order Edit API]', error);
    return res.status(500).json({
        success: false,
        code: 'WAREHOUSE_INTERNAL_ERROR',
        message: 'Lỗi máy chủ khi xử lý chỉnh sửa đơn kho.'
    });
}

export function registerWarehouseOrderEditRoutes({
    botApp,
    authenticateTelegramMiniApp,
    getOrderEditDetail,
    editCustomerOrder,
    editWarehouseImport
}) {
    /**
     * Lấy chi tiết đơn xuất hoặc giao dịch nhập để kiểm tra điều kiện sửa trong 24h.
     */
    botApp.get('/api/warehouse/order-edit/detail', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const { type, id, chat_id: chatId } = req.query;
            const result = await getOrderEditDetail({
                targetType: String(type || 'EXPORT').toUpperCase(),
                id,
                telegramId: req.verifiedTelegramId,
                chatId
            });
            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            sendWarehouseError(res, error);
        }
    });

    /**
     * Chỉnh sửa đơn xuất kho khách hàng trong vòng 24h.
     */
    botApp.post('/api/warehouse/order-edit/export', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const {
                order_id: orderId,
                chat_id: chatId,
                edit_reason: editReason,
                updated_items: updatedItems
            } = req.body;

            const result = await editCustomerOrder({
                orderId,
                telegramId: req.verifiedTelegramId,
                chatId,
                editReason,
                updatedItems
            });

            res.json(result);
        } catch (error) {
            sendWarehouseError(res, error);
        }
    });

    /**
     * Chỉnh sửa giao dịch nhập kho trong vòng 24h.
     */
    botApp.post('/api/warehouse/order-edit/import', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const {
                transaction_id: transactionId,
                chat_id: chatId,
                edit_reason: editReason,
                new_quantity: newQuantity
            } = req.body;

            const result = await editWarehouseImport({
                transactionId,
                telegramId: req.verifiedTelegramId,
                chatId,
                editReason,
                newQuantity
            });

            res.json(result);
        } catch (error) {
            sendWarehouseError(res, error);
        }
    });
}

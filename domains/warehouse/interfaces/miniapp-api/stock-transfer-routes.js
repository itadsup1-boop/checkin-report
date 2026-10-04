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
    console.error('[Warehouse Stock Transfer API]', error);
    return res.status(500).json({
        success: false,
        code: 'WAREHOUSE_INTERNAL_ERROR',
        message: 'Lỗi máy chủ khi xử lý chuyển kho.'
    });
}

export function registerWarehouseStockTransferRoutes({
    botApp,
    authenticateTelegramMiniApp,
    warehouseOrderService
}) {
    botApp.post('/api/warehouse/stock-transfers', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const transfer = await warehouseOrderService.createStockTransfer({
                telegramId: req.verifiedTelegramId,
                chatId: req.body.chat_id,
                input: req.body
            });
            res.status(201).json({ success: true, transfer });
        } catch (error) {
            sendWarehouseError(res, error);
        }
    });
}

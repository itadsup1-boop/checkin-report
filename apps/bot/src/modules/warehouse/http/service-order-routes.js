import { WarehouseError } from '../../../../../../packages/warehouse/index.js';

function sendWarehouseError(res, error) {
    if (error instanceof WarehouseError || error?.name === 'WarehouseError') {
        return res.status(error.status || 400).json({
            success: false,
            code: error.code,
            message: error.message,
            details: error.details || undefined
        });
    }
    console.error('[Warehouse Service Order API]', error);
    return res.status(500).json({
        success: false,
        code: 'WAREHOUSE_INTERNAL_ERROR',
        message: 'Lỗi máy chủ khi xử lý đơn kho.'
    });
}

export function registerWarehouseServiceOrderRoutes({
    botApp,
    authenticateTelegramMiniApp,
    warehouseOrderService
}) {
    botApp.get('/api/warehouse/config', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const { group } = await warehouseOrderService.authorizeActor({
                telegramId: req.verifiedTelegramId,
                chatId: req.query.chat_id
            });
            res.json({
                success: true,
                service_order_enabled: group.warehouse_service_order_enabled === true
            });
        } catch (error) {
            sendWarehouseError(res, error);
        }
    });

    botApp.get('/api/warehouse/service-order/bootstrap', authenticateTelegramMiniApp, async (req, res) => {
        try {
            await warehouseOrderService.authorizeActor({
                telegramId: req.verifiedTelegramId,
                chatId: req.query.chat_id
            });
            const data = await warehouseOrderService.repository.getBootstrap(req.query.chat_id);
            res.json({
                success: true,
                service_order_enabled: data.group.warehouse_service_order_enabled === true,
                services: data.services,
                products: data.products,
                inventory: data.inventory
            });
        } catch (error) {
            sendWarehouseError(res, error);
        }
    });

    botApp.get('/api/warehouse/customers/suggestion', authenticateTelegramMiniApp, async (req, res) => {
        try {
            await warehouseOrderService.authorizeActor({
                telegramId: req.verifiedTelegramId,
                chatId: req.query.chat_id
            });
            const customer = await warehouseOrderService.suggestCustomer(req.query.phone);
            res.json({ success: true, customer });
        } catch (error) {
            sendWarehouseError(res, error);
        }
    });

    botApp.post('/api/warehouse/service-orders', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const order = await warehouseOrderService.createOrder({
                telegramId: req.verifiedTelegramId,
                chatId: req.body.chat_id,
                input: req.body,
                submit: req.body.submit !== false
            });
            res.status(201).json({ success: true, order });
        } catch (error) {
            sendWarehouseError(res, error);
        }
    });

    botApp.get('/api/warehouse/service-orders/:orderId', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const { group } = await warehouseOrderService.authorizeActor({
                telegramId: req.verifiedTelegramId,
                chatId: req.query.chat_id
            });
            const order = await warehouseOrderService.repository.getOrderDetail(req.params.orderId);
            if (!order || order.group_id !== group.id) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy đơn.' });
            }
            res.json({ success: true, order });
        } catch (error) {
            sendWarehouseError(res, error);
        }
    });

    botApp.post('/api/warehouse/service-orders/:orderId/approve', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const order = await warehouseOrderService.approveOrder({
                orderId: req.params.orderId,
                telegramId: req.verifiedTelegramId,
                chatId: req.body.chat_id
            });
            res.json({ success: true, order });
        } catch (error) {
            sendWarehouseError(res, error);
        }
    });

    botApp.post('/api/warehouse/service-orders/:orderId/reject', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const order = await warehouseOrderService.rejectOrder({
                orderId: req.params.orderId,
                telegramId: req.verifiedTelegramId,
                chatId: req.body.chat_id
            });
            res.json({ success: true, order });
        } catch (error) {
            sendWarehouseError(res, error);
        }
    });
}

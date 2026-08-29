import { WarehouseError } from '../../domain/constants.js';

export function registerWarehouseServiceOrderActions({
    bot,
    warehouseOrderService
}) {
    bot.action(/^(wh_svc_approve|wh_svc_reject)_([0-9a-f-]{36})$/i, async ctx => {
        const action = ctx.match[1];
        const orderId = ctx.match[2];
        try {
            const params = {
                orderId,
                telegramId: ctx.from.id.toString(),
                chatId: ctx.chat.id.toString()
            };
            const order = action === 'wh_svc_approve'
                ? await warehouseOrderService.approveOrder(params)
                : await warehouseOrderService.rejectOrder(params);

            await ctx.answerCbQuery(
                action === 'wh_svc_approve' ? 'Đã duyệt và trừ kho.' : 'Đã từ chối đơn.',
                { show_alert: true }
            );
            // Outbox sẽ sửa chính tin chờ duyệt sau commit. Nhờ đó lỗi Telegram
            // không làm rollback tồn kho và cũng không phát sinh hai thông báo thành công.
        } catch (error) {
            const message = error instanceof WarehouseError || error?.name === 'WarehouseError'
                ? error.message
                : 'Lỗi hệ thống khi xử lý đơn.';
            console.error('[Warehouse Service Order Callback]', error);
            await ctx.answerCbQuery(message, { show_alert: true }).catch(() => {});
        }
    });
}

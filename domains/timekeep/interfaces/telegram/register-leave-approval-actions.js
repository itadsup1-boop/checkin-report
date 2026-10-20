/**
 * Nút duyệt/từ chối đơn nghỉ và miễn trừ án phạt nghỉ liên tiếp trong nhóm
 * Telegram.
 *
 * Callback_data giữ nguyên `approve_leave_<id>` / `reject_leave_<id>` /
 * `excuse_penalty_<uuid>` — tin nhắn cũ trong nhóm vẫn mang các nút này.
 */
export function registerLeaveApprovalActions({ bot, requireGroupRole, reviewLeaveRequest, excusePenalty }) {
    bot.action(/^(approve|reject)_leave_(.+)$/, async ctx => {
        if (!(await requireGroupRole(ctx, 'timekeep'))) return;
        try {
            const action = ctx.match[1];
            const requestId = ctx.match[2];
            const clickerId = ctx.from.id.toString();

            const result = await reviewLeaveRequest({
                action, requestId, clickerId,
                clickerUsername: ctx.from.username, clickerFirstName: ctx.from.first_name
            });

            if (!result.ok) {
                return ctx.answerCbQuery(result.message, { show_alert: result.alert });
            }

            await ctx.editMessageText(result.updatedMsg, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: result.penaltyButtons }
            });
            await ctx.answerCbQuery(`Đã ${result.newStatus === 'APPROVED' ? 'duyệt' : 'từ chối'} yêu cầu!`);

            try {
                await ctx.telegram.sendMessage(result.employeeTelegramId, result.notifyText, { parse_mode: 'HTML' });
            } catch (e) {
                console.log(`Không thể gửi tin nhắn riêng cho user ${result.employeeTelegramId} (chưa chat với bot bao giờ).`);
            }
        } catch (e) {
            console.error('Lỗi duyệt phép bot.action:', e);
            await ctx.answerCbQuery('Lỗi xử lý hệ thống!', { show_alert: true });
        }
    });

    bot.action(/^excuse_penalty_([0-9a-f-]{36})$/i, async ctx => {
        if (!(await requireGroupRole(ctx, 'timekeep'))) return;
        try {
            const penaltyId = ctx.match[1];
            const clickerId = ctx.from.id.toString();

            const result = await excusePenalty({ penaltyId, clickerId });
            if (!result.ok) {
                return ctx.answerCbQuery(result.message, { show_alert: true });
            }

            let msgText = ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption || '';
            msgText += `\n\n🎁 <b>Miễn trừ:</b> Án phạt nghỉ liên tiếp 2 ngày đã được miễn trừ bởi Admin <b>${result.adminName}</b>.`;

            await ctx.editMessageText(msgText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
            await ctx.answerCbQuery('Đã miễn trừ án phạt thành công!', { show_alert: true });
        } catch (e) {
            console.error('Lỗi miễn trừ phạt bot.action:', e);
            await ctx.answerCbQuery('Lỗi xử lý hệ thống!', { show_alert: true });
        }
    });
}

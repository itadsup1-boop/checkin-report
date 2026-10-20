/**
 * Nút bấm của báo cáo KPI: xin nghỉ phép (báo cáo 0 tự động), và kiểm tra/mở
 * lại form cập nhật báo cáo hôm nay.
 */

export function registerReportCallbacks({
    bot, kpiComposer, reportRepository, finalizeReport, crypto
}) {
    kpiComposer.action('REQUEST_LEAVE', async ctx => {
        ctx.answerCbQuery();
        const name = ctx.from.first_name || ctx.from.username || 'Bạn';
        const telegramId = ctx.from.id;
        return ctx.replyWithHTML(`⚠️ <b>${name}</b> ơi, bạn có chắc chắn muốn <b>đăng ký NGHỈ PHÉP</b> hôm nay không?`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Có, tôi xin nghỉ', callback_data: `CONFIRM_LEAVE_${telegramId}` },
                        { text: '❌ Không, tôi bấm nhầm', callback_data: `CANCEL_LEAVE_${telegramId}` }
                    ]
                ]
            }
        });
    });

    kpiComposer.action(/^CANCEL_LEAVE_(\d+)$/, ctx => {
        const targetId = ctx.match[1];
        if (ctx.from.id.toString() !== targetId) {
            return ctx.answerCbQuery('❌ Nút này không dành cho bạn!', { show_alert: true });
        }
        ctx.answerCbQuery('Đã hủy thao tác xin nghỉ!');
        ctx.deleteMessage().catch(() => {});
    });

    kpiComposer.action(/^CONFIRM_LEAVE_(\d+)$/, async ctx => {
        const targetId = ctx.match[1];
        if (ctx.from.id.toString() !== targetId) {
            return ctx.answerCbQuery('❌ Nút này không dành cho bạn!', { show_alert: true });
        }
        ctx.answerCbQuery();
        const telegramId = ctx.from.id.toString();
        const groupId = ctx.chat.id.toString();

        try {
            const user = await reportRepository.findEmployeeByTelegramId(telegramId);
            if (!user) {
                return ctx.reply('❌ Bạn chưa đăng ký tài khoản. Vui lòng bấm [👤 Đăng Ký Tài Khoản] trước.');
            }
            if (user.is_active === false) {
                return ctx.reply('⚠️ Tài khoản của bạn đã bị vô hiệu hóa trong hệ thống. Vui lòng liên hệ Admin nếu muốn bật lại.');
            }

            await reportRepository.deletePendingReport(telegramId, groupId);

            const parsedJSON = {
                is_valid: true,
                kpi_actual: 0,
                doanh_thu: 0,
                lich_khach: 'Nghỉ phép'
            };

            await finalizeReport(user, parsedJSON, 0, telegramId, groupId, 'XIN NGHỈ', bot);
            ctx.deleteMessage().catch(() => {});
        } catch (err) {
            console.error('Lỗi đăng ký nghỉ:', err);
            ctx.reply('❌ Có lỗi xảy ra khi xử lý yêu cầu nghỉ phép.');
        }
    });

    kpiComposer.action('CHECK_UPDATE_REPORT', async ctx => {
        const telegramId = ctx.from.id.toString();
        const groupId = ctx.chat.id.toString();
        const today = new Date().toISOString().split('T')[0];

        try {
            const employee = await reportRepository.findEmployeeByTelegramId(telegramId);
            if (!employee || employee.is_active === false) {
                return ctx.answerCbQuery('⚠️ Tài khoản của bạn chưa đăng ký hoặc đã bị vô hiệu hóa trong hệ thống!', { show_alert: true });
            }

            let hasReport = Boolean(await reportRepository.findPendingWaitingPhotos(telegramId, groupId));

            if (!hasReport && employee.is_active) {
                const report = await reportRepository.findTodayReport(groupId, employee.id, today);
                hasReport = Boolean(report);
            }

            if (hasReport) {
                await ctx.answerCbQuery('✅ Đã tìm thấy báo cáo hôm nay!');
                const botUsername = ctx.botInfo.username;
                const shortName = process.env.TELEGRAM_MINI_APP_SHORT_NAME || 'app';
                const ts = Date.now();
                const token = process.env.TELEGRAM_BOT_TOKEN || '';
                const bcDataString = `baocao:${groupId}:${ts}`;
                const bcSig = crypto.createHmac('sha256', token).update(bcDataString).digest('hex');
                const dmUrl = `https://t.me/${botUsername}/${shortName}?startapp=baocao_${groupId}_${ts}_${bcSig}`;

                return ctx.reply('✅ Đã tìm thấy báo cáo của bạn hôm nay.\n👉 Vui lòng bấm nút bên dưới để mở Form cập nhật.', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Mở Form Cập Nhật', url: dmUrl }]
                        ]
                    }
                });
            }

            // Nếu chưa nộp: Hiển thị popup alert trên màn hình người bấm thay vì gửi tin nhắn vào nhóm
            return ctx.answerCbQuery('❌ Hôm nay bạn chưa nộp báo cáo nào!\n👉 Vui lòng bấm nút [📝 Điền Báo Cáo KPI (Form)] ở Menu để nộp mới.', { show_alert: true });
        } catch (err) {
            console.error('Lỗi CHECK_UPDATE_REPORT:', err);
            return ctx.answerCbQuery('❌ Lỗi hệ thống khi kiểm tra báo cáo.', { show_alert: true });
        }
    });
}

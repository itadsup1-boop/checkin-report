/**
 * Bắt tin nhắn văn bản, ảnh báo tour trực tiếp trên Telegram và lệnh /tongtour.
 *
 * Tầng interfaces Telegram cho nhóm role `report_tour`.
 */

import { parseTourMessage, calculateTourCredit } from '../../domain/tour-report-parser.js';

export function createTourPhotoHandler({ tourRepository, tourSheetSync, getGroupRole, escapeHtml, moment }) {
    return async function handleTourPhoto(ctx) {
        try {
            const groupId = String(ctx.chat.id);
            const role = await getGroupRole(groupId);
            if (role !== 'report_tour') return false;

            const caption = ctx.message.caption || '';
            const isTourPattern = /(?:Khách|Khach)\s*[:：]/i.test(caption) && /(?:KTV|DV|Dịch vụ|SĐT)\s*[:：]/i.test(caption);
            if (!isTourPattern) return false;

            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const parsed = parseTourMessage(caption, { hasPhoto: true, now: new Date() });

            if (!parsed.isValid) {
                await ctx.reply(
                    `⚠️ <b>CHƯA ĐỦ ĐIỀU KIỆN TÍNH CÔNG TOUR</b>\n\n`
                    + `Lý do: <i>${parsed.missingReason}</i>\n\n`
                    + `👉 <i>Vui lòng bổ sung đầy đủ thông tin để được tính công!</i>`,
                    { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id }
                );
                return true;
            }

            // Kiểm tra chống trùng
            const existing = await tourRepository.findDuplicateToday(
                groupId, parsed.reportDate, parsed.phone, parsed.service
            );
            if (existing) {
                await ctx.reply(
                    `⚠️ <b>CÔNG TOUR ĐÃ TỒN TẠI HÔM NAY</b>\n\n`
                    + `Khách hàng <b>${escapeHtml(parsed.customerName)}</b> (${parsed.phone}) đã được báo tour trong ngày hôm nay rồi!\n`
                    + `👉 Hệ thống không tính trùng.`,
                    { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id }
                );
                return true;
            }

            const senderName = ctx.from.first_name || ctx.from.username || 'KTV';
            const record = await tourRepository.insertTourReport({
                groupId,
                messageId: ctx.message.message_id,
                telegramUserId: ctx.from.id,
                reportedBy: senderName,
                reportDate: parsed.reportDate,
                customerName: parsed.customerName,
                phone: parsed.phone,
                customerType: parsed.customerType,
                doctor: parsed.doctor,
                service: parsed.service,
                ktvNames: parsed.ktvNames,
                tourCredit: parsed.tourCredit,
                photoFileId: photo.file_id,
                notes: parsed.notes || null,
                isValid: true,
                status: 'VALID',
                rawText: caption
            });

            if (tourSheetSync) {
                tourSheetSync.syncTourToSheet(groupId, { ...record, ...parsed }).catch(err => {
                    console.error('Lỗi sync tour Telegram lên sheet:', err);
                });
            }

            const creditNotice = parsed.tourCredit === 1 ? '1 công' : `${parsed.tourCredit} công`;
            await ctx.reply(
                `✅ <b>ĐÃ GHI NHẬN CÔNG TOUR THÀNH CÔNG</b>\n\n`
                + `👤 Khách: <b>${escapeHtml(parsed.customerName)}</b> (${parsed.customerType})\n`
                + `💆‍♀️ KTV: <b>${escapeHtml(parsed.ktvNames.join(', '))}</b> (+${creditNotice}/người)\n`
                + (parsed.doctor ? `👨‍⚕️ Bác sĩ: ${escapeHtml(parsed.doctor)}\n` : '')
                + `🩺 Dịch vụ: ${escapeHtml(parsed.service || 'Chưa nhập')}\n\n`
                + `👉 <i>Bot sẽ tự động tổng hợp báo cáo công tour vào 22:00 tối nay.</i>`,
                { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id }
            );
            return true;
        } catch (err) {
            console.error('Lỗi xử lý ảnh báo tour Telegram:', err);
            return false;
        }
    };
}

export function registerTourReportHandler({
    kpiComposer,
    tourRepository,
    summarizeDailyTour,
    getGroupRole,
    escapeHtml,
    moment
}) {
    // 1. Lệnh xem tổng tour tức thì
    if (typeof kpiComposer.command === 'function') {
        kpiComposer.command(['tongtour', 'congtour'], async (ctx) => {
            try {
                const groupId = String(ctx.chat.id);
                const role = await getGroupRole(groupId);
                if (role !== 'report_tour') {
                    return ctx.reply('⚠️ Lệnh này chỉ áp dụng cho nhóm Báo công tour (report_tour)!');
                }
                const summary = await summarizeDailyTour.getInstantGroupSummary(groupId);
                return ctx.replyWithHTML(summary, { reply_to_message_id: ctx.message.message_id });
            } catch (err) {
                console.error('Lỗi lệnh /tongtour:', err);
                return ctx.reply('⚠️ Đã xảy ra lỗi khi lấy tổng hợp công tour.');
            }
        });
    }

    // 2. Bắt tin nhắn văn bản khớp mẫu tour nhưng thiếu ảnh để nhắc nhở
    if (typeof kpiComposer.hears === 'function') {
        kpiComposer.hears(/(?:Khách|Khach)\s*[:：]/i, async (ctx, next) => {
            try {
                const groupId = String(ctx.chat.id);
                const role = await getGroupRole(groupId);
                if (role !== 'report_tour') return next();

                const text = ctx.message.text || '';
                const isTourPattern = /(?:Khách|Khach)\s*[:：]/i.test(text) && /(?:KTV|DV|Dịch vụ|SĐT)\s*[:：]/i.test(text);
                if (!isTourPattern) return next();

                return ctx.reply(
                    `⚠️ <b>CHƯA TÍNH CÔNG TOUR</b>\n\n`
                    + `Lý do: <i>Thiếu ảnh chứng thực khách hàng thực tế tại cơ sở!</i>\n\n`
                    + `👉 <b>Vui lòng gửi lại tin nhắn đính kèm ảnh thực tế</b> hoặc mở nút <b>[Báo Tour]</b> từ menu để hoàn tất tính công nhé!`,
                    { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id }
                );
            } catch (err) {
                console.error('Lỗi cảnh báo tin text báo tour:', err);
                return next();
            }
        });
    }
}

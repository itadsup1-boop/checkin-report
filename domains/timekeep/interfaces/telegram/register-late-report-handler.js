/**
 * Nhân viên gõ thẳng vào nhóm kiểu "em xin đi muộn 5 phút vì trời mưa ạ" thay
 * vì mở Mini App — tự tạo đơn LATE có hiệu lực ngay (giống hệt luồng bấm nút),
 * KHÔNG chờ xác nhận thêm. Tin nhắn "ĐƠN ĐÃ ĐƯỢC TỰ ĐỘNG CHẤP NHẬN" do chính
 * `saveLeaveRequest` gửi vào nhóm đóng vai trò xác nhận.
 *
 * Chỉ nhận diện khi CHÍNH nhân viên đó tự gửi tin nhắn về mình — không có cách
 * nào phân biệt tin "xin phép" với tin quản lý hỏi lại bằng cách hành văn, nên
 * đây là điều kiện chặn duy nhất đáng tin: người gửi phải trùng người được nói
 * tới, tức phải resolve được hồ sơ nhân sự đúng nhóm.
 */

import { parseLateAnnouncement } from '../../domain/leave-request-rules.js';

// Có tín hiệu đi muộn nhưng không trích được số phút cụ thể — mặc định 30
// phút thay vì bỏ qua, để vẫn có căn cứ so khớp lúc tính phạt.
const DEFAULT_LATE_MINUTES = 30;

export function registerLateReportHandler({ bot, findEmployeeContext, saveLeaveRequest, moment }) {
    bot.on('text', async (ctx, next) => {
        try {
            if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) return next();

            const msg = ctx.message;
            if (!msg || !msg.from || msg.from.is_bot || !msg.text || msg.text.startsWith('/')) {
                return next();
            }

            const parsed = parseLateAnnouncement(msg.text);
            if (!parsed.matched) return next();

            const telegramId = msg.from.id.toString();
            const telegramGroupId = ctx.chat.id.toString();

            const user = await findEmployeeContext(telegramId, telegramGroupId);
            if (!user) return next();

            const nowMoment = moment().utcOffset(7);
            let targetDate = nowMoment.format('YYYY-MM-DD');

            // Xử lý từ "mai" / "ngày mai":
            // Nếu gửi từ 12:00 trưa trở đi: "mai" là ngày hôm sau.
            // Nếu gửi lúc rạng sáng (00:00 - 06:00): người làm đêm nói "mai" thực chất là ca sáng cùng ngày hôm đó (sáng nay).
            const lowerText = msg.text.toLowerCase();
            const mentionsTomorrow = /(?:^|\s)(?:ngày mai|mai)(?:\s|$|[.,!?;])/i.test(lowerText) && !lowerText.includes('hôm nay') && !lowerText.includes('nay e');
            if (mentionsTomorrow && nowMoment.hour() >= 12) {
                targetDate = nowMoment.clone().add(1, 'day').format('YYYY-MM-DD');
            }

            await saveLeaveRequest({
                telegramId,
                chatId: telegramGroupId,
                requestType: 'LATE',
                lateMinutes: parsed.minutes || DEFAULT_LATE_MINUTES,
                date: targetDate,
                reason: msg.text.trim(),
                proofImage: null
            });
        } catch (err) {
            console.error('[Late Report Handler Error]', err?.stack || err?.message || err);
        }
        return next();
    });
}

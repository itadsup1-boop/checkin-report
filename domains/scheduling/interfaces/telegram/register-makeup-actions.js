/**
 * Hai nút "✅ Duyệt" / "❌ Từ chối" dưới tin yêu cầu báo bù công tour.
 *
 * Tầng này chỉ dịch Telegram ↔ nghiệp vụ: lấy id từ callback_data, gọi
 * application, đổi lỗi nghiệp vụ thành popup cảnh báo, rồi sửa lại caption.
 *
 * Hợp đồng tương thích: hai mẫu callback_data `makeup_app_<id>` và
 * `makeup_rej_<id>` phải giữ nguyên — các tin nhắn CŨ trong nhóm vẫn mang nút
 * với đúng chuỗi này, đổi là những tin đó bấm không ăn nữa.
 */

import { SchedulingError } from '../../domain/makeup-rules.js';

/** Người bấm nút, gom lại để tầng application không phải biết cấu trúc ctx. */
const clickerOf = ctx => ({
    id: ctx.from.id.toString(),
    username: ctx.from.username,
    firstName: ctx.from.first_name
});

/**
 * Ghép kết quả vào caption cũ thay vì viết đè: quản lý vẫn đọc lại được toàn bộ
 * thông tin yêu cầu sau khi đã xử lý.
 */
function decorateCaption(originalCaption, { heading, roleLabel, reviewer, isSelfReview }) {
    // Đánh dấu tự duyệt: từ khi bỏ chốt cấm tự duyệt, đây là chỗ duy nhất nhìn ra
    // yêu cầu đã qua người thứ hai hay chưa.
    const note = isSelfReview ? ' <i>(tự duyệt)</i>' : '';
    return `${heading}\n\n${originalCaption}`
        + `\n\n👤 <b>${roleLabel}:</b> ${reviewer}${note}`
        + `\n⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`;
}

export function registerMakeupActions({ kpiComposer, reviewService }) {
    kpiComposer.action(/^makeup_app_(.+)$/, async (ctx) => {
        try {
            const { reviewer, isSelfReview } = await reviewService.approve({
                requestId: ctx.match[1],
                clicker: clickerOf(ctx)
            });

            await ctx.editMessageCaption(
                decorateCaption(ctx.callbackQuery.message.caption || '', {
                    heading: '✅ <b>ĐÃ DUYỆT CÔNG TOUR</b> ✅',
                    roleLabel: 'Người duyệt',
                    reviewer,
                    isSelfReview
                }),
                { parse_mode: 'HTML' }
            );
            await ctx.answerCbQuery('Đã duyệt yêu cầu báo công tour!');
        } catch (error) {
            if (error instanceof SchedulingError) {
                return ctx.answerCbQuery(error.message, { show_alert: true });
            }
            console.error('Lỗi khi duyệt yêu cầu báo bù:', error);
            await ctx.answerCbQuery('Có lỗi xảy ra khi xử lý duyệt!');
        }
    });

    kpiComposer.action(/^makeup_rej_(.+)$/, async (ctx) => {
        try {
            const { reviewer, isSelfReview } = await reviewService.reject({
                requestId: ctx.match[1],
                clicker: clickerOf(ctx)
            });

            await ctx.editMessageCaption(
                decorateCaption(ctx.callbackQuery.message.caption || '', {
                    heading: '❌ <b>ĐÃ TỪ CHỐI YÊU CẦU</b> ❌',
                    roleLabel: 'Người từ chối',
                    reviewer,
                    isSelfReview
                }),
                { parse_mode: 'HTML' }
            );
            await ctx.answerCbQuery('Đã từ chối yêu cầu báo công tour!');
        } catch (error) {
            if (error instanceof SchedulingError) {
                return ctx.answerCbQuery(error.message, { show_alert: true });
            }
            console.error('Lỗi khi từ chối yêu cầu báo bù:', error);
            await ctx.answerCbQuery('Có lỗi xảy ra khi xử lý từ chối!');
        }
    });
}

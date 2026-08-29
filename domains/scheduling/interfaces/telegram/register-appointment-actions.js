/**
 * Bốn nút trên tin nhắn lịch khách.
 *
 * ⚠️ `callback_data` là hợp đồng với các tin nhắn CŨ còn trong nhóm:
 *   arr_<id>                          Đã đến
 *   can_<id>                          Hủy → hiện danh sách lý do
 *   cr_<bom|ban|tien|khacspa|app>_<id> chọn lý do
 *   cr_back_<id>                      quay lại
 *
 * `cr_back_` phải đăng ký TRƯỚC `cr_(bom|ban|…)_` — nếu không, mẫu sau vẫn khớp
 * đúng vì `back` không nằm trong danh sách, nhưng giữ thứ tự này cho khỏi phải
 * suy luận lại mỗi lần đọc.
 */

import { CONFIRM_RESULT } from '../../application/confirm-arrival.js';
import {
    buildArrivedMessage,
    buildCancelledMessage,
    arrivalKeyboard,
    cancelReasonKeyboard,
    CANCEL_PROMPT,
    CANCEL_PROMPT_PLAIN
} from '../../domain/appointment-messages.js';

const DENIALS = {
    [CONFIRM_RESULT.NOT_FOUND]: 'Không tìm thấy lịch hẹn này!',
    arrived: 'Chỉ người đăng ký lịch này mới được ấn xác nhận Đã đến!',
    cancel: 'Chỉ người đăng ký lịch này mới được phép ấn Hủy lịch!'
};

export function registerAppointmentActions({ kpiComposer, confirmService }) {
    kpiComposer.action(/^arr_(\d+)$/, async (ctx) => {
        try {
            const id = ctx.match[1];
            const { result } = await confirmService.markArrived({ id, clickerId: ctx.from.id });

            if (result === CONFIRM_RESULT.NOT_FOUND) {
                return ctx.answerCbQuery(DENIALS[CONFIRM_RESULT.NOT_FOUND], { show_alert: true });
            }
            if (result === CONFIRM_RESULT.NOT_OWNER) {
                return ctx.answerCbQuery(DENIALS.arrived, { show_alert: true });
            }

            const original = ctx.callbackQuery.message.text || '';
            await ctx.editMessageText(buildArrivedMessage(original, id), {
                parse_mode: 'HTML',
                reply_markup: arrivalKeyboard(id, { withArrived: false })
            });
            await ctx.answerCbQuery('Đã cập nhật trạng thái: Đã đến!');
        } catch (e) {
            console.error('Lỗi nút Đã đến:', e);
            await ctx.answerCbQuery('Có lỗi xảy ra!');
        }
    });

    kpiComposer.action(/^can_(\d+)$/, async (ctx) => {
        try {
            const id = ctx.match[1];
            const { result } = await confirmService.askCancelReason({ id, clickerId: ctx.from.id });

            if (result === CONFIRM_RESULT.NOT_FOUND) {
                return ctx.answerCbQuery(DENIALS[CONFIRM_RESULT.NOT_FOUND], { show_alert: true });
            }
            if (result === CONFIRM_RESULT.NOT_OWNER) {
                return ctx.answerCbQuery(DENIALS.cancel, { show_alert: true });
            }

            const original = ctx.callbackQuery.message.text || '';
            await ctx.editMessageText(original + CANCEL_PROMPT, {
                parse_mode: 'HTML',
                reply_markup: cancelReasonKeyboard(id)
            });
            await ctx.answerCbQuery();
        } catch (e) {
            console.error('Lỗi nút Hủy:', e);
            await ctx.answerCbQuery('Có lỗi xảy ra!');
        }
    });

    kpiComposer.action(/^cr_back_(\d+)$/, async (ctx) => {
        try {
            const id = ctx.match[1];
            const original = (ctx.callbackQuery.message.text || '').replace(CANCEL_PROMPT_PLAIN, '');
            await ctx.editMessageText(original, { reply_markup: arrivalKeyboard(id) });
        } catch (e) {
            console.error('Lỗi nút Quay lại:', e);
        }
    });

    kpiComposer.action(/^cr_(bom|ban|tien|khacspa|app)_(\d+)$/, async (ctx) => {
        try {
            const [, type, id] = ctx.match;
            const outcome = await confirmService.cancelWithReason({ id, type });

            if (outcome.needsMiniApp) {
                return ctx.answerCbQuery('Vui lòng mở Hệ thống (Mini App) để gõ lý do khác nhé!', { show_alert: true });
            }

            const original = (ctx.callbackQuery.message.text || '').replace(CANCEL_PROMPT_PLAIN, '');
            await ctx.editMessageText(buildCancelledMessage(original, outcome.reason), { parse_mode: 'HTML' });
            await ctx.answerCbQuery('Đã cập nhật trạng thái: Đã hủy/ Rời lịch!');
        } catch (e) {
            console.error('Lỗi nút Lý do Hủy:', e);
            await ctx.answerCbQuery('Có lỗi xảy ra!');
        }
    });
}

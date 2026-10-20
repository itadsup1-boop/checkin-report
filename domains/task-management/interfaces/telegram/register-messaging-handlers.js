import { randomBytes } from 'node:crypto';
import { parseGuitinCommand } from '../../application/messaging-service.js';

const STATE_TTL_MS = 15 * 60 * 1000;

export function registerMessagingHandlers({ bot, messagingService, accessService, conversationRegistry = null }) {
    const isDm = (ctx) => ctx.chat?.type === 'private';
    const states = new Map(); // telegram_user_id -> { draftId, recipients, content, createdAt }

    const setState = (telegramUserId, state) => {
        conversationRegistry?.set(telegramUserId, 'message-state');
        return states.set(String(telegramUserId), { ...state, createdAt: Date.now() });
    };

    const takeState = (telegramUserId, draftId) => {
        const key = String(telegramUserId);
        const state = states.get(key);
        if (!state) return null;
        states.delete(key);
        conversationRegistry?.clear(key);
        if (Date.now() - state.createdAt > STATE_TTL_MS) return null;
        if (draftId && state.draftId !== draftId) return null;
        return state;
    };

    const dropState = (telegramUserId) => {
        const deleted = states.delete(String(telegramUserId));
        if (deleted) conversationRegistry?.clear(telegramUserId);
        return deleted;
    };

    const cbError = (ctx, error) =>
        ctx.answerCbQuery(error.message || 'Có lỗi xảy ra', { show_alert: true }).catch(() => {});

    const requirePermission = async (ctx, permission, permissionLabel) => {
        const manager = await accessService.getManager(ctx.from.id);
        if (!accessService.hasPermission(manager, permission)) {
            await ctx.reply(`❌ Bạn chưa được cấp quyền ${permissionLabel}. Nhờ admin cấp quyền phù hợp.`);
            return null;
        }
        return manager;
    };

    function buildPreviewText({ prepared, single }) {
        const lines = [
            single ? '📨 XÁC NHẬN GỬI TIN CÁ NHÂN' : '📣 XÁC NHẬN GỬI TIN HÀNG LOẠT',
            `👥 ${prepared.recipients.map(e => `${e.employee_code} — ${e.full_name}`).join(', ')}`
        ];
        if (prepared.unreachable.length) lines.push(`⚠️ Bỏ qua (không có Telegram): ${prepared.unreachable.join(', ')}`);
        if (prepared.missing.length) lines.push(`⚠️ Không tìm thấy: ${prepared.missing.join(', ')}`);
        if (prepared.duplicates.length) lines.push(`⚠️ Trùng người nhận (chỉ gửi 1 lần): ${prepared.duplicates.join(', ')}`);
        lines.push('', '💬 Nội dung:', prepared.content);
        return lines.join('\n');
    }

    async function handleGuitin(ctx, single) {
        if (!isDm(ctx)) return ctx.reply('❌ Lệnh gửi tin chỉ dùng trong tin nhắn riêng với bot.');
        const manager = await requirePermission(ctx,
            single ? 'messages.send_individual' : 'messages.send_bulk',
            single ? 'gửi tin cá nhân' : 'gửi tin hàng loạt');
        if (!manager) return undefined;

        const parsed = parseGuitinCommand(ctx.message?.text || '');
        if (parsed.error) return ctx.reply(`❌ ${parsed.error}`);
        if (single && parsed.codes.length > 1) {
            return ctx.reply('❌ /guitin chỉ gửi cho 1 mã nhân viên. Với danh sách nhiều người dùng /guitinall.');
        }

        try {
            const prepared = await messagingService.prepareMessage({
                managerId: String(ctx.from.id), codes: parsed.codes, text: parsed.content
            });
            const draftId = randomBytes(4).toString('hex');
            setState(ctx.from.id, { draftId, recipients: prepared.recipients, content: prepared.content });
            return ctx.reply(buildPreviewText({ prepared, single }), {
                reply_markup: { inline_keyboard: [[
                    { text: `📨 Gửi cho ${prepared.recipients.length} người`, callback_data: `msg:send:${draftId}` },
                    { text: '❌ Hủy', callback_data: `msg:no:${draftId}` }
                ]] }
            });
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    }

    bot.command('guitin', (ctx) => handleGuitin(ctx, true));
    bot.command('guitinall', (ctx) => handleGuitin(ctx, false));

    bot.command('huy', async (ctx, next) => {
        if (dropState(ctx.from.id)) {
            ctx.reply('Đã bỏ tin nhắn đang chờ gửi.').catch(() => {});
        }
        return next();
    });

    bot.action(/^msg:(send|no):([0-9a-f]+)$/, async (ctx) => {
        const [, choice, draftId] = ctx.match;
        const state = takeState(ctx.from.id, draftId);
        if (!state) {
            return ctx.answerCbQuery('Bản nháp không còn hiệu lực — gửi lại lệnh /guitin.', { show_alert: true }).catch(() => {});
        }
        if (choice === 'no') {
            await ctx.answerCbQuery('Đã hủy.').catch(() => {});
            return ctx.editMessageText('❌ Đã hủy gửi tin.').catch(() => {});
        }
        try {
            const { results } = await messagingService.confirmSend({
                managerId: String(ctx.from.id), recipients: state.recipients, text: state.content
            });
            await ctx.answerCbQuery('Đã gửi!').catch(() => {});
            return ctx.editMessageText(
                `✅ Đã đưa ${results.length} tin vào hàng gửi qua bot cho: ${results.map(r => r.employeeCode).join(', ')}.\n📋 Toàn bộ tin đã lưu nhật ký gửi.`
            ).catch(() => {});
        } catch (error) {
            return cbError(ctx, error);
        }
    });
}

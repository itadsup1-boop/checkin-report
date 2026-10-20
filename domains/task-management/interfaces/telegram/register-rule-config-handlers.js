// Cấu hình rule theo mục 29: /cauhinh xem + đổi ngưỡng, /tamdung //chohay
// tạm dừng/tiếp tục automation của riêng người điều hành. Mỗi quản lý chỉ tác
// động đến nhắc việc của chính mình.

export function registerRuleConfigHandlers({ bot, ruleConfigService, accessService }) {
    const isDm = (ctx) => ctx.chat?.type === 'private';

    const requireManager = async (ctx) => {
        const manager = await accessService.getManager(ctx.from.id);
        if (!manager || manager.status !== 'ACTIVE') {
            await ctx.reply('❌ Bạn chưa có tài khoản quản lý đang hoạt động. Nhờ admin cấp mã (/kichhoat).');
            return null;
        }
        return manager;
    };

    bot.command('cauhinh', async (ctx) => {
        if (!isDm(ctx)) return ctx.reply('❌ Lệnh cấu hình chỉ dùng trong tin nhắn riêng với bot.');
        const manager = await requireManager(ctx);
        if (!manager) return undefined;

        const body = String(ctx.message?.text || '').replace(/^\/cauhinh\s*/i, '').trim();
        try {
            if (!body) {
                const { text } = await ruleConfigService.describeConfig(String(ctx.from.id));
                return ctx.reply(text);
            }
            const [rawKey, rawValue, ...rest] = body.split(/\s+/);
            if (!rawValue || rest.length) {
                return ctx.reply('❌ Cú pháp: /cauhinh <trường> <số> — ví dụ /cauhinh due 45. Gõ /cauhinh để xem tất cả.');
            }
            await ruleConfigService.applyRuleConfig(String(ctx.from.id), rawKey, rawValue);
            const field = ruleConfigService.resolveRuleField(rawKey);
            const unit = field.endsWith('_hours') ? 'giờ' : 'phút';
            return ctx.reply(`✅ Đã lưu ${field.replace(/_/g, ' ')} = ${rawValue} ${unit}. Gõ /cauhinh để xem lại toàn bộ.`);
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    });

    bot.command('tamdung', async (ctx) => {
        if (!isDm(ctx)) return ctx.reply('❌ Lệnh này chỉ dùng trong tin nhắn riêng với bot.');
        const manager = await requireManager(ctx);
        if (!manager) return undefined;
        await ruleConfigService.togglePaused(String(ctx.from.id), true);
        return ctx.reply('⏸️ Đã TẠM DỪNG toàn bộ automation nhắc việc của bạn: không nhắc nhân viên, không cảnh báo cho bạn — đến khi gõ /chohay.');
    });

    bot.command('chohay', async (ctx) => {
        if (!isDm(ctx)) return ctx.reply('❌ Lệnh này chỉ dùng trong tin nhắn riêng với bot.');
        const manager = await requireManager(ctx);
        if (!manager) return undefined;
        await ruleConfigService.togglePaused(String(ctx.from.id), false);
        return ctx.reply('▶️ Đã tiếp tục automation nhắc việc của bạn. Các nhắc đang dở sẽ chạy lại theo ngưỡng đã cấu hình.');
    });
}

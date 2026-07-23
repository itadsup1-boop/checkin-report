import pool from '../../packages/database/index.js';

/**
 * Lấy role của nhóm dựa trên chat ID
 * @param {string|number} chatId ID của nhóm Telegram
 * @returns {Promise<string|null>} bot_role ('report', 'timekeep', hoặc rỗng/null nếu không set)
 */
export async function getGroupRole(chatId) {
    const result = await pool.query(
        `SELECT bot_role
         FROM telegram_groups
         WHERE telegram_group_id = $1
           AND is_active = true
           AND COALESCE(is_deleted, false) = false`,
        [String(chatId)]
    );

    return result.rows[0]?.bot_role || null;
}

/**
 * Kiểm tra xem nhóm có đúng role yêu cầu không
 * @param {object} ctx Context của Telegraf
 * @param {string} requiredRole Role yêu cầu ('report' hoặc 'timekeep')
 * @returns {Promise<boolean>} true nếu đúng role, false nếu sai role
 */
export async function requireGroupRole(ctx, requiredRole) {
    if (!ctx.chat || ctx.chat.type === 'private') {
        return true; 
    }

    const role = await getGroupRole(ctx.chat.id);

    if (role !== requiredRole) {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery(
                'Chức năng này không được bật trong nhóm này.',
                { show_alert: true }
            ).catch(() => {});
        } else {
            await ctx.reply('⚠️ Nhóm này chưa được cấu hình chức năng này. Vui lòng liên hệ Admin để cài đặt Vai trò của Bot.').catch(() => {});
        }
        return false;
    }

    return true;
}

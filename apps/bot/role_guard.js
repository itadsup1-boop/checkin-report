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
            // Chỉ gửi cảnh báo nếu người dùng chủ động gõ lệnh (/ hoặc #)
            const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
            const isExplicitCommand = text.startsWith('/') || text.startsWith('#');
            if (isExplicitCommand) {
                await ctx.reply('⚠️ Nhóm này chưa được cấu hình chức năng này. Vui lòng liên hệ Admin để cài đặt Vai trò của Bot.').catch(() => {});
            }
        }
        return false;
    }

    return true;
}

/**
 * Gửi tin nhắn Telegram chỉ khi nhóm khớp role và active
 * @param {object} bot Telegram Bot instance (Telegraf or bot.telegram)
 * @param {string|number} groupId ID nhóm Telegram
 * @param {string} requiredRole Role yêu cầu ('report' hoặc 'timekeep')
 * @param {string} message Nội dung tin nhắn
 * @param {object} [options] Các tùy chọn khác (parse_mode, reply_to_message_id, ...)
 * @param {string} [source='unknown'] Tên nguồn gọi để ghi log
 * @returns {Promise<object|null>} Trả về message object nếu gửi thành công, hoặc null nếu bị chặn/lỗi
 */
export async function sendMessageToRoleGroup(bot, groupId, requiredRole, message, options = {}, source = 'unknown') {
    if (!groupId) {
        console.warn(`[Telegram Send] source=${source} group_id=null required_role=${requiredRole} status=blocked reason=no_group_id`);
        return null;
    }

    const strGroupId = String(groupId);
    const actualRole = await getGroupRole(strGroupId);

    if (!actualRole) {
        console.warn(`[Telegram Send] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=none status=blocked reason=group_not_found_or_inactive`);
        return null;
    }

    if (actualRole !== requiredRole) {
        console.warn(`[Telegram Send] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=${actualRole} status=blocked reason=role_mismatch`);
        return null;
    }

    try {
        const tg = bot.telegram || bot;
        const res = await tg.sendMessage(strGroupId, message, options);
        console.log(`[Telegram Send] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=${actualRole} status=sent`);
        return res;
    } catch (err) {
        console.error(`[Telegram Send] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=${actualRole} status=failed error=${err.message}`);
        return null;
    }
}

/**
 * Gửi ảnh Telegram chỉ khi nhóm khớp role và active
 */
export async function sendPhotoToRoleGroup(bot, groupId, requiredRole, photo, options = {}, source = 'unknown') {
    if (!groupId) {
        console.warn(`[Telegram Send Photo] source=${source} group_id=null required_role=${requiredRole} status=blocked reason=no_group_id`);
        return null;
    }

    const strGroupId = String(groupId);
    const actualRole = await getGroupRole(strGroupId);

    if (!actualRole) {
        console.warn(`[Telegram Send Photo] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=none status=blocked reason=group_not_found_or_inactive`);
        return null;
    }

    if (actualRole !== requiredRole) {
        console.warn(`[Telegram Send Photo] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=${actualRole} status=blocked reason=role_mismatch`);
        return null;
    }

    try {
        const tg = bot.telegram || bot;
        const res = await tg.sendPhoto(strGroupId, photo, options);
        console.log(`[Telegram Send Photo] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=${actualRole} status=sent`);
        return res;
    } catch (err) {
        console.error(`[Telegram Send Photo] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=${actualRole} status=failed error=${err.message}`);
        return null;
    }
}

/**
 * Gửi MediaGroup Telegram chỉ khi nhóm khớp role và active
 */
export async function sendMediaGroupToRoleGroup(bot, groupId, requiredRole, mediaGroup, options = {}, source = 'unknown') {
    if (!groupId) {
        console.warn(`[Telegram Send MediaGroup] source=${source} group_id=null required_role=${requiredRole} status=blocked reason=no_group_id`);
        return null;
    }

    const strGroupId = String(groupId);
    const actualRole = await getGroupRole(strGroupId);

    if (!actualRole) {
        console.warn(`[Telegram Send MediaGroup] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=none status=blocked reason=group_not_found_or_inactive`);
        return null;
    }

    if (actualRole !== requiredRole) {
        console.warn(`[Telegram Send MediaGroup] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=${actualRole} status=blocked reason=role_mismatch`);
        return null;
    }

    try {
        const tg = bot.telegram || bot;
        const res = await tg.sendMediaGroup(strGroupId, mediaGroup, options);
        console.log(`[Telegram Send MediaGroup] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=${actualRole} status=sent`);
        return res;
    } catch (err) {
        console.error(`[Telegram Send MediaGroup] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=${actualRole} status=failed error=${err.message}`);
        return null;
    }
}

/**
 * Gửi Video Telegram chỉ khi nhóm khớp role và active
 */
export async function sendVideoToRoleGroup(bot, groupId, requiredRole, video, options = {}, source = 'unknown') {
    if (!groupId) {
        console.warn(`[Telegram Send Video] source=${source} group_id=null required_role=${requiredRole} status=blocked reason=no_group_id`);
        return null;
    }

    const strGroupId = String(groupId);
    const actualRole = await getGroupRole(strGroupId);

    if (!actualRole) {
        console.warn(`[Telegram Send Video] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=none status=blocked reason=group_not_found_or_inactive`);
        return null;
    }

    if (actualRole !== requiredRole) {
        console.warn(`[Telegram Send Video] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=${actualRole} status=blocked reason=role_mismatch`);
        return null;
    }

    try {
        const tg = bot.telegram || bot;
        const res = await tg.sendVideo(strGroupId, video, options);
        console.log(`[Telegram Send Video] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=${actualRole} status=sent`);
        return res;
    } catch (err) {
        console.error(`[Telegram Send Video] source=${source} group_id=${strGroupId} required_role=${requiredRole} actual_role=${actualRole} status=failed error=${err.message}`);
        return null;
    }
}

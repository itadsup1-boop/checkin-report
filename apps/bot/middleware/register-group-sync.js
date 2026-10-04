export function registerGroupSyncMiddleware({ bot, pool }) {
    // Tự động kiểm tra và lưu nhóm vào DB mỗi khi có tương tác từ nhóm
    bot.use(async (ctx, next) => {
        if (ctx.chat && ['group', 'supergroup'].includes(ctx.chat.type)) {
            const groupId = ctx.chat.id.toString();
            const groupName = ctx.chat.title || `Group ${groupId}`;
            pool.query(
                `INSERT INTO telegram_groups (telegram_group_id, group_name, is_active, is_deleted)
                 VALUES ($1, $2, true, false)
                 ON CONFLICT (telegram_group_id) DO UPDATE SET group_name = EXCLUDED.group_name, is_active = true, is_deleted = false`,
                [groupId, groupName]
            ).then(() => {
                return pool.query(
                    `INSERT INTO group_settings (telegram_group_id) VALUES ($1) ON CONFLICT (telegram_group_id) DO NOTHING`,
                    [groupId]
                );
            }).catch(err => {
                console.error('[Auto Sync Group Middleware Error]', err.message);
            });
        }
        return next();
    });
}

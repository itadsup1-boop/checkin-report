export async function syncGroupsOnStartup({ bot, pool }) {
    try {
        console.log('[Startup Sync] Đang kiểm tra và bổ sung các nhóm còn thiếu vào DB...');
        const missingFromDb = await pool.query(`
            SELECT DISTINCT telegram_group_id
            FROM (
                SELECT telegram_group_id FROM employees WHERE telegram_group_id IS NOT NULL AND telegram_group_id != ''
                UNION
                SELECT telegram_group_id FROM kpi_policies WHERE telegram_group_id IS NOT NULL AND telegram_group_id != ''
                UNION
                SELECT telegram_group_id FROM daily_reports WHERE telegram_group_id IS NOT NULL AND telegram_group_id != ''
                UNION
                SELECT telegram_group_id FROM penalty_records WHERE telegram_group_id IS NOT NULL AND telegram_group_id != ''
                UNION
                SELECT telegram_group_id FROM reminder_logs WHERE telegram_group_id IS NOT NULL AND telegram_group_id != ''
                UNION
                SELECT telegram_group_id FROM group_settings WHERE telegram_group_id IS NOT NULL AND telegram_group_id != ''
            ) AS referenced_groups
            WHERE telegram_group_id NOT IN (SELECT telegram_group_id FROM telegram_groups)
        `);

        for (const row of missingFromDb.rows) {
            const groupId = row.telegram_group_id;
            await pool.query(
                `INSERT INTO telegram_groups (telegram_group_id, group_name, is_active, is_deleted)
                 VALUES ($1, $2, true, false) ON CONFLICT (telegram_group_id) DO NOTHING`,
                [groupId, `Group ${groupId}`]
            );
            await pool.query(
                'INSERT INTO group_settings (telegram_group_id) VALUES ($1) ON CONFLICT (telegram_group_id) DO NOTHING',
                [groupId]
            );
            console.log(`[Startup Sync] Đã bổ sung nhóm từ dữ liệu DB: ${groupId}`);
        }

        const allGroups = await pool.query(`
            SELECT telegram_group_id, group_name
            FROM telegram_groups
            WHERE COALESCE(is_deleted, false) = false
        `);
        let syncedCount = 0;
        for (const group of allGroups.rows) {
            const groupId = group.telegram_group_id;
            try {
                const chatInfo = await bot.telegram.getChat(groupId);
                if (chatInfo?.title) {
                    await pool.query(
                        'UPDATE telegram_groups SET group_name = $1, is_active = true WHERE telegram_group_id = $2',
                        [chatInfo.title, groupId]
                    );
                    await pool.query(
                        'INSERT INTO group_settings (telegram_group_id) VALUES ($1) ON CONFLICT (telegram_group_id) DO NOTHING',
                        [groupId]
                    );
                    syncedCount += 1;
                }
            } catch (error) {
                if (error.message?.includes('chat not found') || error.message?.includes('bot was kicked')) {
                    await pool.query('UPDATE telegram_groups SET is_active = false WHERE telegram_group_id = $1', [groupId]);
                }
            }
        }
        console.log(`[Startup Sync] Đã đồng bộ ${syncedCount}/${allGroups.rows.length} nhóm với Telegram.`);
    } catch (error) {
        console.error('[Startup Sync Error]', error.message);
    }
}

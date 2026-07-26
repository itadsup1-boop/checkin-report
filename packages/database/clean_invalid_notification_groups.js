import pool from './index.js';

export async function cleanInvalidNotificationGroups() {
    console.log('[Migration] Checking for invalid schedule_notification_groups mappings...');
    try {
        const invalidRes = await pool.query(`
            SELECT s.group_id, tg.group_name, tg.bot_role, tg.is_active, tg.is_deleted
            FROM schedule_notification_groups s
            LEFT JOIN telegram_groups tg ON tg.telegram_group_id = s.group_id
            WHERE tg.telegram_group_id IS NULL
               OR tg.bot_role <> 'report'
               OR tg.is_active = false
               OR COALESCE(tg.is_deleted, false) = true
        `);

        if (invalidRes.rows.length > 0) {
            console.log('[Migration] Found invalid mappings to remove:', invalidRes.rows);
            const delRes = await pool.query(`
                DELETE FROM schedule_notification_groups
                WHERE group_id IN (
                    SELECT s.group_id
                    FROM schedule_notification_groups s
                    LEFT JOIN telegram_groups tg ON tg.telegram_group_id = s.group_id
                    WHERE tg.telegram_group_id IS NULL
                       OR tg.bot_role <> 'report'
                       OR tg.is_active = false
                       OR COALESCE(tg.is_deleted, false) = true
                )
            `);
            console.log(`[Migration] Cleaned invalid mappings. Deleted count: ${delRes.rowCount}`);
        } else {
            console.log('[Migration] No invalid schedule_notification_groups mappings found.');
        }
    } catch (err) {
        console.error('[Migration Error] Failed to clean invalid notification groups:', err.message);
    }
}

// Run directly if called as a script
if (process.argv[1] && (process.argv[1].endsWith('clean_invalid_notification_groups.js') || process.argv[1].includes('clean_invalid_notification_groups'))) {
    cleanInvalidNotificationGroups().then(() => process.exit(0));
}

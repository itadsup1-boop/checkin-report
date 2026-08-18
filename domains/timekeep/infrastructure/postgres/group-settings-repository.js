/**
 * SQL của cấu hình nhóm: `telegram_groups` (vai trò bot, mã Sheet, Drive) và
 * `group_settings` (mức phạt, giờ ca, giờ nhắc).
 */

export function createGroupSettingsRepository({ pool }) {
    /**
     * Ghi vai trò bot và các mã Sheet/Drive.
     *
     * `COALESCE(EXCLUDED.x, cũ)` là có chủ đích: Web Admin gửi lên form từng phần,
     * trường nào không gửi thì phải GIỮ giá trị cũ, không được xoá về NULL.
     */
    async function upsertGroup(telegramGroupId, values) {
        await pool.query(
            `INSERT INTO telegram_groups
                (telegram_group_id, group_name, bot_role, schedule_registration_open,
                 kpi_sheet_id, customer_sheet_id, customer_drive_folder_id)
             VALUES ($1, $2, $3, COALESCE($4, true), $5, $6, $7)
             ON CONFLICT (telegram_group_id) DO UPDATE SET
                bot_role = EXCLUDED.bot_role,
                schedule_registration_open = COALESCE($4, telegram_groups.schedule_registration_open),
                kpi_sheet_id = COALESCE(EXCLUDED.kpi_sheet_id, telegram_groups.kpi_sheet_id),
                customer_sheet_id = COALESCE(EXCLUDED.customer_sheet_id, telegram_groups.customer_sheet_id),
                customer_drive_folder_id = COALESCE(EXCLUDED.customer_drive_folder_id, telegram_groups.customer_drive_folder_id)`,
            [
                telegramGroupId,
                `Group ${telegramGroupId}`,
                values.botRole || null,
                values.scheduleRegistrationOpen,
                values.kpiSheetId,
                values.customerSheetId,
                values.customerDriveFolderId || null
            ]
        );
    }

    async function hasSettings(telegramGroupId) {
        const result = await pool.query(
            'SELECT id FROM group_settings WHERE telegram_group_id = $1',
            [telegramGroupId]
        );
        return result.rows.length > 0;
    }

    /** Bản ghi đã có: chỉ sửa mức phạt và giờ ca, không đụng các cột còn lại. */
    async function updateSettings(telegramGroupId, values) {
        await pool.query(
            `UPDATE group_settings SET
                penalty_under_15 = $1,
                penalty_under_90 = $2,
                penalty_over_90 = $3,
                shift_1_time = $4,
                shift_2_time = $5,
                auto_reminder_enabled = $6
             WHERE telegram_group_id = $7`,
            [
                values.penaltyUnder15, values.penaltyUnder90, values.penaltyOver90,
                values.shift1Time, values.shift2Time, values.autoReminderEnabled,
                telegramGroupId
            ]
        );
    }

    async function insertSettings(telegramGroupId, values) {
        await pool.query(
            `INSERT INTO group_settings
                (telegram_group_id, remind_time_1, auto_reminder_enabled,
                 photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo,
                 penalty_missing_report, shift_1_time, shift_2_time)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                telegramGroupId, values.remindTime1, values.autoReminderEnabled,
                values.photoDeadlineMinutes, values.penaltyMissingKpi, values.penaltyPerPhoto,
                values.penaltyMissingReport, values.shift1Time, values.shift2Time
            ]
        );
    }

    return { upsertGroup, hasSettings, updateSettings, insertSettings };
}

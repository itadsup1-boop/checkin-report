/**
 * Use case: lưu cấu hình một nhóm từ Web Admin.
 *
 * Ghi vào HAI bảng: `telegram_groups` (vai trò bot, mã Sheet, Drive) và
 * `group_settings` (mức phạt, giờ ca). Bảng thứ hai chưa có dòng thì tạo mới.
 */

import { extractSheetId } from '../domain/timekeep-rules.js';

/** Giá trị mặc định giữ đúng bản cũ — đổi là đổi mức phạt của nhóm mới. */
const DEFAULTS = {
    remind_time_1: '17:00:00',
    photo_deadline_minutes: 60,
    penalty_missing_kpi: 100000,
    penalty_per_photo: 20000,
    penalty_missing_report: 100000,
    auto_reminder_enabled: true
};

/**
 * Chỉ lấy mặc định khi trường VẮNG MẶT, không lấy khi trường bằng null.
 * Bản cũ dùng giá trị mặc định của phép destructuring, vốn hành xử đúng như vậy;
 * dùng `??` sẽ nuốt mất giá trị null mà Web Admin cố tình gửi lên.
 */
const orDefault = (value, fallback) => (value === undefined ? fallback : value);

export function createSaveGroupSettings({ repository }) {
    return async function saveGroupSettings(telegramGroupId, body) {
        const values = {
            botRole: body.bot_role,
            scheduleRegistrationOpen: body.schedule_registration_open,
            kpiSheetId: extractSheetId(body.kpi_sheet_id),
            customerSheetId: extractSheetId(body.customer_sheet_id),
            pricingSheetId: extractSheetId(body.pricing_sheet_id),
            customerDriveFolderId: body.customer_drive_folder_id,

            penaltyUnder15: body.penalty_under_15,
            penaltyUnder90: body.penalty_under_90,
            penaltyOver90: body.penalty_over_90,
            shift1Time: body.shift_1_time,
            shift2Time: body.shift_2_time,
            autoReminderEnabled: orDefault(body.auto_reminder_enabled, DEFAULTS.auto_reminder_enabled),

            remindTime1: orDefault(body.remind_time_1, DEFAULTS.remind_time_1),
            photoDeadlineMinutes: orDefault(body.photo_deadline_minutes, DEFAULTS.photo_deadline_minutes),
            penaltyMissingKpi: orDefault(body.penalty_missing_kpi, DEFAULTS.penalty_missing_kpi),
            penaltyPerPhoto: orDefault(body.penalty_per_photo, DEFAULTS.penalty_per_photo),
            penaltyMissingReport: orDefault(body.penalty_missing_report, DEFAULTS.penalty_missing_report)
        };

        await repository.upsertGroup(telegramGroupId, values);

        if (await repository.hasSettings(telegramGroupId)) {
            await repository.updateSettings(telegramGroupId, values);
        } else {
            await repository.insertSettings(telegramGroupId, values);
        }
    };
}

export { DEFAULTS as GROUP_SETTINGS_DEFAULTS };

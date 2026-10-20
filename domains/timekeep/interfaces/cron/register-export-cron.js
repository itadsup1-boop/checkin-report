/**
 * Lịch chạy nền của chấm công.
 *
 * 23:00 mỗi ngày — xuất chấm công trong ngày sang Google Sheet.
 * Giờ máy chủ, không đặt timezone: giữ đúng bản cũ.
 */

export const DAILY_EXPORT_CRON = '0 23 * * *';

export function registerTimekeepCrons({ cron, exportDailySheet }) {
    return [cron.schedule(DAILY_EXPORT_CRON, exportDailySheet)];
}

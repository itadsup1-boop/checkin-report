/**
 * Đăng ký cron job tự động cho module Telesale:
 * - 18:00: Nhắc nộp báo cáo kèm nút bấm Mini App 10s.
 * - 19:00: Quét hạn chót, kiểm tra lịch OFF, phạt 50k & gửi tổng kết ngày toàn đội.
 */

export const TELESALE_CRONS = {
    REMINDER_18H: '0 18 * * *',
    DEADLINE_19H: '0 19 * * *'
};

export function registerTelesaleCrons({
    cron,
    sendTelesaleReminder,
    scanTelesaleDeadline,
    summarizeDailyTelesale
}) {
    if (!cron) return [];

    const reminderJob = cron.schedule(TELESALE_CRONS.REMINDER_18H, async () => {
        console.log('[Telesale Cron] Kích hoạt nhắc nộp báo cáo lúc 18:00...');
        await sendTelesaleReminder();
    });

    const deadlineJob = cron.schedule(TELESALE_CRONS.DEADLINE_19H, async () => {
        console.log('[Telesale Cron] Kích hoạt quét hạn chót 19:00 và tổng kết ngày...');
        await scanTelesaleDeadline();
        await summarizeDailyTelesale();
    });

    return [reminderJob, deadlineJob];
}

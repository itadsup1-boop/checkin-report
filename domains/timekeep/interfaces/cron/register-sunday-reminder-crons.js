/**
 * 5 mốc giờ Chủ Nhật nhắc đăng ký lịch tuần — giờ máy chủ Asia/Ho_Chi_Minh.
 */
export const SUNDAY_REMINDER_CRONS = {
    GENERAL_17: '0 17 * * 0',
    GENERAL_18: '0 18 * * 0',
    TARGETED_19: '0 19 * * 0',
    TARGETED_1950: '50 19 * * 0',
    AUTO_SET_2000: '0 20 * * 0'
};

export function registerSundayReminderCrons({ cron, sendSundayScheduleReminder }) {
    const options = { scheduled: true, timezone: 'Asia/Ho_Chi_Minh' };
    return [
        cron.schedule(SUNDAY_REMINDER_CRONS.GENERAL_17, () => sendSundayScheduleReminder('general_17'), options),
        cron.schedule(SUNDAY_REMINDER_CRONS.GENERAL_18, () => sendSundayScheduleReminder('general_18'), options),
        cron.schedule(SUNDAY_REMINDER_CRONS.TARGETED_19, () => sendSundayScheduleReminder('targeted_19'), options),
        cron.schedule(SUNDAY_REMINDER_CRONS.TARGETED_1950, () => sendSundayScheduleReminder('targeted_1950'), options),
        cron.schedule(SUNDAY_REMINDER_CRONS.AUTO_SET_2000, () => sendSundayScheduleReminder('auto_set_2000'), options)
    ];
}

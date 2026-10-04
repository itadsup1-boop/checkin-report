/**
 * Lịch chạy nền của lịch khách. Giờ máy chủ.
 *
 * 20:02 cố ý lệch 2 phút khỏi đầu giờ để không đụng các cron khác cùng chạy
 * lúc 20:00.
 */

export const SCHEDULE_CRONS = {
    TOMORROW_REPORT: '2 20 * * *',
    DAILY_SUMMARY: '0 22 * * *',
    TOUR_WORK_SUMMARY: '0 0 * * *',
    DUE_REMINDER: '* * * * *'
};

export function registerScheduleCrons({ cron, reportService, remindDueAppointments }) {
    return [
        cron.schedule(SCHEDULE_CRONS.TOMORROW_REPORT, reportService.reportTomorrow),
        cron.schedule(SCHEDULE_CRONS.DAILY_SUMMARY, reportService.reportToday),
        cron.schedule(SCHEDULE_CRONS.TOUR_WORK_SUMMARY, reportService.summarizeTourWork),
        cron.schedule(SCHEDULE_CRONS.DUE_REMINDER, remindDueAppointments)
    ];
}

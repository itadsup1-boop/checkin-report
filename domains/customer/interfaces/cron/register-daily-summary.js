/**
 * Lịch chạy tổng kết khách hàng: 22:00 mỗi ngày, giờ máy chủ.
 */

const DAILY_SUMMARY_CRON = '0 22 * * *';

export function registerCustomerDailySummary({ cron, summarizeDailyCustomers }) {
    return cron.schedule(DAILY_SUMMARY_CRON, summarizeDailyCustomers);
}

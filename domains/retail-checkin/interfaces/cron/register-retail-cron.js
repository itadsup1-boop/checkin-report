/**
 * Đặt lịch tự động nhắc nhở (16:00) và chốt tổng kết cuối ngày (18:00) cho module Retail Check-in.
 */

export function registerRetailCron({ cron, sendProgressReminders, summarizeDailyKpi }) {
    if (!cron || typeof cron.schedule !== 'function') {
        console.warn('[Retail Cron] Không tìm thấy module node-cron, bỏ qua lập lịch tự động.');
        return;
    }

    // 1. Nhắc nhở tiến độ lúc 16:00 từ Thứ Hai đến Thứ Bảy
    cron.schedule('0 16 * * 1-6', async () => {
        try {
            console.log('[Retail Cron] Đang chạy nhắc nhở tiến độ 16:00...');
            await sendProgressReminders();
        } catch (e) {
            console.error('[Retail Cron 16:00 Error]:', e);
        }
    }, {
        timezone: 'Asia/Ho_Chi_Minh'
    });

    // 2. Chốt sổ và gửi tổng kết ngày lúc 18:00 từ Thứ Hai đến Thứ Bảy
    cron.schedule('0 18 * * 1-6', async () => {
        try {
            console.log('[Retail Cron] Đang chạy chốt sổ KPI 18:00...');
            await summarizeDailyKpi();
        } catch (e) {
            console.error('[Retail Cron 18:00 Error]:', e);
        }
    }, {
        timezone: 'Asia/Ho_Chi_Minh'
    });

    console.log('[Retail Cron] Đã kích hoạt lịch tự động 16:00 (nhắc nhở) và 18:00 (chốt sổ).');
}

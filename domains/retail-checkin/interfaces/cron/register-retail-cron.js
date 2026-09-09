/**
 * Đặt lịch tự động nhắc nhở và chốt sổ cho module Retail Check-in.
 *
 * Thay vì dùng cron cố định, hệ thống chạy 1 cron mỗi phút và tự tính
 * các mốc nhắc dựa theo shift_end_time của từng nhóm:
 *   shift_end - 2h   → nhắc nhở tiến độ
 *   shift_end - 1h   → nhắc nhở tiến độ
 *   shift_end - 30p  → nhắc nhở tiến độ
 *   shift_end - 10p  → nhắc nhở tiến độ
 *   shift_end + 1p   → chốt sổ cuối ngày (isFinal)
 *
 * Chạy từ Thứ Hai đến Thứ Bảy, múi giờ Asia/Ho_Chi_Minh.
 */

/**
 * Tính danh sách các mốc giờ nhắc (HH:MM) từ giờ kết thúc ca.
 * @param {string} shiftEndStr - VD "18:00" hoặc "18:00:00"
 * @returns {{ time: string, isFinal: boolean }[]}
 */
function computeReminderWindows(shiftEndStr) {
    const [hStr, mStr] = shiftEndStr.split(':');
    const endMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);

    const offsets = [
        { delta: -60, type: 'one_hour_warning', isFinal: false }
    ];

    return offsets.map(({ delta, type, isFinal }) => {
        const total = (endMinutes + delta + 1440) % 1440;
        const h = Math.floor(total / 60);
        const m = total % 60;
        const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        return { time, type, isFinal };
    });
}

export function registerRetailCron({ cron, sendProgressReminders, summarizeDailyKpi, repository }) {
    if (!cron || typeof cron.schedule !== 'function') {
        console.warn('[Retail Cron] Không tìm thấy module node-cron, bỏ qua lập lịch tự động.');
        return;
    }

    const cronSchedulePattern = process.env.ALLOW_SUNDAY_RETAIL_CHECKIN === 'true'
        ? '* * * * *'
        : '* * * * 1-6';

    // Cron chạy mỗi phút kiểm tra lịch nhắc của từng nhóm và mốc chốt sổ 20:00
    cron.schedule(cronSchedulePattern, async () => {
        try {
            const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
            const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

            // 1. Mốc 20:00 (8h tối): Chốt sổ toàn diện, cập nhật DB, Google Sheet và gửi báo cáo Telegram
            if (currentTime === '20:00') {
                console.log(`[Retail Cron] 20:00 — Chốt sổ KPI ngày, cập nhật Database, Google Sheet và gửi báo cáo nhóm.`);
                if (typeof summarizeDailyKpi === 'function') {
                    await summarizeDailyKpi();
                }
            }

            // 2. Kiểm tra các mốc nhắc nhở tiến độ (VD: 1 tiếng trước hết ca)
            const retailGroups = await repository.findRetailGroups();
            if (!retailGroups || retailGroups.length === 0) return;

            for (const group of retailGroups) {
                const shiftEnd = (group.shift_end_time || '18:00').slice(0, 5);
                const windows = computeReminderWindows(shiftEnd);
                const matched = windows.find(w => w.time === currentTime);

                if (!matched) continue;

                const label = matched.type === 'one_hour_warning'
                    ? `thống kê trước khi hết ca 1 tiếng (${currentTime})`
                    : matched.isFinal
                    ? `chốt sổ (${currentTime})`
                    : `nhắc nhở tiến độ (${currentTime})`;
                console.log(`[Retail Cron] ${label} — nhóm ${group.group_name}`);

                await sendProgressReminders({
                    isFinal: matched.isFinal,
                    type: matched.type,
                    targetGroupId: group.telegram_group_id
                });
            }
        } catch (e) {
            console.error('[Retail Cron Error]:', e);
        }
    }, { timezone: 'Asia/Ho_Chi_Minh' });

    console.log('[Retail Cron] Đã kích hoạt cron động mỗi phút — lịch nhắc 1h trước hết ca và chốt sổ lúc 20:00.');
}


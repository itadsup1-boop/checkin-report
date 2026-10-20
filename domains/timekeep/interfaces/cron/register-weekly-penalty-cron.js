/**
 * Cron tổng kết phạt chấm công hàng tuần: tối Chủ nhật 20:05 → 23:59, mỗi phút
 * kiểm tra một lần. Nhờ khóa dedup trong DB nên dù bot khởi động lại giữa chừng
 * hay cron chạy trùng, mỗi tuần mỗi nhóm vẫn chỉ nhận đúng 1 tin.
 *
 * Công ty làm cả Chủ nhật nên tuần tính Thứ Hai → Chủ nhật, và tổng kết ngay
 * tối Chủ nhật khi dữ liệu trong tuần đã chốt đủ.
 */
export function registerWeeklyPenaltyCron({ cron, runWeeklyPenaltySummary, moment }) {
    return cron.schedule('*/1 * * * *', async () => {
        try {
            const nowVN = moment().utcOffset(7);
            if (nowVN.day() !== 0) return;

            const currentTimeStr = nowVN.format('HH:mm');
            if (currentTimeStr < '20:05' || currentTimeStr > '23:59') return;

            await runWeeklyPenaltySummary(nowVN);
        } catch (error) {
            console.error('[Weekly Penalty Summary Cron Error]:', error);
        }
    });
}

/**
 * Use case: xuất dữ liệu chấm công trong ngày sang Google Sheet (cron 23:00).
 *
 * ⚠️ LỖI CÓ SẴN, GIỮ NGUYÊN KHI TÁCH: dòng "Schedule" bên dưới đọc biến `r` chưa
 * được khai báo — bản cũ thiếu vòng lặp `settings.forEach(r => ...)`. Vì vậy hàm
 * này ném ReferenceError ngay dòng đầu và **chưa từng ghi được gì lên Sheet**;
 * log mỗi đêm hiện "[Cron] Error during daily export".
 *
 * Không sửa ở đợt tách này là có chủ đích: sửa xong thì bản xuất sẽ BẮT ĐẦU ghi
 * đè vùng `DailyExport!A1` trên bảng tính thật — đó là đổi hành vi, cần chủ hệ
 * thống quyết. Xem mục "Lỗi có sẵn" trong README.
 */

export function createExportDailySheet({ repository, sheetWriter }) {
    return async function exportDailySheet() {
        try {
            console.log('[Cron] Starting daily export to Google Spreadsheet');
            const today = new Date();
            const dateStr = today.toISOString().slice(0, 10);
            const data = await repository.exportRowsOfDay(dateStr);

            const rows = [];
            rows.push(['Type', 'Group ID', 'User ID', 'Date', 'Details']);
            rows.push(['Schedule', r.telegram_group_id, '', r.date, JSON.stringify(r)]);

            data.checkins.forEach(r => {
                rows.push(['Checkin', r.group_id, r.user_id, r.date, `Video: ${r.video_file_id}`]);
            });
            data.penalties.forEach(r => {
                rows.push(['Penalty', r.group_id, r.user_id, r.date, `${r.violation_type} - ${r.amount}`]);
            });
            data.leaves.forEach(r => {
                rows.push(['Leave', r.group_id, r.user_id, r.date, `${r.reason}`]);
            });

            await sheetWriter.writeDailyExport(rows);
            console.log('[Cron] Export completed successfully');
        } catch (err) {
            console.error('[Cron] Error during daily export:', err);
        }
    };
}

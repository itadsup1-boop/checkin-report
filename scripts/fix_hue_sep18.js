import pool from '../packages/database/index.js';
import { syncAllTimekeepSheets } from '../apps/bot/syncTimekeepSheets.js';

async function main() {
    const userId = '5669f8f2-fa81-4ca1-ba0a-deb5601b6e4f'; // nguyễn thị hoa huệ
    const groupId = 'a65bfffc-3821-43bd-a066-7e6e155cc391'; // 00. UK LỊCH ON OFF CHECK IN CHECK OUT
    const date = '2026-09-18';
    const onTimeCheckin = '2026-09-18 09:28:00+07';

    console.log('--- BẮT ĐẦU CẬP NHẬT ĐI LÀM ĐÚNG GIỜ CHO NGUYỄN THỊ HOA HUỆ ---');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Xóa bản ghi phạt đi muộn ngày hôm nay (18/09/2026)
        // Việc này đồng thời hoàn lại lượt "miễn phạt lần đầu trong tháng" cho nhân sự
        const delPenalty = await client.query(
            `DELETE FROM tk_penalties 
             WHERE user_id = $1 AND date = $2 AND violation_type = 'LATE'
             RETURNING id, reason, late_minutes`,
            [userId, date]
        );
        console.log(`1. Đã xóa ${delPenalty.rowCount} bản ghi phạt tk_penalties:`, delPenalty.rows);

        // 2. Cập nhật giờ check-in sang đúng giờ và ghi chú admin
        const updCheckin = await client.query(
            `UPDATE tk_check_ins
             SET check_in_time = $1, status = 'APPROVED', admin_note = 'Quản lý xác nhận đi làm đúng giờ'
             WHERE user_id = $2 AND date = $3
             RETURNING id, check_in_time, status, admin_note`,
            [onTimeCheckin, userId, date]
        );
        console.log(`2. Đã cập nhật tk_check_ins:`, updCheckin.rows);

        // 3. Cập nhật trạng thái ngày thành ON_TIME và chốt finalized_at
        const updStatus = await client.query(
            `INSERT INTO tk_attendance_daily_status
                (group_id, user_id, date, result, finalized_at, updated_at, absence_notified_at)
             VALUES ($1, $2, $3, 'ON_TIME', NOW(), NOW(), NULL)
             ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                result = 'ON_TIME',
                finalized_at = NOW(),
                updated_at = NOW(),
                absence_notified_at = NULL
             RETURNING group_id, user_id, date, result, finalized_at`,
            [groupId, userId, date]
        );
        console.log(`3. Đã cập nhật tk_attendance_daily_status thành ON_TIME:`, updStatus.rows);

        // 4. Hủy đơn xin đi muộn nếu có vì đã được tính đúng giờ
        const updLeave = await client.query(
            `UPDATE tk_leave_requests
             SET status = 'CANCELLED'
             WHERE user_id = $1 AND date = $2 AND request_type = 'LATE' AND status = 'APPROVED'
             RETURNING id, request_type, status`,
            [userId, date]
        );
        console.log(`4. Đã cập nhật trạng thái đơn xin đi muộn sang CANCELLED:`, updLeave.rows);

        await client.query('COMMIT');
        console.log('Database transaction committed successfully.');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Lỗi transaction:', err);
        throw err;
    } finally {
        client.release();
    }

    // 5. Đồng bộ lại Google Sheet chấm công
    console.log('5. Đang đồng bộ lên Google Sheets (Bảng chấm công)...');
    try {
        const syncRes = await syncAllTimekeepSheets();
        console.log('5. Kết quả đồng bộ Google Sheets:', syncRes);
    } catch (sheetErr) {
        console.error('5. Lỗi đồng bộ Google Sheets:', sheetErr.message);
    }

    console.log('--- HOÀN TẤT XỬ LÝ CHO NGUYỄN THỊ HOA HUỆ ---');
    await pool.end();
}

main().catch(err => {
    console.error('Lỗi khi chạy script:', err);
    process.exit(1);
});

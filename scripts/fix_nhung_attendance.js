import pool from '../packages/database/index.js';
import { syncAllTimekeepSheets } from '../apps/bot/syncTimekeepSheets.js';

async function main() {
    const userId = 'daceaee2-d46c-4be9-aa21-f97047f4a4f3'; // Hà trần cẩm nhung
    const groupId = 'a65bfffc-3821-43bd-a066-7e6e155cc391'; // 00. UK LỊCH ON OFF CHECK IN CHECK OUT
    const date = '2026-09-06';
    const checkInTime = '2026-09-06 09:02:00';

    console.log('--- BẮT ĐẦU SỬA DỮ LIỆU CHẤM CÔNG CHO HÀ TRẦN CẨM NHUNG ---');

    // 1. Xóa án phạt vắng mặt ngày 2026-09-06
    const delPenalty = await pool.query(
        'DELETE FROM tk_penalties WHERE user_id = $1 AND date = $2',
        [userId, date]
    );
    console.log(`1. Đã xóa phạt tk_penalties: ${delPenalty.rowCount} bản ghi.`);

    // 2. Chèn / cập nhật lượt check-in vào tk_check_ins
    const existingCheckin = await pool.query(
        'SELECT id FROM tk_check_ins WHERE user_id = $1 AND date = $2',
        [userId, date]
    );

    if (existingCheckin.rows.length === 0) {
        const insCheckin = await pool.query(
            `INSERT INTO tk_check_ins (group_id, user_id, date, check_in_time, video_file_id, status, admin_note)
             VALUES ($1, $2, $3, $4, 'telegram_video_note_0902', 'APPROVED', 'Bổ sung check-in video lúc 09:02:00 theo yêu cầu quản lý')
             RETURNING id`,
            [groupId, userId, date, checkInTime]
        );
        console.log(`2. Đã thêm lượt check-in vào tk_check_ins ID: ${insCheckin.rows[0].id}`);
    } else {
        await pool.query(
            `UPDATE tk_check_ins
             SET check_in_time = $1, status = 'APPROVED', admin_note = 'Cập nhật check-in video lúc 09:02:00'
             WHERE id = $2`,
            [checkInTime, existingCheckin.rows[0].id]
        );
        console.log(`2. Đã cập nhật lượt check-in tk_check_ins ID: ${existingCheckin.rows[0].id}`);
    }

    // 3. Cập nhật trạng thái chấm công tk_attendance_daily_status thành ON_TIME
    const updStatus = await pool.query(
        `INSERT INTO tk_attendance_daily_status
            (group_id, user_id, date, result, finalized_at, updated_at, absence_notified_at)
         VALUES ($1, $2, $3, 'ON_TIME', NOW(), NOW(), NULL)
         ON CONFLICT (group_id, user_id, date) DO UPDATE SET
            result = 'ON_TIME',
            finalized_at = NOW(),
            updated_at = NOW(),
            absence_notified_at = NULL`,
        [groupId, userId, date]
    );
    console.log(`3. Đã cập nhật trạng thái ngày tk_attendance_daily_status thành ON_TIME.`);

    // 4. Đồng bộ Google Sheets
    console.log('4. Đang đồng bộ lên Google Sheets (Bảng chấm công)...');
    await syncAllTimekeepSheets();
    console.log('4. Đồng bộ Google Sheets thành công!');

    console.log('--- HOÀN TẤT XỬ LÝ CHO HÀ TRẦN CẨM NHUNG ---');
    await pool.end();
}

main().catch(err => {
    console.error('Lỗi khi sửa dữ liệu:', err);
    process.exit(1);
});

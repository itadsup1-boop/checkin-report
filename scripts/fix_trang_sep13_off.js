import pool from '../packages/database/index.js';
import { syncAllTimekeepSheets } from '../apps/bot/syncTimekeepSheets.js';

async function main() {
    console.log('================================================================');
    console.log('   CẬP NHẬT CHẤM CÔNG CHO TRANG (TG: 6183191829) NGÀY 13/09/2026');
    console.log('   - Xóa phạt vắng mặt 50.000 VNĐ');
    console.log('   - Chuyển lịch thành OFF (Nghỉ)');
    console.log('   - Đồng bộ lên Google Sheets');
    console.log('================================================================\n');

    const userId = 'a12c4300-8367-4ee9-b1de-c50961e845ea';
    const date = '2026-09-13';

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Xóa phạt ngày 2026-09-13
        const delPenalty = await client.query(`
            DELETE FROM tk_penalties
            WHERE user_id = $1 AND date = $2
            RETURNING id, violation_type, amount, reason
        `, [userId, date]);
        console.log(`[1] Đã xóa phạt tk_penalties: ${delPenalty.rowCount} bản ghi.`);
        if (delPenalty.rows.length > 0) {
            console.table(delPenalty.rows);
        }

        // 2. Cập nhật lịch thành OFF
        const updSchedule = await client.query(`
            UPDATE tk_schedules
            SET shift_type = 'OFF',
                updated_by = 'Quản lý',
                updated_at = NOW()
            WHERE user_id = $1 AND date = $2
            RETURNING id, shift_type, updated_by
        `, [userId, date]);
        console.log(`[2] Đã cập nhật tk_schedules thành OFF: ${updSchedule.rowCount} bản ghi.`);
        if (updSchedule.rows.length > 0) {
            console.table(updSchedule.rows);
        }

        // 3. Xóa trạng thái vắng mặt trong tk_attendance_daily_status
        const delStatus = await client.query(`
            DELETE FROM tk_attendance_daily_status
            WHERE user_id = $1 AND date = $2
            RETURNING user_id, date, result
        `, [userId, date]);
        console.log(`[3] Đã xóa bản ghi vắng mặt tk_attendance_daily_status: ${delStatus.rowCount} bản ghi.`);

        await client.query('COMMIT');
        console.log('\n[OK] Cập nhật cơ sở dữ liệu thành công!');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[X] Lỗi khi cập nhật DB:', error);
        throw error;
    } finally {
        client.release();
    }

    // 4. Đồng bộ Google Sheets
    console.log('\n[4] Đang đồng bộ lên Google Sheets...');
    try {
        const syncResult = await syncAllTimekeepSheets();
        console.log('[OK] Kết quả đồng bộ Sheets:', syncResult?.message || 'Thành công');
    } catch (sheetErr) {
        console.error('[!] Lỗi đồng bộ Google Sheets:', sheetErr.message);
    }

    console.log('\n================================================================');
    console.log('   HOÀN TẤT: NGÀY 13/09/2026 CỦA TRANG ĐÃ CHUYỂN THÀNH OFF & XÓA PHẠT');
    console.log('================================================================\n');

    await pool.end();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

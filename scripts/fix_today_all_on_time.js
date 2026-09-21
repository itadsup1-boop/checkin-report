import pool from '../packages/database/index.js';
import { syncAllTimekeepSheets } from '../apps/bot/syncTimekeepSheets.js';

async function main() {
    console.log('================================================================');
    console.log('   BẮT ĐẦU CẬP NHẬT CHẤM CÔNG HÔM NAY: TẤT CẢ ĐI ĐÚNG GIỜ');
    console.log('   (Khắc phục sự cố máy chủ / hệ thống gián đoạn buổi sáng)');
    console.log('================================================================\n');

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Lấy ngày hôm nay theo giờ Việt Nam
        const nowRes = await client.query(`
            SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text AS today
        `);
        const today = nowRes.rows[0].today;
        console.log(`[1] Ngày áp dụng: ${today}`);

        // 2. Xóa toàn bộ tiền phạt ngày hôm nay (nếu có)
        const delPenalties = await client.query(`
            DELETE FROM tk_penalties WHERE date = $1 RETURNING id, user_id, amount, reason
        `, [today]);
        console.log(`[2] Đã xóa ${delPenalties.rowCount} bản ghi phạt ngày ${today} trong tk_penalties.`);

        // 3. Danh sách tất cả nhân sự đang hoạt động cần ghi nhận đi đúng giờ hôm nay
        // Bao gồm:
        // - MDT: Trần ngọc, trần quang trung, Trần Phương Hoa
        // - UK: Bàn thị nhung, Hà trần cẩm nhung, Huệ ktv, Nguyễn Ngọc Trang, nguyễn thị hoa huệ
        // - VP: Nguyễn Lan Anh, Thảo, trang
        const targetStaff = [
            // MDT
            { name: 'Trần ngọc', groupName: '00. MDT ĐK NGHỈ - CHECK IN OUT', defaultShift: 'CA_SANG', defaultCheckIn: '08:11:46' },
            { name: 'trần quang trung', groupName: '00. MDT ĐK NGHỈ - CHECK IN OUT', defaultShift: 'CA_SANG', defaultCheckIn: '08:19:22' },
            { name: 'Trần Phương Hoa', groupName: '00. MDT ĐK NGHỈ - CHECK IN OUT', defaultShift: 'CA_SANG', defaultCheckIn: '08:27:27' },
            // UK
            { name: 'Bàn thị nhung', groupName: '00. UK LỊCH ON OFF CHECK IN CHECK OUT', defaultShift: 'CA_CHIEU', defaultCheckIn: '08:29:54' },
            { name: 'Hà trần cẩm nhung', groupName: '00. UK LỊCH ON OFF CHECK IN CHECK OUT', defaultShift: 'CA_CHIEU', defaultCheckIn: '08:25:00' },
            { name: 'Huệ ktv', groupName: '00. UK LỊCH ON OFF CHECK IN CHECK OUT', defaultShift: 'CA_CHIEU', defaultCheckIn: '08:33:46' },
            { name: 'Nguyễn Ngọc Trang', groupName: '00. UK LỊCH ON OFF CHECK IN CHECK OUT', defaultShift: 'CA_SANG', defaultCheckIn: '08:25:00' },
            { name: 'nguyễn thị hoa huệ', groupName: '00. UK LỊCH ON OFF CHECK IN CHECK OUT', defaultShift: 'CA_CHIEU', defaultCheckIn: '08:28:00' },
            // VP
            { name: 'Nguyễn Lan Anh', groupName: '00. Đăng kí ON OFF VP', defaultShift: 'CA_SANG', defaultCheckIn: '08:25:00' },
            { name: 'Thảo', groupName: '00. Đăng kí ON OFF VP', defaultShift: 'CA_SANG', defaultCheckIn: '08:26:00' },
            { name: 'trang', groupName: '00. Đăng kí ON OFF VP', defaultShift: 'CA_SANG', defaultCheckIn: '08:27:00' },
        ];

        console.log(`\n[3] Bắt đầu xử lý cho ${targetStaff.length} nhân sự đi làm hôm nay...`);

        const results = [];

        for (const staff of targetStaff) {
            // Lấy thông tin nhân viên & nhóm
            const empRes = await client.query(`
                SELECT e.id AS user_id, e.full_name, g.id AS group_id, g.group_name
                FROM employees e
                JOIN telegram_groups g ON g.id = e.group_id
                WHERE LOWER(TRIM(e.full_name)) = LOWER(TRIM($1))
                  AND g.group_name = $2
            `, [staff.name, staff.groupName]);

            if (empRes.rows.length === 0) {
                console.warn(`[!] Không tìm thấy nhân viên ${staff.name} tại nhóm ${staff.groupName}`);
                continue;
            }

            const { user_id, group_id, full_name, group_name } = empRes.rows[0];

            // 3.1 Đảm bảo có lịch trong tk_schedules
            const schedRes = await client.query(`
                SELECT id, shift_type FROM tk_schedules
                WHERE user_id = $1 AND group_id = $2 AND date = $3
            `, [user_id, group_id, today]);

            let shiftType = staff.defaultShift;
            if (schedRes.rows.length === 0) {
                await client.query(`
                    INSERT INTO tk_schedules (group_id, user_id, date, shift_type, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, NOW(), NOW())
                `, [group_id, user_id, today, staff.defaultShift]);
            } else {
                shiftType = schedRes.rows[0].shift_type;
            }

            // 3.2 Đảm bảo có lượt check-in hợp lệ trong tk_check_ins
            const checkinRes = await client.query(`
                SELECT id, check_in_time, status FROM tk_check_ins
                WHERE user_id = $1 AND group_id = $2 AND date = $3
                ORDER BY check_in_time ASC
            `, [user_id, group_id, today]);

            let finalCheckinTime = `${today} ${staff.defaultCheckIn}`;

            if (checkinRes.rows.length === 0) {
                // Chèn mới check-in đúng giờ
                await client.query(`
                    INSERT INTO tk_check_ins (group_id, user_id, date, check_in_time, video_file_id, status, admin_note)
                    VALUES ($1, $2, $3, $4, 'server_crash_recovery', 'APPROVED', 'Bổ sung check-in do máy chủ gặp sự cố')
                `, [group_id, user_id, today, finalCheckinTime]);
            } else {
                // Đã có check-in: Cập nhật status thành APPROVED và note
                const firstId = checkinRes.rows[0].id;
                // Nếu giờ check-in quá muộn do máy sập, điều chỉnh thành giờ đúng giờ
                await client.query(`
                    UPDATE tk_check_ins
                    SET check_in_time = $1,
                        status = 'APPROVED',
                        admin_note = 'Máy chủ gặp sự cố - xác nhận đi đúng giờ'
                    WHERE id = $2
                `, [finalCheckinTime, firstId]);
            }

            // 3.3 Cập nhật trạng thái ngày tk_attendance_daily_status thành ON_TIME
            await client.query(`
                INSERT INTO tk_attendance_daily_status
                    (group_id, user_id, date, result, finalized_at, updated_at, absence_notified_at)
                VALUES ($1, $2, $3, 'ON_TIME', NOW(), NOW(), NULL)
                ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                    result = 'ON_TIME',
                    finalized_at = NOW(),
                    updated_at = NOW(),
                    absence_notified_at = NULL
            `, [group_id, user_id, today]);

            results.push({
                full_name,
                group_name,
                shift_type: shiftType,
                check_in_time: staff.defaultCheckIn,
                daily_status: 'ON_TIME'
            });
        }

        await client.query('COMMIT');
        console.log('\n[4] Đã cập nhật xong dữ liệu Database thành công!');
        console.table(results);

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[X] Lỗi khi cập nhật database:', err);
        throw err;
    } finally {
        client.release();
    }

    // 5. Đồng bộ toàn bộ lên Google Sheets
    console.log('\n[5] Đang đồng bộ toàn bộ bảng chấm công lên Google Sheets...');
    try {
        const syncResult = await syncAllTimekeepSheets();
        console.log('[OK] Kết quả đồng bộ Sheets:', syncResult?.message || 'Thành công');
    } catch (sheetErr) {
        console.error('[!] Lỗi khi đồng bộ Google Sheets:', sheetErr.message);
    }

    console.log('\n================================================================');
    console.log('   HOÀN TẤT: TẤT CẢ NHÂN SỰ ĐÃ ĐƯỢC XÁC NHẬN ĐI ĐÚNG GIỜ!');
    console.log('================================================================\n');

    await pool.end();
}

main().catch(err => {
    console.error('Lỗi chạy script:', err);
    process.exit(1);
});

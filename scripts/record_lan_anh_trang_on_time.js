import 'dotenv/config';
import pool from '../packages/database/index.js';
import { Telegraf } from 'telegraf';
import { syncAllTimekeepSheets } from '../apps/bot/syncTimekeepSheets.js';

const TELEGRAM_GROUP_ID = '-5589101669';
const GROUP_UUID = '7cdb911f-5e2b-441f-adc9-75a5c8793176';
const DATE_STR = '2026-09-25';

const EMPLOYEES = [
    {
        id: 'a12c4300-8367-4ee9-b1de-c50961e845ea',
        name: 'trang',
        checkInTime: '2026-09-25 08:26:40',
        note: 'Ghi nhận đúng giờ (Sự cố mạng / gửi lúc 08:26:40)'
    },
    {
        id: 'e8eb3d95-a7b9-4ca5-a8cc-403b3b21cc5c',
        name: 'Nguyễn Lan Anh',
        checkInTime: '2026-09-25 08:25:00',
        note: 'Ghi nhận đúng giờ (Báo mất mạng sáng 25/09)'
    }
];

async function main() {
    console.log('[1] Cập nhật bảng tk_check_ins...');
    for (const emp of EMPLOYEES) {
        await pool.query(
            `INSERT INTO tk_check_ins (group_id, user_id, date, check_in_time, video_file_id, status, work_credit, checkin_penalty_amount, admin_note)
             VALUES ($1, $2, $3, $4, 'manual_network_ok', 'APPROVED', 1.0, 0, $5)
             ON CONFLICT (user_id, date) DO UPDATE SET
                check_in_time = EXCLUDED.check_in_time,
                status = 'APPROVED',
                work_credit = 1.0,
                checkin_penalty_amount = 0,
                admin_note = EXCLUDED.admin_note`,
            [GROUP_UUID, emp.id, DATE_STR, emp.checkInTime, emp.note]
        );
        console.log(`  - Đã lưu check-in cho ${emp.name}`);
    }

    console.log('[2] Cập nhật trạng thái ON_TIME trong tk_attendance_daily_status...');
    for (const emp of EMPLOYEES) {
        await pool.query(
            `INSERT INTO tk_attendance_daily_status (group_id, user_id, date, result, finalized_at, updated_at)
             VALUES ($1, $2, $3, 'ON_TIME', NOW(), NOW())
             ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                result = 'ON_TIME',
                finalized_at = NOW(),
                updated_at = NOW()`,
            [GROUP_UUID, emp.id, DATE_STR]
        );
        console.log(`  - Đã cập nhật daily status ON_TIME cho ${emp.name}`);
    }

    console.log('[3] Xoá phạt (nếu có) trong tk_penalties...');
    for (const emp of EMPLOYEES) {
        const deleted = await pool.query(
            `DELETE FROM tk_penalties WHERE user_id = $1 AND date = $2 RETURNING *`,
            [emp.id, DATE_STR]
        );
        if (deleted.rowCount > 0) {
            console.log(`  - Đã xoá ${deleted.rowCount} bản ghi phạt của ${emp.name}`);
        }
    }

    console.log('[4] Gửi tin nhắn đính chính / xác nhận vào nhóm Telegram...');
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
        const bot = new Telegraf(botToken);
        const text =
            `✅ <b>XÁC NHẬN ĐIỂM DANH ĐÚNG GIỜ (SỰ CỐ MẠNG)</b> ✅\n\n` +
            `Hệ thống ghi nhận điểm danh ca sáng ngày <b>25/09/2026</b> cho các nhân sự sau do sự cố mất mạng:\n\n` +
            `1. 👤 <b>trang</b> — Đúng giờ (08:26:40) | Công: <b>1.0</b> | Phạt: <b>0đ</b>\n` +
            `2. 👤 <b>Nguyễn Lan Anh</b> — Đúng giờ (08:25:00) | Công: <b>1.0</b> | Phạt: <b>0đ</b>\n\n` +
            `<i>Thông báo đi muộn lúc 08:31 đã được huỷ bỏ. Dữ liệu công đã được cập nhật chuẩn xác lên Google Sheet.</i>`;
        try {
            await bot.telegram.sendMessage(TELEGRAM_GROUP_ID, text, { parse_mode: 'HTML' });
            console.log('  - Đã gửi tin nhắn xác nhận vào nhóm Telegram thành công!');
        } catch (tgErr) {
            console.error('  - Lỗi khi gửi Telegram:', tgErr.message);
        }
    }

    console.log('[5] Đồng bộ Google Sheets...');
    try {
        await syncAllTimekeepSheets();
        console.log('  - Đồng bộ Google Sheets hoàn tất!');
    } catch (sheetErr) {
        console.error('  - Lỗi đồng bộ Sheet:', sheetErr.message);
    }

    console.log('HOÀN TẤT TOÀN BỘ!');
    process.exit(0);
}

main().catch(err => {
    console.error('Lỗi quy trình:', err);
    process.exit(1);
});

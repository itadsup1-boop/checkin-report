import pool from 'file:///c:/Users/ADMIN/Downloads/telegramReport/telegramReport/packages/database/index.js';
import { syncAllTimekeepSheets } from 'file:///c:/Users/ADMIN/Downloads/telegramReport/telegramReport/apps/bot/syncTimekeepSheets.js';
import dotenv from 'dotenv';
dotenv.config();

import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const groupId = '-4233999474'; // Group: 00. UK LỊCH ON OFF CHECK IN CHECK OUT

async function updateCheckinForThuong() {
    try {
        console.log("=== UPDATING CHECK-IN FOR THƯƠNG ===");
        
        const date = '2026-07-25';
        const checkInTime = '2026-07-25 09:35:00';
        const groupUuid = 'a65bfffc-3821-43bd-a066-7e6e155cc391'; // 00. UK LỊCH ON OFF
        const thuongId = '6884c549-b419-4b9f-b60f-301dce8991ce';

        const res = await pool.query(`
            INSERT INTO tk_check_ins (group_id, user_id, date, check_in_time, video_file_id, status, admin_note)
            VALUES ($1, $2, $3, $4, 'manual_admin_update', 'APPROVED', 'Admin cập nhật điểm danh đúng giờ')
            ON CONFLICT DO NOTHING
            RETURNING *
        `, [groupUuid, thuongId, date, checkInTime]);
        console.log("Thương result:", res.rows.length > 0 ? res.rows[0] : "Record already exists or inserted");

        // Đồng bộ Google Sheet
        console.log("\n=== SYNCING GOOGLE SHEETS ===");
        const syncResult = await syncAllTimekeepSheets();
        console.log("Sync Google Sheets success:", syncResult);

        // Gửi thông báo Telegram
        console.log("\n=== SENDING TELEGRAM CONFIRMATION MESSAGE ===");
        const msg = 
            `📸 <b>ĐÃ GHI NHẬN CHECK-IN VIDEO THÀNH CÔNG</b> 📸\n\n` +
            `👤 <b>Nhân viên:</b> Thương\n` +
            `💼 <b>Vị trí:</b> Bộ phận khác\n` +
            `⏰ <b>Thời gian điểm danh:</b> 09:35:00 - 25/07/2026 (Admin xác nhận)\n\n` +
            `<i>Hệ thống đã lưu thông tin điểm danh của bạn thành công!</i>`;
        
        await bot.telegram.sendMessage(groupId, msg, { parse_mode: 'HTML' });
        console.log("Sent confirmation message for Thương successfully!");

        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}
updateCheckinForThuong();

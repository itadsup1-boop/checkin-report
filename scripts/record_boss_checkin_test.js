import 'dotenv/config';
import pool from '../packages/database/index.js';
import { Telegraf } from 'telegraf';
import { syncAllTimekeepSheets } from '../apps/bot/syncTimekeepSheets.js';

async function main() {
    const groupId = '6ae6c991-660f-4b4f-bec1-ac2de36ee48e';
    const userId = '236f6313-fe0b-4187-a147-a5a7055f73fc';
    const telegramGroupId = '-1004434178722';
    const dateStr = '2026-09-25';
    const timeStr = '2026-09-25 09:51:00';

    await pool.query(
        `INSERT INTO tk_check_ins (group_id, user_id, date, check_in_time, video_file_id, status, work_credit, checkin_penalty_amount)
         VALUES ($1, $2, $3, $4, 'video_2026-07-27_11-46-48.mp4', 'APPROVED', 1.0, 0)
         ON CONFLICT (user_id, date) DO UPDATE SET
            check_in_time = EXCLUDED.check_in_time,
            video_file_id = EXCLUDED.video_file_id,
            work_credit = 1.0,
            checkin_penalty_amount = 0`,
        [groupId, userId, dateStr, timeStr]
    );
    console.log('Recorded check-in for Boss in group test');

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
        const bot = new Telegraf(botToken);
        const text =
            `📸 <b>ĐÃ GHI NHẬN CHECK-IN THÀNH CÔNG</b> 📸\n\n` +
            `👤 <b>Nhân viên:</b> Boss\n` +
            `💼 <b>Vị trí:</b> Quản lý\n` +
            `⏰ <b>Thời gian điểm danh:</b> 09:51:00 - 25/09/2026\n` +
            `⭐ <b>Công tính:</b> 1.0 công (Giai đoạn hướng dẫn/chạy thử)\n\n` +
            `<i>Hệ thống đã lưu video điểm danh của bạn thành công!</i>`;
        try {
            await bot.telegram.sendMessage(telegramGroupId, text, { parse_mode: 'HTML' });
            console.log('Sent Telegram confirmation to group test');
        } catch (e) {
            console.error('Error sending Telegram:', e.message);
        }
    }

    try {
        await syncAllTimekeepSheets();
        console.log('Synced sheets successfully');
    } catch (e) {
        console.error('Sheet sync error:', e.message);
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

import { Telegraf } from 'telegraf';
import pool from 'file:///C:/Users/ADMIN/Downloads/telegramReport/telegramReport/packages/database/index.js';
import crypto from 'crypto';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

async function run() {
    const userId = 'd6139e11-fdb9-4ac8-b7d5-948dc4838d84';
    const groupId = '6c07a669-34da-4987-bb79-244b6d5cc856';
    const telegramGroupId = '-1002224124601';
    const dateStr = '2026-08-23'; // 2026-08-22T17:00:00.000Z
    const checkInTime = '2026-08-23 08:15:00'; // Manual time to be on time

    // 1. Insert into tk_check_ins
    const checkinId = crypto.randomUUID();
    await pool.query(`
        INSERT INTO tk_check_ins (id, group_id, user_id, date, check_in_time, status, video_file_id)
        VALUES ($1, $2, $3, $4, $5, 'APPROVED', 'manual_update')
    `, [checkinId, groupId, userId, '2026-08-22T17:00:00.000Z', checkInTime]);
    console.log('Inserted tk_check_ins record.');

    // 2. Update tk_attendance_daily_status
    await pool.query(`
        UPDATE tk_attendance_daily_status 
        SET result = 'ON_TIME', updated_at = NOW() 
        WHERE user_id = $1 AND date = $2
    `, [userId, '2026-08-22T17:00:00.000Z']);
    console.log('Updated tk_attendance_daily_status.');

    // 3. Send Telegram message
    const msg = `📸 <b>ĐÃ GHI NHẬN CHECK-IN VIDEO THÀNH CÔNG</b> 📸\n\n👤 <b>Nhân viên:</b> trần quang trung\n💼 <b>Vị trí:</b> Kỹ thuật viên\n⏰ <b>Thời gian điểm danh:</b> 08:15:00 - 23/08/2026 (Cập nhật thủ công)\n\n<i>Hệ thống đã lưu video điểm danh của bạn thành công!</i>`;
    
    await bot.telegram.sendMessage(telegramGroupId, msg, { parse_mode: 'HTML' });
    console.log('Message sent to group.');
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });

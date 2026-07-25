import dotenv from 'dotenv';
dotenv.config();

import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const groupId = '-4233999474'; // Group: 00. UK LỊCH ON OFF CHECK IN CHECK OUT

async function sendCheckinMessages() {
    try {
        console.log("=== SENDING TELEGRAM CHECK-IN CONFIRMATION MESSAGES ===");
        
        const timestampStr = '09:29:00 - 25/07/2026';

        // 1. Màn thị huệ
        const msg1 = 
            `📸 <b>ĐÃ GHI NHẬN CHECK-IN VIDEO THÀNH CÔNG</b> 📸\n\n` +
            `👤 <b>Nhân viên:</b> Màn thị huệ\n` +
            `💼 <b>Vị trí:</b> Kỹ thuật viên\n` +
            `⏰ <b>Thời gian điểm danh:</b> ${timestampStr}\n\n` +
            `<i>Hệ thống đã lưu thông tin điểm danh của bạn thành công!</i>`;
        
        await bot.telegram.sendMessage(groupId, msg1, { parse_mode: 'HTML' });
        console.log("Sent confirmation message for Màn thị huệ successfully!");

        // 2. nguyễn thị hoa huệ
        const msg2 = 
            `📸 <b>ĐÃ GHI NHẬN CHECK-IN VIDEO THÀNH CÔNG</b> 📸\n\n` +
            `👤 <b>Nhân viên:</b> nguyễn thị hoa huệ\n` +
            `💼 <b>Vị trí:</b> Sales\n` +
            `⏰ <b>Thời gian điểm danh:</b> ${timestampStr}\n\n` +
            `<i>Hệ thống đã lưu thông tin điểm danh của bạn thành công!</i>`;
        
        await bot.telegram.sendMessage(groupId, msg2, { parse_mode: 'HTML' });
        console.log("Sent confirmation message for nguyễn thị hoa huệ successfully!");

        process.exit(0);
    } catch (e) {
        console.error("Error sending message to Telegram:", e);
        process.exit(1);
    }
}

sendCheckinMessages();

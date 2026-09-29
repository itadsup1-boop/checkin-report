import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { syncAllTimekeepSheets } from '../apps/bot/syncTimekeepSheets.js';

async function run() {
    console.log('Syncing timekeep sheets...');
    try {
        await syncAllTimekeepSheets();
        console.log('Timekeep sheets synced successfully.');
    } catch (err) {
        console.error('Failed to sync sheets:', err);
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
        console.warn('No TELEGRAM_BOT_TOKEN found.');
        return;
    }

    const bot = new Telegraf(botToken);
    const groupId = '-5470063387'; // Nhóm 00. Check in Adsup
    const msg = `📢 <b>THÔNG BÁO ĐIỀU CHỈNH GIỜ CHỐT CHECK-OUT</b>\n\n` +
        `• <b>Giờ chốt check-out:</b> <b>23:59 (12h đêm)</b> hàng ngày (hết ngày mới chốt những ai quên check-out).\n` +
        `• <b>Thời gian áp dụng:</b> Bắt đầu từ ngày mai (<b>29/09/2026</b>).\n\n` +
        `✅ Thông báo phạt quên check-out quét lúc 22:00 tối nay của bạn <b>Trịnh Quốc Việt</b> đã được hệ thống huỷ bỏ và cập nhật lại trên bảng chấm công.`;

    try {
        await bot.telegram.sendMessage(groupId, msg, { parse_mode: 'HTML' });
        console.log('Sent notification to group', groupId);
    } catch (err) {
        console.error('Failed to send notification:', err.message);
    }
}

run();

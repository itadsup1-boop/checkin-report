import 'dotenv/config';
import { Telegraf } from 'telegraf';
import pool from '../packages/database/index.js';
import { syncAllTimekeepSheets } from '../apps/bot/syncTimekeepSheets.js';
import { formatMarketingCheckoutReply } from '../domains/timekeep/domain/marketing-attendance-rules.js';

async function main() {
    const telegramGroupId = '-4689278273';
    const warningMsgId = 19303;
    const videoMsgId = 19304;
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

    // 1. Cập nhật checkout_min_time = 18:00:00 cho nhóm 00. vp NK LỊCH ON OFF /NGHỈ PHÉP
    console.log('1. Updating group_settings checkout_min_time to 18:00:00...');
    const updateRes = await pool.query(
        `UPDATE group_settings 
         SET checkout_min_time = '18:00:00',
             updated_at = NOW()
         WHERE telegram_group_id = $1
         RETURNING *`,
        [telegramGroupId]
    );
    console.log('Updated settings:', updateRes.rows[0]);

    // 2. Xóa tin nhắn cảnh báo chưa đến giờ check-out (19303)
    console.log('2. Deleting warning message 19303...');
    try {
        await bot.telegram.deleteMessage(telegramGroupId, warningMsgId);
        console.log('Deleted warning message 19303 successfully.');
    } catch (e) {
        console.warn('Could not delete warning message 19303 (maybe already deleted):', e.message);
    }

    // 3. Ghi nhận check-out cho Nguyễn Hồng Việt ngày 27/09/2026
    console.log('3. Recording check-out for Nguyen Hong Viet...');
    const vietUserId = 'ea4276e7-f880-42fa-920d-ab7b8d374937';
    const dateStr = '2026-09-27';
    const mediaFileId = 'BAACAgUAAxkDAAJLaGq495KyrYZ1zAwS8wjEgUaFSxXKAAJ8IgACPZnJVYzaeDgTq-FFPQQ';

    const checkoutRes = await pool.query(
        `UPDATE tk_check_ins
         SET checkout_time = '2026-09-27 18:01:00',
             checkout_media_file_id = $1,
             checkout_status = 'HOAN_THANH',
             checkout_penalty_amount = 0
         WHERE user_id = $2 AND date = $3
         RETURNING *`,
        [mediaFileId, vietUserId, dateStr]
    );
    console.log('Recorded checkout:', checkoutRes.rows[0]);

    // 4. Gửi tin nhắn xác nhận check-out thành công phản hồi tin video
    console.log('4. Sending checkout confirmation reply...');
    const replyText = formatMarketingCheckoutReply({
        fullName: 'Nguyễn Hồng Việt',
        role: 'Telesale',
        timeStr: '18:01:00 - 27/09/2026'
    });
    try {
        const sent = await bot.telegram.sendMessage(telegramGroupId, replyText, {
            parse_mode: 'HTML',
            reply_to_message_id: videoMsgId
        });
        console.log('Sent confirmation message ID:', sent.message_id);
    } catch (e) {
        console.error('Error sending confirmation message:', e.message);
    }

    // 5. Đồng bộ lại Google Sheet
    console.log('5. Syncing timekeep sheets...');
    await syncAllTimekeepSheets();
    console.log('Sheets synced successfully.');

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

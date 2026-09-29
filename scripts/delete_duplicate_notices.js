import 'dotenv/config';
import { Telegraf } from 'telegraf';
import pool from '../packages/database/index.js';
import { syncAllTimekeepSheets } from '../apps/bot/syncTimekeepSheets.js';

async function main() {
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    const targetChatId = '-5470063387'; // 00. Check in Adsup
    const testChatId = '-1004434178722';   // test group for probing

    console.log('--- BƯỚC 1: Xoá phạt trong database và reset tk_check_ins ---');
    const delRes = await pool.query("DELETE FROM tk_penalties WHERE date = '2026-09-28' AND violation_type = 'MISSED_CHECKOUT'");
    console.log('Đã xoá penalties:', delRes.rowCount);

    const updateRes = await pool.query("UPDATE tk_check_ins SET checkout_status = NULL, checkout_penalty_amount = 0 WHERE date = '2026-09-28' AND checkout_status = 'QUEN_CHECKOUT'");
    console.log('Đã reset checkins:', updateRes.rowCount);

    console.log('\n--- BƯỚC 2: Tìm và gỡ các tin nhắn thông báo phạt trùng trong nhóm Telegram ---');
    // Gửi probe để lấy message_id mới nhất
    const probe = await bot.telegram.sendMessage(targetChatId, '...');
    const currentId = probe.message_id;
    await bot.telegram.deleteMessage(targetChatId, currentId).catch(() => {});
    console.log(`Current message ID in target chat: ${currentId}`);

    const foundMessageIds = [];

    // Quét ngược lại 150 tin nhắn gần nhất
    for (let id = currentId; id >= Math.max(1, currentId - 150); id--) {
        try {
            const fwd = await bot.telegram.forwardMessage(testChatId, targetChatId, id);
            const text = fwd.text || fwd.caption || '';
            await bot.telegram.deleteMessage(testChatId, fwd.message_id).catch(() => {});

            if (text.includes('THÔNG BÁO QUÊN CHECK-OUT') && text.includes('Trịnh Quốc Việt')) {
                console.log(`Tìm thấy tin nhắn thông báo vi phạm tại message_id=${id}:`);
                console.log(text);
                foundMessageIds.push(id);
            }
        } catch (e) {
            // Tin nhắn không tồn tại hoặc không forward được, bỏ qua
        }
    }

    console.log(`\nTổng số tin nhắn cần xoá: ${foundMessageIds.length}`);
    for (const msgId of foundMessageIds) {
        try {
            await bot.telegram.deleteMessage(targetChatId, msgId);
            console.log(`Đã xoá thành công message_id=${msgId} trong nhóm ${targetChatId}`);
        } catch (err) {
            console.error(`Lỗi khi xoá message_id=${msgId}:`, err.message);
        }
    }

    console.log('\n--- BƯỚC 3: Đồng bộ lại Google Sheet ---');
    try {
        await syncAllTimekeepSheets();
        console.log('Đã đồng bộ lại Google Sheet thành công!');
    } catch (err) {
        console.error('Lỗi khi đồng bộ Google Sheet:', err);
    }

    await pool.end();
    process.exit(0);
}

main().catch(err => {
    console.error('Lỗi trong script:', err);
    process.exit(1);
});

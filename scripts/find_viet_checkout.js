import 'dotenv/config';
import { Telegraf } from 'telegraf';

async function main() {
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    const targetChatId = '-4689278273'; // 00. vp NK LỊCH ON OFF /NGHỈ PHÉP
    const testChatId = '-1004434178722';   // test group

    // Send probe
    const probe = await bot.telegram.sendMessage(targetChatId, '...');
    const currentId = probe.message_id;
    await bot.telegram.deleteMessage(targetChatId, currentId).catch(() => {});
    console.log(`Current message ID in NK chat: ${currentId}`);

    for (let id = currentId - 1; id >= Math.max(1, currentId - 20); id--) {
        try {
            const fwd = await bot.telegram.forwardMessage(testChatId, targetChatId, id);
            console.log(`Msg ${id}:`, {
                from: fwd.from?.first_name,
                forward_from: fwd.forward_from?.first_name,
                text: fwd.text,
                caption: fwd.caption,
                video: fwd.video ? { file_id: fwd.video.file_id, duration: fwd.video.duration } : null
            });
            await bot.telegram.deleteMessage(testChatId, fwd.message_id).catch(() => {});
        } catch (e) {
            // ignore
        }
    }
    process.exit(0);
}

main().catch(console.error);

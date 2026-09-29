import 'dotenv/config';
import { Telegraf } from 'telegraf';

async function main() {
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    const chatId = '-1002224124601';

    // Send a probe message to get current message_id
    const probe = await bot.telegram.sendMessage(chatId, '🔎 Đang kiểm tra để thu hồi thông báo...');
    const currentId = probe.message_id;
    console.log('Current message ID:', currentId);

    // Delete the probe message
    await bot.telegram.deleteMessage(chatId, currentId).catch(() => {});

    // Try deleting messages sent by bot in the range [currentId - 20, currentId - 1]
    // The 14:00 message was sent only ~3 minutes ago, so it should be just a few IDs back!
    let found = false;
    for (let id = currentId - 1; id >= currentId - 30; id--) {
        try {
            const ok = await bot.telegram.deleteMessage(chatId, id);
            if (ok) {
                console.log(`Successfully deleted message ID: ${id}`);
                found = true;
                break;
            }
        } catch (e) {
            // Not a bot message or already deleted
        }
    }

    if (!found) {
        console.log('Could not find bot message within 30 IDs, trying wider range...');
        for (let id = currentId - 31; id >= currentId - 100; id--) {
            try {
                const ok = await bot.telegram.deleteMessage(chatId, id);
                if (ok) {
                    console.log(`Successfully deleted message ID: ${id}`);
                    found = true;
                    break;
                }
            } catch (e) {}
        }
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

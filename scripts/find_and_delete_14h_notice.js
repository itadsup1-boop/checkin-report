import 'dotenv/config';
import { Telegraf } from 'telegraf';

async function main() {
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    const targetChatId = '-1002224124601'; // 00. MDT ĐK NGHỈ - CHECK IN OUT
    const testChatId = '-1004434178722';   // test group

    // 1. Send probe to find the latest message_id in targetChatId
    const probe = await bot.telegram.sendMessage(targetChatId, '...');
    const currentId = probe.message_id;
    await bot.telegram.deleteMessage(targetChatId, currentId).catch(() => {});
    console.log(`Current message ID in target chat: ${currentId}`);

    let targetMessageId = null;

    // The message was sent at 14:00 (about 12 minutes ago). Search backward from currentId - 1.
    for (let id = currentId - 1; id >= Math.max(1, currentId - 50); id--) {
        try {
            const fwd = await bot.telegram.forwardMessage(testChatId, targetChatId, id);
            const text = fwd.text || fwd.caption || '';
            // Immediately clean up the forwarded message in test chat
            await bot.telegram.deleteMessage(testChatId, fwd.message_id).catch(() => {});

            if (text.includes('THÔNG BÁO NHÂN SỰ KHÔNG CHECK-IN') && text.includes('Mỹ')) {
                console.log(`Found matching message at ID ${id}! Text preview:\n`, text);
                targetMessageId = id;
                break;
            }
        } catch (e) {
            // Message might not exist or can't be forwarded, ignore
        }
    }

    if (targetMessageId) {
        console.log(`Deleting message ${targetMessageId} from target chat...`);
        const delRes = await bot.telegram.deleteMessage(targetChatId, targetMessageId);
        console.log('Delete result:', delRes);
    } else {
        console.log('Matching message not found in the last 50 messages.');
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

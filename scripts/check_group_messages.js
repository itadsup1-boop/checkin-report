import 'dotenv/config';
import { Telegraf } from 'telegraf';

async function main() {
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    const testChatId = '-1004434178722';
    const groups = [
        { id: '-4689278273', name: 'NK' },
        { id: '-5470063387', name: 'Adsup' },
        { id: '-1002224124601', name: 'MDT' },
        { id: '-4233999474', name: 'UK' },
        { id: '-5589101669', name: 'Nam Dong' }
    ];

    for (const g of groups) {
        try {
            const probe = await bot.telegram.sendMessage(g.id, '...');
            const curId = probe.message_id;
            await bot.telegram.deleteMessage(g.id, curId).catch(() => {});
            console.log(`\n=== Group ${g.name} (${g.id}), curId=${curId} ===`);

            for (let id = curId - 1; id >= Math.max(1, curId - 5); id--) {
                try {
                    const fwd = await bot.telegram.forwardMessage(testChatId, g.id, id);
                    console.log(`Msg ${id} [${fwd.date ? new Date(fwd.date * 1000).toLocaleTimeString('vi-VN') : ''}]:`, (fwd.text || fwd.caption || '').slice(0, 100).replace(/\n/g, ' '));
                    await bot.telegram.deleteMessage(testChatId, fwd.message_id).catch(() => {});
                } catch (e) {}
            }
        } catch (err) {
            console.log(`Group ${g.name} probe error:`, err.message);
        }
    }
    process.exit(0);
}

main().catch(console.error);

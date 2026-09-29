import 'dotenv/config';
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const groupId = '-5400720656';

async function run() {
    console.log('Sending probe message to', groupId);
    const sent = await bot.telegram.sendMessage(groupId, '🔍 Probe for message ID');
    const probeId = sent.message_id;
    console.log('Current message ID in group:', probeId);
    await bot.telegram.deleteMessage(groupId, probeId);
    console.log('Deleted probe message');
}

run();

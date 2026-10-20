import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config({ override: true });

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const chatId = '-5400720656';

async function main() {
  const found = [];
  const currentId = 20894;
  console.log('Scanning from', currentId, 'down to 20000...');

  // Scan in steps
  for (let id = currentId; id >= 20000; id--) {
    try {
      await bot.telegram.editMessageReplyMarkup(chatId, id, undefined, { inline_keyboard: [] });
      found.push({ id, status: 'success' });
      console.log('FOUND BOT MESSAGE:', id);
    } catch (err) {
      const desc = err.description || '';
      if (desc.includes('message is not modified')) {
        found.push({ id, status: 'bot_message_unmodified' });
        console.log('FOUND BOT MESSAGE (unmodified):', id);
      } else if (desc.includes("can't be edited")) {
        // User message exists
        // console.log('User message:', id);
      } else {
        // Not found
      }
    }
    if (id % 100 === 0) {
      console.log('Reached ID:', id);
    }
  }

  console.log('Total found:', found);
}

main().catch(console.error);

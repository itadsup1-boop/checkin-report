import dotenv from 'dotenv';
dotenv.config();
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const CHAT_ID = -5589101669;

async function main() {
    // 1. Gửi tin nhắn test và xoá ngay lập tức để lấy message_id hiện tại
    const tempMsg = await bot.telegram.sendMessage(CHAT_ID, '...');
    const currentId = tempMsg.message_id;
    await bot.telegram.deleteMessage(CHAT_ID, currentId);
    console.log('Current message ID in group:', currentId);

    // 2. Kiểm tra các tin nhắn gần nhất xem tin nào do bot gửi và chứa text "THÔNG BÁO QUÊN CHECK-OUT"
    for (let id = currentId - 1; id >= currentId - 30; id--) {
        try {
            // Thử gọi editMessageText với text cũ để xem có phải tin do bot gửi không
            // Nếu đúng tin của bot, nó sẽ thành công hoặc trả về "message is not modified"
            await bot.telegram.editMessageText(CHAT_ID, id, null, 'probe', { parse_mode: 'HTML' });
            console.log(`FOUND BOT MESSAGE AT ID: ${id}`);
        } catch (err) {
            if (err.description?.includes('message is not modified')) {
                console.log(`FOUND BOT MESSAGE (not modified) AT ID: ${id}`);
            } else if (err.description?.includes("message can't be edited")) {
                // Tin nhắn của user khác, không phải của bot
            } else if (err.description?.includes('message to edit not found')) {
                // Không tìm thấy
            } else {
                console.log(`ID ${id}: ${err.message}`);
            }
        }
    }
}

main().catch(console.error);

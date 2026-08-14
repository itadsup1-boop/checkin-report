/**
 * Mọi lời gọi Telegram của domain hồ sơ khách hàng.
 *
 * Tầng application chỉ biết "gửi tin", "tải file", "đánh dấu ✅" — không biết
 * telegraf, không biết `bot.telegram`.
 */

const HTML = { parse_mode: 'HTML', disable_web_page_preview: true };

/** Telegram trả link tải trong 1 giờ; 2 phút là thừa cho một file ≤ 20 MB. */
const DOWNLOAD_TIMEOUT_MS = 120000;

export function createCustomerNotifier({ bot }) {
    async function sendHtml(chatId, message) {
        return bot.telegram.sendMessage(chatId, message, HTML);
    }

    /**
     * Album kèm chú thích. Telegram giới hạn 10 phần tử một album, phần dư bị bỏ
     * (giống hành vi cũ) — ảnh vẫn được lưu đủ trên Drive.
     */
    async function sendAlbum(chatId, files, caption) {
        const mediaGroup = files.slice(0, 10).map((file, idx) => {
            const media = {
                type: file.mimetype.startsWith('video') ? 'video' : 'photo',
                media: { source: file.path }
            };
            if (idx === 0) {
                media.caption = caption;
                media.parse_mode = 'HTML';
            }
            return media;
        });
        return bot.telegram.sendMediaGroup(chatId, mediaGroup);
    }

    async function replyTo(chatId, messageId, text) {
        return bot.telegram.sendMessage(chatId, text, { reply_to_message_id: messageId }).catch(() => {});
    }

    /** Dấu ✅ ngay trên file nhân viên gửi — cách báo "đã lên Drive" ít ồn nhất. */
    async function markDone(chatId, messageId) {
        return bot.telegram.setMessageReaction(chatId, Number(messageId), [{ type: 'emoji', emoji: '✅' }])
            .catch(() => {});
    }

    async function downloadFile(fileId) {
        const link = await bot.telegram.getFileLink(fileId);
        const response = await fetch(link.href, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
        if (!response.ok) throw new Error(`Telegram download HTTP ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
    }

    return { sendHtml, sendAlbum, replyTo, markDone, downloadFile };
}

/**
 * Nhận ảnh/video nhân viên reply vào tin hồ sơ trong nhóm.
 *
 * Handler này đứng CHUNG hàng với các role khác trên cùng sự kiện photo/video/
 * document. Nguyên tắc sống còn: không phải việc của mình thì gọi `next()` — nuốt
 * mất là hỏng chức năng ảnh minh chứng của role báo cáo và chấm công.
 */

import { CUSTOMER_REPLY_ROLES, extractRecordId } from '../../domain/record-rules.js';
import { ACCEPT_RESULT } from '../../application/accept-telegram-media.js';

/** Một số client chỉ gắn reply_to_message cho phần tử ĐẦU của album. */
const ALBUM_TARGET_TTL_MS = 2 * 60 * 1000;

/** Gom biên nhận của cả album thành một tin, thay vì spam mỗi ảnh một tin. */
const ALBUM_ACK_DEBOUNCE_MS = 1200;

const REPLIES = {
    [ACCEPT_RESULT.RECORD_NOT_FOUND]: '⚠️ Không tìm thấy hồ sơ khách hàng tương ứng.',
    [ACCEPT_RESULT.WRONG_GROUP]: '⚠️ Hồ sơ này không thuộc nhóm hồ sơ khách hàng hiện tại.',
    [ACCEPT_RESULT.NOT_OWNER]: '⚠️ Chỉ nhân viên đã tạo hồ sơ này mới được gửi bổ sung ảnh/video.',
    [ACCEPT_RESULT.UNSUPPORTED_TYPE]: '⚠️ Hồ sơ khách hàng chỉ nhận hình ảnh hoặc video.',
    [ACCEPT_RESULT.TOO_LARGE]: '⚠️ File lớn hơn 20 MB nên Bot Telegram không thể tải xuống. Hãy gửi video ở chế độ nén của Telegram hoặc dùng cách tải trực tiếp trong Mini App.',
    [ACCEPT_RESULT.DUPLICATE]: 'ℹ️ File này đã được tiếp nhận trước đó, Bot không tải trùng.'
};

/** Bóc file khỏi message; trả null nếu đây không phải ảnh/video. */
function extractMedia(message) {
    if (message.photo?.length) {
        const photo = message.photo[message.photo.length - 1];
        return { file: photo, mediaType: 'photo', mimeType: 'image/jpeg', fileName: null };
    }
    if (message.video) {
        return {
            file: message.video,
            mediaType: 'video',
            mimeType: message.video.mime_type || 'video/mp4',
            fileName: message.video.file_name || null
        };
    }
    if (message.document) {
        const mimeType = message.document.mime_type || '';
        if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) return { rejected: true };
        return {
            file: message.document,
            mediaType: mimeType.startsWith('video/') ? 'video' : 'photo',
            mimeType,
            fileName: message.document.file_name || null
        };
    }
    return null;
}

export function registerCustomerMediaReply({ bot, getGroupRole, acceptTelegramMedia }) {
    const albumTargets = new Map();
    const ackTimers = new Map();

    function acknowledge(ctx, recordId) {
        const mediaGroupId = ctx.message.media_group_id;
        if (!mediaGroupId) {
            return ctx.reply(
                '✅ Đã tiếp nhận file. Bot đang đồng bộ lên Google Drive trong nền; dấu ✅ sẽ xuất hiện trên file khi hoàn tất.',
                { reply_to_message_id: ctx.message.message_id }
            ).catch(() => {});
        }

        const key = `${ctx.chat.id}:${recordId}:${mediaGroupId}`;
        const current = ackTimers.get(key) || { count: 0, timer: null };
        current.count += 1;
        if (current.timer) clearTimeout(current.timer);
        current.timer = setTimeout(() => {
            ackTimers.delete(key);
            ctx.telegram.sendMessage(
                ctx.chat.id,
                `✅ Đã tiếp nhận ${current.count} ảnh/video. Bot đang đồng bộ lên Google Drive trong nền; từng file sẽ có dấu ✅ khi hoàn tất.`,
                { reply_to_message_id: ctx.message.message_id }
            ).catch(() => {});
        }, ALBUM_ACK_DEBOUNCE_MS);
        ackTimers.set(key, current);
    }

    function resolveRecordId(ctx, albumKey) {
        const replyMessage = ctx.message.reply_to_message;
        const isReplyToThisBot = replyMessage?.from?.is_bot && replyMessage.from.id === ctx.botInfo?.id;
        let recordId = isReplyToThisBot
            ? extractRecordId(replyMessage.text || replyMessage.caption || '')
            : null;

        if (recordId && albumKey) {
            albumTargets.set(albumKey, recordId);
            const cleanupTimer = setTimeout(() => albumTargets.delete(albumKey), ALBUM_TARGET_TTL_MS);
            cleanupTimer.unref?.();
        } else if (!recordId && albumKey) {
            recordId = albumTargets.get(albumKey) || null;
        }
        return recordId;
    }

    bot.on(['photo', 'video', 'document'], async (ctx, next) => {
        try {
            if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) return next();

            const groupRole = await getGroupRole(ctx.chat.id);
            if (!CUSTOMER_REPLY_ROLES.includes(groupRole)) return next();

            const mediaGroupId = ctx.message.media_group_id || null;
            const albumKey = mediaGroupId ? `${ctx.chat.id}:${mediaGroupId}` : null;
            const recordId = resolveRecordId(ctx, albumKey);
            if (!recordId) return next();

            const extracted = extractMedia(ctx.message);
            if (!extracted) return next();

            const { result } = await acceptTelegramMedia({
                recordId,
                chatId: ctx.chat.id,
                senderId: ctx.from.id,
                unsupportedType: Boolean(extracted.rejected),
                media: extracted.rejected ? null : {
                    fileId: extracted.file.file_id,
                    fileUniqueId: extracted.file.file_unique_id,
                    chatId: String(ctx.chat.id),
                    messageId: ctx.message.message_id,
                    mediaGroupId,
                    mediaType: extracted.mediaType,
                    mimeType: extracted.mimeType,
                    fileName: extracted.fileName,
                    fileSize: Number(extracted.file.file_size || 0)
                }
            });

            if (result !== ACCEPT_RESULT.QUEUED) {
                return ctx.reply(REPLIES[result], { reply_to_message_id: ctx.message.message_id });
            }

            acknowledge(ctx, recordId);
        } catch (error) {
            console.error('[Customer Telegram Reply Receive Error]:', error);
            return ctx.reply('❌ Không thể tiếp nhận file lúc này. Vui lòng thử lại.', {
                reply_to_message_id: ctx.message.message_id
            }).catch(() => {});
        }
    });
}

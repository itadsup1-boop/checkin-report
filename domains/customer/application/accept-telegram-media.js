/**
 * Use case: tiếp nhận một ảnh/video nhân viên reply vào tin hồ sơ.
 *
 * Chỉ XẾP HÀNG, không tải lên Drive tại đây: Telegram chờ webhook trả lời trong
 * vài giây, còn tải Drive thì lâu hơn thế. Việc tải do worker ở
 * `collect-telegram-media.js` làm.
 */

import {
    CUSTOMER_REPLY_ROLES,
    TELEGRAM_BOT_DOWNLOAD_LIMIT,
    inferMediaExtension
} from '../domain/record-rules.js';

/** Kết quả trả về cho tầng giao diện tự chọn câu trả lời. */
export const ACCEPT_RESULT = {
    QUEUED: 'QUEUED',
    RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',
    WRONG_GROUP: 'WRONG_GROUP',
    NOT_OWNER: 'NOT_OWNER',
    UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
    TOO_LARGE: 'TOO_LARGE',
    DUPLICATE: 'DUPLICATE'
};

/**
 * Thứ tự kiểm tra là CỐ Ý và giữ nguyên như bản gốc: hồ sơ → nhóm → chủ hồ sơ →
 * định dạng → dung lượng. Người ngoài hồ sơ phải nhận đúng lời từ chối về quyền,
 * chứ không phải lời góp ý về định dạng file.
 */
export function createAcceptTelegramMedia({ repository, now = () => Date.now() }) {
    return async function acceptTelegramMedia({ recordId, chatId, senderId, media, unsupportedType = false }) {
        const record = await repository.findRecordWithGroup(recordId);
        if (!record) return { result: ACCEPT_RESULT.RECORD_NOT_FOUND };

        if (String(record.telegram_group_id) !== String(chatId)
            || !CUSTOMER_REPLY_ROLES.includes(record.bot_role)) {
            return { result: ACCEPT_RESULT.WRONG_GROUP };
        }

        // Ảnh khách hàng là dữ liệu nhạy cảm: chỉ người tạo hồ sơ được bổ sung.
        if (String(record.creator_telegram_id || '') !== String(senderId)) {
            return { result: ACCEPT_RESULT.NOT_OWNER };
        }

        if (unsupportedType) return { result: ACCEPT_RESULT.UNSUPPORTED_TYPE };

        if (media.fileSize > TELEGRAM_BOT_DOWNLOAD_LIMIT) {
            return { result: ACCEPT_RESULT.TOO_LARGE };
        }

        const fileName = media.fileName
            || `Customer_${recordId.slice(0, 8)}_${now()}${inferMediaExtension(media.mimeType, media.mediaType)}`;

        const queuedId = await repository.enqueueMedia({ ...media, recordId, fileName });
        if (!queuedId) return { result: ACCEPT_RESULT.DUPLICATE };

        return { result: ACCEPT_RESULT.QUEUED, queuedId };
    };
}

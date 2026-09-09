/**
 * HTTP cho Mini App hồ sơ khách hàng.
 *
 * Hợp đồng KHÔNG được đổi — Mini App đang chạy ngoài production gọi đúng đường
 * dẫn và đúng tên field này:
 *   POST /api/customer/save   multipart, field tệp là `media_files` (tối đa 20)
 */

import { CustomerError, MAX_MEDIA_FILES } from '../../domain/record-rules.js';

export function registerCustomerRoutes({ botApp, authenticateTelegramMiniApp, uploadCustomerMedia, createCustomerRecord }) {
    botApp.post(
        '/api/customer/save',
        authenticateTelegramMiniApp,
        uploadCustomerMedia.array('media_files', MAX_MEDIA_FILES),
        async (req, res) => {
            try {
                const outcome = await createCustomerRecord({
                    telegramId: req.verifiedTelegramId || req.body.telegram_id,
                    chatId: req.body.chat_id,
                    files: req.files || [],
                    mediaMode: req.body.media_mode,
                    form: req.body
                });

                // Trả lời trước, làm việc nặng sau: Mini App đóng ngay, nhân viên
                // không phải ngồi chờ Drive/Sheet.
                res.json({
                    success: true,
                    media_mode: outcome.mediaMode,
                    message: outcome.message
                });

                outcome.runBackground();
            } catch (error) {
                if (error instanceof CustomerError) {
                    return res.status(error.status).json({ success: false, message: error.message });
                }
                console.error('[Save Customer Record Error]:', error);
                res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + error.message });
            }
        }
    );
}

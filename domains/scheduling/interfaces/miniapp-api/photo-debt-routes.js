/**
 * Nợ ảnh: danh sách lịch cần bổ sung minh chứng, và bổ sung ảnh qua Mini App.
 *
 * Tầng này chỉ dịch HTTP ↔ nghiệp vụ. Đổi shape phản hồi là gãy Mini App đang
 * chạy thật — xem README.md.
 */

import { SchedulingError } from '../../domain/makeup-rules.js';
import { buildProofReceivedCaption } from '../../domain/appointment-messages.js';

function fail(res, error, logLabel) {
    if (error instanceof SchedulingError) {
        return res.status(error.status).json({ success: false, error: error.message });
    }
    console.error(logLabel, error);
    return res.status(500).json({ success: false, error: error.message });
}

export function registerPhotoDebtRoutes({
    botApp,
    authenticateTelegramMiniApp,
    repository,
    submitProofPhoto,
    bot,
    sendPhotoToRoleGroup
}) {
    botApp.get('/api/photo-debts', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const { date, groupId } = req.query;
            const telegramId = req.verifiedTelegramId;
            if (!groupId) {
                return res.status(400).json({ success: false, error: 'Thiếu thông tin nhóm làm việc' });
            }

            const data = await repository.listPhotoDebts(telegramId, groupId, date);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Lỗi API lấy nợ ảnh:');
        }
    });

    botApp.post('/api/upload-proof', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const { id, imageBase64, groupId } = req.body;
            const { apt, proofUrl, buffer } = await submitProofPhoto.uploadFromMiniApp({
                id, groupId, telegramId: req.verifiedTelegramId, imageBase64
            });

            try {
                let targetGroup = apt.group_id;
                if (!targetGroup || targetGroup === 'MINI_APP') {
                    targetGroup = await repository.findFallbackNotifyGroup();
                }
                if (targetGroup) {
                    await sendPhotoToRoleGroup(
                        bot, targetGroup, ['report', 'report_tour'],
                        { source: buffer },
                        { caption: buildProofReceivedCaption(apt), parse_mode: 'HTML' },
                        'upload_proof_api'
                    );
                }
            } catch (tgErr) {
                console.error('Lỗi gửi ảnh chứng thực lên Telegram:', tgErr);
            }

            res.json({ success: true, proof_image: proofUrl });
        } catch (error) {
            fail(res, error, 'Lỗi upload ảnh chứng thực:');
        }
    });
}

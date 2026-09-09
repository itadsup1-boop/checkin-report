/**
 * Mini App "Xin nghỉ đột xuất/đi muộn".
 *
 * Hợp đồng tương thích — giữ nguyên đường dẫn và shape phản hồi:
 * `POST /api/timekeep/leave-request/save`.
 */
export function registerLeaveRequestRoutes({ botApp, saveLeaveRequest }) {
    botApp.post('/api/timekeep/leave-request/save', async (req, res) => {
        try {
            const { chat_id, request_type, late_minutes, date, reason, proof_image } = req.body;
            const telegram_id = req.verifiedTelegramId || req.body.telegram_id;

            const result = await saveLeaveRequest({
                telegramId: telegram_id, chatId: chat_id, requestType: request_type,
                lateMinutes: late_minutes, date, reason, proofImage: proof_image
            });

            if (!result.ok) {
                return res.status(result.status).json({ success: false, message: result.message });
            }
            res.json({ success: true, message: result.message });
        } catch (error) {
            console.error('[Save Leave Request Error]:', error);
            res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + error.message, error });
        }
    });
}

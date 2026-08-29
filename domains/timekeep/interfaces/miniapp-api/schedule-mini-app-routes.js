/**
 * Mini App "Đăng ký lịch tuần": xem lịch tuần này/tuần sau, và lưu lịch (có thể
 * cần Quản lý duyệt nếu đăng ký nghỉ >= 2 ngày).
 *
 * Hợp đồng tương thích — không đổi shape phản hồi, Mini App đang chạy thật gọi
 * vào `GET /api/timekeep/schedule/data`, `POST /api/timekeep/schedule/save`.
 */

export function registerScheduleMiniAppRoutes({ botApp, getScheduleView, saveWeeklySchedule }) {
    botApp.get('/api/timekeep/schedule/data', async (req, res) => {
        try {
            const { chat_id, target_user_id } = req.query;
            const telegram_id = req.verifiedTelegramId || req.query.telegram_id;

            const result = await getScheduleView({ telegramId: telegram_id, chatId: chat_id, targetUserId: target_user_id });
            if (!result.ok) {
                return res.status(result.status).json({ success: false, message: result.message });
            }
            res.json({ success: true, ...result.data });
        } catch (error) {
            console.error('[Get Schedule Error]:', error);
            res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + error.message });
        }
    });

    botApp.post('/api/timekeep/schedule/save', async (req, res) => {
        try {
            const { chat_id, target_user_id, days, proof_image } = req.body;
            const telegram_id = req.verifiedTelegramId || req.body.telegram_id;

            const result = await saveWeeklySchedule({
                telegramId: telegram_id, chatId: chat_id, targetUserId: target_user_id, days, proofImage: proof_image
            });
            if (!result.ok) {
                return res.status(result.status).json({ success: false, message: result.message });
            }
            res.json({ success: true, message: result.message });
        } catch (error) {
            console.error('[Save Schedule Error]:', error);
            res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + error.message });
        }
    });
}

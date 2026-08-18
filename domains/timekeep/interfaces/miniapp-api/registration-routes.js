/**
 * HTTP mà Mini App chấm công gọi.
 *
 * Hợp đồng KHÔNG được đổi — register.html và schedule.html đang chạy gọi đúng
 * hai đường dẫn này:
 *   POST /api/timekeep/register            đăng ký tài khoản nhân sự
 *   POST /api/timekeep/schedule/toggle     mở / đóng đăng ký lịch tuần
 */

import { TimekeepError } from '../../domain/timekeep-rules.js';

export function registerTimekeepRegistrationRoutes({ botApp, registerEmployee, toggleScheduleRegistration }) {
    botApp.post('/api/timekeep/register', async (req, res) => {
        try {
            const outcome = await registerEmployee({
                telegramId: req.verifiedTelegramId || req.body.telegram_id,
                telegramUsername: req.body.telegram_username,
                fullName: req.body.full_name,
                role: req.body.role,
                telegramGroupId: req.body.telegram_group_id
            });
            if (!outcome.ok) {
                return res.status(outcome.status).json({ success: false, message: outcome.message });
            }
            res.json({ success: true, message: outcome.message });
        } catch (error) {
            if (error instanceof TimekeepError) {
                return res.status(error.status).json({ success: false, message: error.message });
            }
            console.error('[Registration Error] Lỗi đăng ký:', error);
            res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + error.message });
        }
    });

    botApp.post('/api/timekeep/schedule/toggle', async (req, res) => {
        try {
            const outcome = await toggleScheduleRegistration({
                telegramId: req.verifiedTelegramId || req.body.telegram_id,
                chatId: req.body.chat_id
            });
            if (!outcome.ok) {
                return res.status(outcome.status).json({ success: false, message: outcome.message });
            }
            res.json({ success: true, message: outcome.message, new_state: outcome.newState });
        } catch (error) {
            console.error('[Toggle Schedule Error]:', error);
            res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + error.message });
        }
    });
}

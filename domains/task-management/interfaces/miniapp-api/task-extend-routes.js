import { parseDeadlineVi } from '../../application/task-service.js';

export function registerTaskExtendRoutes({ botApp, authenticateTelegramMiniApp, taskService }) {
    botApp.post('/api/task-management/extend', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const displayCode = String(req.body?.displayCode || req.body?.display_code || '').trim();
            const dueInput = String(req.body?.dueInput || '').trim();
            const reason = String(req.body?.reason || '').trim();
            if (!/^\d+$/.test(displayCode)) {
                return res.status(400).json({ success: false, message: 'Mã nhiệm vụ không hợp lệ.' });
            }
            const proposedDueAt = parseDeadlineVi(dueInput);
            if (!proposedDueAt) {
                return res.status(400).json({ success: false, message: 'Thời gian gia hạn không hợp lệ.' });
            }
            if (!reason) {
                return res.status(400).json({ success: false, message: 'Vui lòng nhập lý do gia hạn.' });
            }

            const request = await taskService.requestExtend({
                displayCode,
                telegramUserId: req.verifiedTelegramId,
                proposedDueAt,
                reason
            });
            return res.json({
                success: true,
                requestId: request.id,
                message: 'Đã gửi yêu cầu gia hạn, chờ người giao duyệt.'
            });
        } catch (error) {
            return res.status(error.code === 'NOT_ASSIGNEE' || error.code === 'FORBIDDEN' ? 403 : 400)
                .json({ success: false, message: error.message });
        }
    });
}

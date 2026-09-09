/**
 * Ba endpoint của Mini App lịch khách phục vụ nhóm role `report_tour`.
 *
 * Tầng này chỉ dịch HTTP ↔ nghiệp vụ: đọc query/body, gọi application, đổi lỗi
 * nghiệp vụ thành mã HTTP. Không chứa SQL, không chứa quy tắc.
 *
 * Hợp đồng tương thích — ba đường dẫn và hình dạng phản hồi phải giữ nguyên vì
 * Mini App đang chạy thật gọi vào:
 *   GET  /api/schedules/incomplete     -> { success, data: [] }
 *   POST /api/schedules/makeup         -> { success, message }
 *   GET  /api/schedules/makeup/history -> { success, data: [] }
 */

import { SchedulingError, MAX_PAYLOAD_BYTES } from '../../domain/makeup-rules.js';

function fail(res, error, logLabel) {
    if (error instanceof SchedulingError) {
        return res.status(error.status).json({ success: false, error: error.message });
    }
    console.error(logLabel, error);
    return res.status(500).json({ success: false, error: error.message });
}

export function registerMakeupRoutes({
    botApp,
    authenticateTelegramMiniApp,
    checkPayloadLimit,
    repository,
    makeupService
}) {
    /** Danh sách lịch còn thiếu để đổ vào ô "Chọn lịch thiếu cần bổ sung". */
    botApp.get('/api/schedules/incomplete', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const telegramId = req.verifiedTelegramId;
            const { groupId } = req.query;
            if (!groupId) {
                return res.status(400).json({ success: false, error: 'Thiếu thông tin groupId!' });
            }

            const groupRole = await repository.findSchedulingGroupRole(groupId);
            if (!groupRole) {
                return res.status(403).json({ success: false, error: 'Nhóm này không sử dụng chức năng lịch khách!' });
            }

            const employee = await repository.findEmployeeForGroup(telegramId, groupId);
            if (!employee) {
                return res.status(403).json({ success: false, error: 'Bạn không thuộc nhóm làm việc này!' });
            }

            const data = await repository.listIncompleteAppointments(telegramId, groupId);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Lỗi API lấy lịch chưa hoàn thành:');
        }
    });

    botApp.post(
        '/api/schedules/makeup',
        checkPayloadLimit(MAX_PAYLOAD_BYTES),
        authenticateTelegramMiniApp,
        async (req, res) => {
            try {
                const result = await makeupService.execute({
                    telegramId: req.verifiedTelegramId,
                    body: req.body
                });
                res.json({ success: true, message: result.message });
            } catch (error) {
                fail(res, error, 'Lỗi API tạo yêu cầu báo bù:');
            }
        }
    );

    botApp.get('/api/schedules/makeup/history', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const data = await repository.listRequestHistory(req.verifiedTelegramId);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Lỗi API lấy lịch sử báo bù:');
        }
    });
}

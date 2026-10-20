/**
 * HTTP của đặt lịch khách.
 *
 * ⚠️ THỨ TỰ ĐĂNG KÝ LÀ CÓ CHỦ ĐÍCH. Express khớp route theo thứ tự, mà
 * `/api/schedules/:id` dùng ký tự đại diện nên nó nuốt mọi đường dẫn một đoạn.
 * Vì vậy `/incomplete` (của báo bù) và `/search` phải đăng ký TRƯỚC `:id`.
 * Lỗi này từng xảy ra thật với `/api/schedules/incomplete`.
 *
 * Hợp đồng không được đổi — Mini App `public/scheduling/schedule-client/` đang
 * chạy gọi đúng các đường dẫn này:
 *   GET  /api/schedules           danh sách theo ngày
 *   GET  /api/schedules/search    tìm theo SĐT
 *   POST /api/schedules/add       đặt lịch
 *   GET  /api/schedules/:id       chi tiết
 *   PUT  /api/schedules/update    cập nhật phát sinh
 *   POST /api/schedules/edit      dời lịch
 *   POST /api/schedules/cancel    hủy lịch
 */

import { isRealGroupId } from '../../domain/appointment-rules.js';

/** Lỗi nghiệp vụ trả 200 kèm success:false — đúng như bản cũ Mini App đang đọc. */
function fail(res, outcome) {
    return outcome.status
        ? res.status(outcome.status).json({ success: false, error: outcome.error })
        : res.json({ success: false, error: outcome.error });
}

function serverError(res, label, error) {
    console.error(label, error);
    res.status(500).json({ success: false, error: error.message });
}

export function registerAppointmentRoutes({
    botApp, repository, bookAppointment, manageService
}) {
    botApp.get('/api/schedules', async (req, res) => {
        try {
            const { date, groupId } = req.query;
            if (!isRealGroupId(groupId)) {
                return res.status(400).json({ success: false, error: 'Missing valid groupId' });
            }
            res.json({ success: true, data: await repository.findByDate(date, groupId) });
        } catch (e) {
            serverError(res, 'Lỗi GET /api/schedules', e);
        }
    });

    botApp.get('/api/schedules/search', async (req, res) => {
        try {
            const { phone, groupId } = req.query;
            if (!groupId) return res.status(400).json({ success: false, error: 'Thiếu groupId' });
            res.json({ success: true, data: await repository.searchByPhone(phone, groupId) });
        } catch (e) {
            serverError(res, 'Lỗi GET /api/schedules/search', e);
        }
    });

    botApp.post('/api/schedules/add', async (req, res) => {
        try {
            const { initData, groupId: requestedGroupId, ...form } = req.body;
            const outcome = await bookAppointment({ initData, requestedGroupId, form });
            if (!outcome.ok) return fail(res, outcome);
            res.json({ success: true, message: outcome.message });
        } catch (e) {
            serverError(res, 'Lỗi add schedule:', e);
        }
    });

    // Đăng ký SAU /search vì ':id' nuốt mọi đường dẫn một đoạn.
    botApp.get('/api/schedules/:id', async (req, res) => {
        try {
            const appointment = await repository.findById(req.params.id);
            if (!appointment) {
                return res.status(404).json({ success: false, error: 'Không tìm thấy lịch hẹn' });
            }
            res.json({ success: true, data: appointment });
        } catch (e) {
            serverError(res, 'Lỗi GET /api/schedules/:id', e);
        }
    });

    botApp.put('/api/schedules/update', async (req, res) => {
        try {
            const { id, service, revenue, today_incurred, doctor, nurse } = req.body;
            const outcome = await manageService.updateDetails({
                id,
                details: { service, revenue, todayIncurred: today_incurred, doctor, nurse }
            });
            if (!outcome.ok) return fail(res, outcome);
            // Lịch chưa tới giờ: bản cũ trả nguyên bản ghi, không kèm message.
            if (outcome.respondWithData) {
                return res.json({ success: true, data: outcome.appointment });
            }
            res.json({ success: true, message: outcome.message });
        } catch (e) {
            serverError(res, 'Lỗi PUT /api/schedules/update', e);
        }
    });

    botApp.post('/api/schedules/edit', async (req, res) => {
        try {
            const { id, customer_name, phone, appointment_time, groupId } = req.body;
            const outcome = await manageService.reschedule({
                id, groupId,
                changes: { customerName: customer_name, phone, appointmentTime: appointment_time }
            });
            if (!outcome.ok) return fail(res, outcome);
            res.json({ success: true, message: outcome.message });
        } catch (e) {
            serverError(res, 'Lỗi edit schedule:', e);
        }
    });

    botApp.post('/api/schedules/cancel', async (req, res) => {
        try {
            const { id, cancel_reason, groupId } = req.body;
            const outcome = await manageService.cancel({ id, groupId, reason: cancel_reason });
            if (!outcome.ok) return fail(res, outcome);
            res.json({ success: true, message: outcome.message });
        } catch (e) {
            serverError(res, 'Lỗi cancel schedule:', e);
        }
    });
}

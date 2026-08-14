/**
 * Use case: đặt một lịch khách mới từ Mini App.
 *
 * Trả về `{ ok, error }` thay vì ném lỗi cho phần lỗi nghiệp vụ, vì bản cũ trả
 * HTTP 200 kèm `success: false` cho các lỗi này và Mini App đang đọc đúng như vậy.
 */

import {
    isValidSessions,
    groupIdFromStartParam,
    isRealGroupId
} from '../domain/appointment-rules.js';
import { buildUrgentAlert, arrivalKeyboard, timeOf } from '../domain/appointment-messages.js';

const SESSION_FORMAT_ERROR =
    'Định dạng Số Buổi Làm chưa đúng! Vui lòng điền dạng X/Y (ví dụ: 2/10) hoặc X/Tái khám (ví dụ: 1/Tái khám).';

const UNREGISTERED_ERROR =
    '⚠️ Tài khoản Telegram của bạn chưa được đăng ký trong danh sách nhân sự. Vui lòng đăng ký nhân sự trước!';

export function createBookAppointmentService({ repository, notifier, getGroupRole }) {
    /** Nhóm lấy từ start_param trước, rồi mới tới groupId client gửi lên. */
    function resolveGroupId(initData, requestedGroupId) {
        const parsed = new URLSearchParams(initData);
        const fromStartParam = groupIdFromStartParam(parsed.get('start_param') || '');
        const groupId = fromStartParam || (requestedGroupId ? String(requestedGroupId) : '');
        return { groupId, userStr: parsed.get('user') };
    }

    async function notifyUrgent(appointment, groupId) {
        const targets = [];
        if (isRealGroupId(groupId)) {
            const role = await getGroupRole(groupId);
            if (repository.SCHEDULE_NOTIFY_ROLES.includes(role)) targets.push({ gId: groupId, role });
        } else {
            for (const g of await repository.findUrgentTargetGroups()) {
                targets.push({ gId: g.group_id, role: g.bot_role });
            }
        }

        const message = buildUrgentAlert(appointment);
        for (const { gId, role } of targets) {
            await notifier.send(gId, role, message, 'urgent_schedule_alert', arrivalKeyboard(appointment.id));
        }
    }

    return async function bookAppointment({ initData, requestedGroupId, form }) {
        if (form.sessions && !isValidSessions(form.sessions)) {
            return { ok: false, error: SESSION_FORMAT_ERROR };
        }

        const { groupId, userStr } = resolveGroupId(initData, requestedGroupId);
        if (!isRealGroupId(groupId)) {
            return { ok: false, status: 400, error: 'Cannot determine schedule group' };
        }
        // Nhóm client gửi lên phải khớp nhóm trong start_param — chặn đặt chéo nhóm.
        if (requestedGroupId && String(requestedGroupId) !== groupId) {
            return { ok: false, status: 403, error: 'Schedule group does not match context' };
        }
        if (!userStr) return { ok: false, status: 401, error: 'Unauthorized' };

        const tgUser = JSON.parse(decodeURIComponent(userStr));

        // Lịch "đi luôn" bỏ qua kiểm trùng giờ: khách đã ở đó rồi.
        if (!form.is_urgent) {
            const overlap = await repository.findOverlap(form.appointment_time, groupId);
            if (overlap) {
                return {
                    ok: false,
                    error: `Khung giờ này đã có nhân viên ${overlap.employee_name} đặt lịch cho khách ${overlap.customer_name} lúc ${timeOf(overlap.appointment_time)}. Vui lòng chọn giờ cách ít nhất 1 tiếng!`
                };
            }
        }

        const employee = await repository.findEmployee(tgUser.id.toString(), groupId);
        if (!employee) return { ok: false, error: UNREGISTERED_ERROR };

        // Lấy đúng full_name như bản cũ, KHÔNG rơi về first_name của Telegram:
        // tên hiển thị Telegram không khớp danh sách nhân sự thì công tính sai người.
        const employeeName = employee.full_name;
        const sessionType = form.session_type || 'Bán';

        const id = await repository.insert({
            telegramId: tgUser.id.toString(),
            employeeName,
            groupId,
            customerName: form.customer_name,
            phone: form.phone,
            service: form.service,
            sessions: form.sessions,
            sessionType,
            revenue: form.revenue,
            todayIncurred: form.today_incurred,
            doctor: form.doctor,
            nurse: form.nurse,
            appointmentTime: form.appointment_time,
            // Lịch đi luôn báo động ngay nên coi như đã nhắc, cron khỏi nhắc lần nữa.
            isReminded: Boolean(form.is_urgent)
        });

        if (form.is_urgent) {
            try {
                await notifyUrgent({ ...form, id, employee_name: employeeName, session_type: sessionType }, groupId);
            } catch (tgErr) {
                // Lịch đã lưu rồi; gửi tin hỏng không được làm hỏng việc đặt lịch.
                console.error('Lỗi gửi tin nhắn khách khẩn cấp:', tgErr);
            }
        }

        return { ok: true, id, message: 'Đăng ký lịch thành công!' };
    };
}

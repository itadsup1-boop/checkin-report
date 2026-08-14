/**
 * Use case: sửa phát sinh, dời lịch, hủy lịch.
 *
 * Ba việc này đều phải kiểm lịch có thuộc đúng nhóm đang thao tác hay không —
 * không thì nhân viên nhóm A sửa được lịch của nhóm B.
 */

import { isRealGroupId } from '../domain/appointment-rules.js';
import { buildUpdateReport, updateKeyboard, timeOf } from '../domain/appointment-messages.js';

const NOT_FOUND = { ok: false, status: 404, error: 'Không tìm thấy lịch hẹn' };

export function createManageAppointmentService({ repository, notifier }) {
    /**
     * Cập nhật dịch vụ/thu tiền/phát sinh.
     *
     * Chỉ báo vào nhóm khi lịch ĐÃ tới giờ. Sửa trước giờ hẹn là chuyện bình
     * thường, báo hết thì nhóm ngập tin.
     */
    async function updateDetails({ id, details }) {
        const appointment = await repository.updateDetails(id, details);
        if (!appointment) return NOT_FOUND;

        if (appointment.group_id && new Date(appointment.appointment_time) > new Date()) {
            // Bản cũ trả nguyên bản ghi ở nhánh này (không có `message`). Mini App
            // đang đọc `data` nên giữ đúng hình dạng đó.
            return { ok: true, appointment, respondWithData: true };
        }

        if (appointment.group_id) {
            try {
                const role = await repository.findGroupRole(appointment.group_id) || 'report';
                await notifier.send(
                    appointment.group_id,
                    role,
                    buildUpdateReport(appointment),
                    'urgent_schedule_update',
                    updateKeyboard(appointment.id, { withArrived: appointment.status !== 'ARRIVED' })
                );
            } catch (tgErr) {
                console.error('Lỗi gửi tin báo cáo cập nhật:', tgErr);
            }
        }

        return { ok: true, appointment, message: 'Cập nhật thành công!' };
    }

    /** Kiểm lịch có thuộc nhóm đang thao tác không. */
    async function assertSameGroup(id, groupId, action) {
        if (!isRealGroupId(groupId)) {
            return { ok: false, status: 400, error: 'Missing valid groupId' };
        }
        const existing = await repository.findGroupIdOf(id);
        if (!existing.found) return NOT_FOUND;
        if (existing.groupId !== String(groupId)) {
            return { ok: false, status: 403, error: `Lịch hẹn thuộc nhóm khác, bạn không có quyền ${action}!` };
        }
        return { ok: true, groupId: existing.groupId };
    }

    /** Dời lịch: kiểm trùng giờ mới, bỏ qua chính lịch đang sửa. */
    async function reschedule({ id, groupId, changes }) {
        const permission = await assertSameGroup(id, groupId, 'sửa');
        if (!permission.ok) return permission;

        const overlap = await repository.findOverlap(changes.appointmentTime, permission.groupId, id);
        if (overlap) {
            return {
                ok: false,
                error: `Khung giờ mới bị trùng! Nhân viên ${overlap.employee_name} đã đặt lịch cho khách ${overlap.customer_name} lúc ${timeOf(overlap.appointment_time)}.`
            };
        }

        await repository.reschedule(id, groupId, changes);
        return { ok: true, message: 'Sửa lịch thành công!' };
    }

    async function cancel({ id, groupId, reason }) {
        const permission = await assertSameGroup(id, groupId, 'hủy');
        if (!permission.ok) return permission;

        await repository.cancel(id, groupId, reason);
        return { ok: true, message: 'Đã hủy lịch!' };
    }

    return { updateDetails, reschedule, cancel };
}

/**
 * Use case: Admin sửa / thêm / xoá ca trực từ Web Admin.
 *
 * Mọi thay đổi ở đây đóng dấu `updated_by = 'admin'` để phân biệt với ca do chính
 * nhân viên đăng ký — cần thiết khi đối chiếu khiếu nại về công.
 */

import { isValidShift } from '../domain/timekeep-rules.js';

const NOT_FOUND = { ok: false, status: 404, message: 'Không tìm thấy lịch' };

export function createManageAdminSchedules({ repository, syncSheets }) {
    async function updateShift(scheduleId, shiftType) {
        if (!isValidShift(shiftType)) {
            return { ok: false, status: 400, message: 'Ca trực không hợp lệ' };
        }
        const schedule = await repository.updateShift(scheduleId, shiftType);
        return schedule ? { ok: true, data: schedule } : NOT_FOUND;
    }

    async function createSchedule({ userId, date, shiftType }) {
        if (!userId || !date || !shiftType) {
            return { ok: false, status: 400, message: 'Thiếu thông tin bắt buộc' };
        }
        const groupId = await repository.findGroupIdOfEmployee(userId);
        const schedule = await repository.upsertSchedule({ groupId, userId, date, shiftType });
        console.log('Kết quả trả về:', schedule);
        return { ok: true, data: schedule };
    }

    async function deleteSchedule(scheduleId) {
        const removed = await repository.deleteSchedule(scheduleId);
        if (!removed) return NOT_FOUND;
        // Đồng bộ Sheet chạy nền: xoá lịch không được chờ Google trả lời.
        syncSheets().catch(e => console.error('Sync sheet error:', e));
        return { ok: true };
    }

    return { updateShift, createSchedule, deleteSchedule };
}

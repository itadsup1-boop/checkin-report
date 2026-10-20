/**
 * Use case: Admin sửa / thêm / xoá ca trực từ Web Admin.
 *
 * Mọi thay đổi ở đây đóng dấu `updated_by = 'admin'` để phân biệt với ca do chính
 * nhân viên đăng ký — cần thiết khi đối chiếu khiếu nại về công.
 */

import { isValidShift } from '../domain/timekeep-rules.js';

const NOT_FOUND = { ok: false, status: 404, message: 'Không tìm thấy lịch' };
const FORBIDDEN = { ok: false, status: 403, message: 'Bạn không có quyền quản lý lịch của nhóm này' };

function canManageGroup(admin, telegramGroupId) {
    if (!admin) return true;
    return admin.isSuperAdmin || (admin.allowedGroupIds || []).map(String).includes(String(telegramGroupId));
}

export function createManageAdminSchedules({ repository, syncSheets }) {
    async function updateShift(scheduleId, shiftType, admin = null) {
        if (!isValidShift(shiftType)) {
            return { ok: false, status: 400, message: 'Ca trực không hợp lệ' };
        }
        const telegramGroupId = await repository.findTelegramGroupIdOfSchedule?.(scheduleId);
        if (admin && !telegramGroupId) return NOT_FOUND;
        if (!canManageGroup(admin, telegramGroupId)) return FORBIDDEN;
        const schedule = await repository.updateShift(scheduleId, shiftType);
        return schedule ? { ok: true, data: schedule } : NOT_FOUND;
    }

    async function createSchedule({ userId, date, shiftType, admin = null }) {
        if (!userId || !date || !shiftType) {
            return { ok: false, status: 400, message: 'Thiếu thông tin bắt buộc' };
        }
        const telegramGroupId = await repository.findTelegramGroupIdOfEmployee?.(userId);
        if (admin && !telegramGroupId) return { ok: false, status: 404, message: 'Không tìm thấy nhân viên' };
        if (!canManageGroup(admin, telegramGroupId)) return FORBIDDEN;
        const groupId = await repository.findGroupIdOfEmployee(userId);
        const schedule = await repository.upsertSchedule({ groupId, userId, date, shiftType });
        console.log('Kết quả trả về:', schedule);
        return { ok: true, data: schedule };
    }

    async function deleteSchedule(scheduleId, admin = null) {
        const telegramGroupId = await repository.findTelegramGroupIdOfSchedule?.(scheduleId);
        if (admin && !telegramGroupId) return NOT_FOUND;
        if (!canManageGroup(admin, telegramGroupId)) return FORBIDDEN;
        const removed = await repository.deleteSchedule(scheduleId);
        if (!removed) return NOT_FOUND;
        // Đồng bộ Sheet chạy nền: xoá lịch không được chờ Google trả lời.
        syncSheets().catch(e => console.error('Sync sheet error:', e));
        return { ok: true };
    }

    return { updateShift, createSchedule, deleteSchedule };
}

/**
 * Use case: mở / đóng đăng ký lịch tuần cho cả nhóm.
 *
 * Là công tắc chung, ảnh hưởng mọi nhân sự trong nhóm, nên chỉ Quản lý hoặc Admin
 * hệ thống được bấm.
 */

import { SCHEDULE_TOGGLE_ROLES } from '../domain/timekeep-rules.js';

export function createToggleScheduleRegistration({ repository, isSystemAdmin }) {
    return async function toggleScheduleRegistration({ telegramId, chatId }) {
        if (!telegramId || !chatId) {
            return { ok: false, status: 400, message: 'Dữ liệu không hợp lệ!' };
        }

        const caller = await repository.findCallerWithFlag(telegramId, chatId);
        if (!caller) {
            return { ok: false, status: 404, message: 'Tài khoản không tồn tại trong nhóm này!' };
        }

        if (!isSystemAdmin(telegramId) && !SCHEDULE_TOGGLE_ROLES.includes(caller.role)) {
            return { ok: false, status: 403, message: 'Bạn không có quyền thao tác tính năng này!' };
        }

        const newState = !caller.schedule_registration_open;
        await repository.setRegistrationOpen(caller.group_id, newState);

        return {
            ok: true,
            newState,
            message: newState ? 'Đã MỞ đăng ký lịch.' : 'Đã ĐÓNG đăng ký lịch.'
        };
    };
}

/**
 * Cron mỗi phút: nhắc nhóm khi lịch tới giờ.
 *
 * `is_reminded` được đặt SAU khi gửi xong, nên nếu tiến trình chết giữa chừng
 * lịch đó sẽ được nhắc lại ở phút sau — thà nhắc thừa còn hơn để sót khách.
 */

import { isRealGroupId } from '../domain/appointment-rules.js';
import {
    buildDueReminder, buildPhotoDebtReminder, arrivalKeyboard
} from '../domain/appointment-messages.js';

export function createRemindDueAppointments({ repository, completionRepository, notifier, getGroupRole }) {
    /** Lịch không gắn nhóm (dữ liệu cũ) thì nhắc mọi nhóm đang bật thông báo. */
    async function resolveTargets(appointment, defaultTargets) {
        if (!isRealGroupId(appointment.group_id)) return defaultTargets;

        const role = await getGroupRole(appointment.group_id);
        if (repository.SCHEDULE_NOTIFY_ROLES.includes(role)) {
            return [{ gId: appointment.group_id, role }];
        }
        console.log(`[Cảnh báo] Lịch khách có group_id ${appointment.group_id} nhưng không phải nhóm report/report_tour, bỏ qua.`);
        return [];
    }

    return async function remindDueAppointments() {
        try {
            const groups = await repository.findNotifyGroups();
            const defaultTargets = groups.map(g => ({ gId: g.group_id, role: g.bot_role }));
            if (defaultTargets.length === 0) return;

            for (const appointment of await repository.findDueForReminder()) {
                const message = buildDueReminder(appointment);
                for (const { gId, role } of await resolveTargets(appointment, defaultTargets)) {
                    const keyboard = role === 'report_tour' ? arrivalKeyboard(appointment.id) : undefined;
                    await notifier.send(gId, role, message, 'schedule_time_reminder', keyboard);
                }
                await repository.markReminded(appointment.id);
            }
            // Role report không còn yêu cầu nộp ảnh nên không gửi nhắc nợ ảnh sau 30 phút.
        } catch (e) {
            console.error('Lỗi cron nhắc lịch khách đúng giờ:', e);
        }
    };
}

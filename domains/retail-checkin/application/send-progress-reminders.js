import {
    buildAfternoonProgressReminderMessage,
    buildFinalClosingMessage,
    buildOneHourProgressReminderMessage
} from '../domain/retail-messages.js';

export function createSendProgressReminders({ repository, bot, moment }) {
    return async function sendProgressReminders({ isFinal = false, type = null, targetGroupId = null } = {}) {
        const now = moment().utcOffset(7);
        const dateStr = now.format('YYYY-MM-DD');
        const displayDate = now.format('DD/MM/YYYY');
        const currentTime = now.format('HH:mm');

        const retailGroups = await repository.findRetailGroups();
        if (!retailGroups || retailGroups.length === 0) return;

        const groupsToProcess = targetGroupId
            ? retailGroups.filter(g => g.telegram_group_id === targetGroupId || g.id === targetGroupId)
            : retailGroups;

        for (const group of groupsToProcess) {
            try {
                if (group.auto_reminder_enabled === false) {
                    console.log(`[Retail Checkin] Bỏ qua nhắc nhở nhóm ${group.group_name} vì auto_reminder_enabled = false`);
                    continue;
                }

                const kpiTarget = Number(group.daily_kpi_target) || 15;
                const shiftEnd = (group.shift_end_time || '18:00').slice(0, 5);
                const results = await repository.getDailyProgressForGroup(group.id, dateStr, kpiTarget);
                if (results.length === 0) continue;

                // Nếu nhóm có cấu hình ngày bắt đầu áp dụng và hôm nay chưa đến ngày đó -> Bỏ qua nhắc nhở
                if (group.start_date && dateStr < group.start_date) {
                    console.log(`[Retail Checkin] Bỏ qua nhắc nhở nhóm ${group.group_name} vì chưa đến ngày áp dụng (${dateStr} < ${group.start_date}).`);
                    continue;
                }

                const incomplete = results.filter(r => !r.isCompleted);

                let message = null;
                let label = '';

                if (type === 'one_hour_warning') {
                    // Thống kê trước khi hết giờ làm 1 tiếng
                    message = buildOneHourProgressReminderMessage({
                        dateStr: displayDate,
                        currentTime,
                        shiftEndTime: shiftEnd,
                        progressList: results,
                        targetPoints: kpiTarget
                    });
                    label = `thống kê trước hết ca 1h (${currentTime})`;
                } else if (isFinal) {
                    // Chốt sổ cuối ngày
                    if (incomplete.length === 0) continue;
                    message = buildFinalClosingMessage({
                        dateStr: displayDate,
                        reminders: incomplete,
                        targetPoints: kpiTarget
                    });
                    label = `chốt sổ hết ca (${currentTime})`;
                } else {
                    // Nhắc nhở tiến độ thông thường
                    if (incomplete.length === 0) continue;
                    message = buildAfternoonProgressReminderMessage({
                        dateStr: displayDate,
                        reminders: incomplete,
                        targetPoints: kpiTarget
                    });
                    label = `nhắc nhở tiến độ (${currentTime})`;
                }

                if (message && bot?.telegram) {
                    await bot.telegram.sendMessage(group.telegram_group_id, message, {
                        parse_mode: 'HTML'
                    });
                    console.log(`[Retail Checkin] Đã gửi ${label} cho nhóm ${group.group_name}`);
                }
            } catch (err) {
                console.error(`[Retail Checkin Reminder Error] Nhóm ${group.telegram_group_id}:`, err.message || err);
            }
        }
    };
}


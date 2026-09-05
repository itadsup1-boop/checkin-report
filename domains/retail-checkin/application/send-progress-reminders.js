import { buildAfternoonProgressReminderMessage } from '../domain/retail-messages.js';

export function createSendProgressReminders({ repository, bot, moment }) {
    return async function sendProgressReminders() {
        const now = moment().utcOffset(7);
        const dateStr = now.format('YYYY-MM-DD');
        const displayDate = now.format('DD/MM/YYYY');

        const retailGroups = await repository.findRetailGroups();
        if (!retailGroups || retailGroups.length === 0) return;

        for (const group of retailGroups) {
            try {
                const results = await repository.getDailyProgressForGroup(group.id, dateStr);
                const incomplete = results.filter(r => !r.isCompleted);

                if (incomplete.length === 0) continue;

                const message = buildAfternoonProgressReminderMessage({
                    dateStr: displayDate,
                    reminders: incomplete
                });

                await bot.telegram.sendMessage(group.telegram_group_id, message, {
                    parse_mode: 'HTML'
                });
                console.log(`[Retail Checkin] Đã gửi nhắc nhở 16:00 cho nhóm ${group.group_name}`);
            } catch (err) {
                console.error(`[Retail Checkin Reminder Error] Nhóm ${group.telegram_group_id}:`, err.message || err);
            }
        }
    };
}

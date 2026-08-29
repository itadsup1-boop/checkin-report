import { buildHolidayAnnouncement } from '../domain/holiday-policy.js';

export function registerHolidayAnnouncementCron({ cron, repository, bot, moment }) {
    return cron.schedule('* * * * *', async () => {
        try {
            const now = moment().utcOffset(7);
            const holidays = await repository.findDueForAnnouncement(now.format('YYYY-MM-DD'), now.format('HH:mm:ss'));
            for (const holiday of holidays) {
                const groups = await repository.findRecipientGroups();
                let allSucceeded = true;
                for (const group of groups) {
                    const claim = await repository.claimNotification(holiday.id, group.telegram_group_id);
                    if (!claim) continue;
                    try {
                        const message = await bot.telegram.sendMessage(group.telegram_group_id, buildHolidayAnnouncement(holiday), { parse_mode: 'HTML' });
                        await repository.markNotification(claim.id, { status: 'SENT', messageId: message.message_id });
                    } catch (error) {
                        allSucceeded = false;
                        await repository.markNotification(claim.id, { status: 'FAILED', error: error.message });
                    }
                }
                if (allSucceeded) await repository.markAnnouncementComplete(holiday.id);
            }
        } catch (error) {
            console.error('[Company Holiday Cron] Không xử lý được thông báo:', error);
        }
    });
}

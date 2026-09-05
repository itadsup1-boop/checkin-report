import { buildDailySummaryMessage } from '../domain/retail-messages.js';

export function createSummarizeDailyKpi({ repository, bot, moment }) {
    return async function summarizeDailyKpi() {
        const now = moment().utcOffset(7);
        const dateStr = now.format('YYYY-MM-DD');
        const displayDate = now.format('DD/MM/YYYY');

        // Lấy tất cả các nhóm có role retail_checkin
        const retailGroups = await repository.findRetailGroups();
        if (!retailGroups || retailGroups.length === 0) return;

        for (const group of retailGroups) {
            try {
                const results = await repository.getDailyProgressForGroup(group.id, dateStr);
                if (results.length === 0) continue;

                const message = buildDailySummaryMessage({
                    dateStr: displayDate,
                    results
                });

                await bot.telegram.sendMessage(group.telegram_group_id, message, {
                    parse_mode: 'HTML'
                });
                console.log(`[Retail Checkin] Đã gửi báo cáo tổng kết 18:00 cho nhóm ${group.group_name}`);
            } catch (err) {
                console.error(`[Retail Checkin Summary Error] Nhóm ${group.telegram_group_id}:`, err.message || err);
            }
        }
    };
}

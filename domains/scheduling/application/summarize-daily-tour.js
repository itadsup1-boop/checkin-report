/**
 * Báo cáo tổng kết công tour lúc 22:00 cho các nhóm vai trò `report_tour`.
 *
 * Tầng application — không viết SQL.
 */

import { buildDailyTourSummaryMessage } from '../domain/tour-report-parser.js';

export function createSummarizeDailyTour({
    tourRepository,
    appointmentReportsRepository,
    sendMessageToRoleGroup,
    bot,
    moment
}) {
    /** Chốt và gửi tin tổng hợp công tour ngày hôm nay (22:00). */
    async function summarizeDailyTour(targetGroupId = null) {
        try {
            const todayStr = moment
                ? moment().utcOffset(7).format('YYYY-MM-DD')
                : new Date().toISOString().split('T')[0];
            const dParts = todayStr.split('-');
            const displayDate = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}` : todayStr;

            const groupIds = targetGroupId
                ? [String(targetGroupId)]
                : (await appointmentReportsRepository.findTourGroups()).map(g => g.group_id);

            for (const gId of groupIds) {
                const { ktvSummaries, totalTours } = await tourRepository.getDailyGroupSummary(gId, todayStr);
                const message = buildDailyTourSummaryMessage(ktvSummaries, totalTours, displayDate);

                if (sendMessageToRoleGroup) {
                    await sendMessageToRoleGroup(bot, gId, 'report_tour', message, {
                        parse_mode: 'HTML'
                    }, 'ktv_daily_tour_summary');
                }
            }
        } catch (err) {
            console.error('Lỗi cron 22:00 tổng hợp công tour report_tour:', err);
        }
    }

    /** Lấy tổng hợp hiện tại của một nhóm (dùng cho lệnh /tongtour). */
    async function getInstantGroupSummary(groupId) {
        const todayStr = moment
            ? moment().utcOffset(7).format('YYYY-MM-DD')
            : new Date().toISOString().split('T')[0];
        const dParts = todayStr.split('-');
        const displayDate = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}` : todayStr;

        const { ktvSummaries, totalTours } = await tourRepository.getDailyGroupSummary(groupId, todayStr);
        return buildDailyTourSummaryMessage(ktvSummaries, totalTours, displayDate);
    }

    return {
        summarizeDailyTour,
        getInstantGroupSummary
    };
}

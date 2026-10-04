/**
 * Chạy tổng kết phạt chấm công tuần (Thứ Hai → Chủ nhật) cho các nhóm cấu hình.
 *
 * Chỉ được gọi từ cron tối Chủ nhật sau 20:00 — tự kiểm tra thời điểm trong tuần
 * ở đây để đảm bảo có chạy nhầm lúc nào cũng không gửi nhầm.
 */

import {
    WEEKLY_PENALTY_GROUP_NAMES,
    WEEKLY_SUMMARY_VIOLATION_TYPES,
    aggregateWeeklyPenalties,
    buildWeeklyPenaltyMessage
} from '../domain/weekly-penalty-summary.js';

export function createRunWeeklyPenaltySummary({ repository, sendMessageToRoleGroup, bot, moment }) {
    async function runWeeklyPenaltySummary(nowVn = moment().utcOffset(7)) {
        const sunday = nowVn.clone().startOf('day');
        const monday = sunday.clone().subtract(6, 'days');
        const startDate = monday.format('YYYY-MM-DD');
        const endDate = sunday.format('YYYY-MM-DD');

        const groups = await repository.findWeeklySummaryGroups(WEEKLY_PENALTY_GROUP_NAMES);
        if (groups.length === 0) {
            console.log('[Weekly Penalty Summary] Không tìm thấy nhóm nhận tổng kết, bỏ qua.');
            return { sent: false, reason: 'no_group' };
        }

        const rows = await repository.findWeeklyPenaltyRows({
            groupIds: groups.map(group => group.group_uuid),
            startDate,
            endDate,
            violationTypes: WEEKLY_SUMMARY_VIOLATION_TYPES
        });

        const results = [];
        for (const group of groups) {
            const groupRows = rows.filter(row => row.group_id === group.group_uuid);
            const lockKey = `timekeep_weekly_penalty_${group.telegram_group_id}_${endDate}`;

            const locked = await repository.acquireWeeklySummaryLock(lockKey);
            if (!locked) {
                console.log(`[Weekly Penalty Summary] Nhóm ${group.group_name} đã gửi tuần ${endDate}, bỏ qua.`);
                continue;
            }

            const message = buildWeeklyPenaltyMessage({
                groupName: group.group_name,
                startDate,
                endDate,
                employees: aggregateWeeklyPenalties(groupRows)
            });

            const sent = await sendMessageToRoleGroup(
                bot, group.telegram_group_id, 'timekeep',
                message, { parse_mode: 'HTML' }, 'weekly_penalty_summary'
            );

            if (!sent) {
                // Gửi lỗi thì nhả khóa để tick phút sau thử lại.
                await repository.releaseWeeklySummaryLock(lockKey);
            }
            results.push({ groupName: group.group_name, sent: Boolean(sent) });
        }

        return { sent: results.some(result => result.sent), results };
    }

    return { runWeeklyPenaltySummary };
}

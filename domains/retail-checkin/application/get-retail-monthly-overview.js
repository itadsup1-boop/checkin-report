/**
 * Use case: Lấy dữ liệu tổng quan và tiến độ check-in thị trường cả tháng của toàn bộ thành viên trong nhóm.
 */
export function createGetRetailMonthlyOverview({ repository, moment }) {
    return async function getRetailMonthlyOverview({ groupId, monthStr }) {
        const queryMonth = monthStr || moment().utcOffset(7).format('YYYY-MM');

        // 1. Tìm thông tin nhóm
        const retailGroups = await repository.findRetailGroups();
        if (!retailGroups || retailGroups.length === 0) {
            return {
                month: queryMonth,
                group: null,
                summary: {
                    totalMembers: 0,
                    totalPoints: 0,
                    totalWorkDays: 0,
                    totalCompletedDays: 0,
                    overallCompletionRate: 0,
                    activeMembersCount: 0
                },
                members: []
            };
        }

        const matchedGroup = retailGroups.find(g => 
            g.telegram_group_id === groupId || g.id === groupId
        ) || retailGroups[0];

        const defaultKpi = Number(matchedGroup.daily_kpi_target) || 15;
        const result = await repository.getMonthlyProgressForGroup(matchedGroup.id, queryMonth, defaultKpi);

        return {
            month: queryMonth,
            group: {
                id: matchedGroup.id,
                telegramGroupId: matchedGroup.telegram_group_id,
                groupName: matchedGroup.group_name,
                shiftStart: (matchedGroup.shift_start_time || '08:30').slice(0, 5),
                shiftEnd: (matchedGroup.shift_end_time || '18:00').slice(0, 5),
                defaultKpi
            },
            summary: result.summary,
            members: result.members
        };
    };
}

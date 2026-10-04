/**
 * Use case: Lấy dữ liệu tổng quan và tiến độ check-in thị trường trong ngày của các thành viên.
 */
export function createGetRetailOverview({ repository, moment }) {
    return async function getRetailOverview({ groupId, dateStr }) {
        const queryDate = dateStr || moment().utcOffset(7).format('YYYY-MM-DD');

        // 1. Tìm thông tin nhóm
        const retailGroups = await repository.findRetailGroups();
        if (!retailGroups || retailGroups.length === 0) {
            return {
                date: queryDate,
                group: null,
                summary: {
                    totalMembers: 0,
                    completedCount: 0,
                    inProgressCount: 0,
                    notStartedCount: 0,
                    totalPoints: 0
                },
                members: []
            };
        }

        const matchedGroup = retailGroups.find(g => 
            g.telegram_group_id === groupId || g.id === groupId
        ) || retailGroups[0];

        const defaultKpi = Number(matchedGroup.daily_kpi_target) || 15;
        const members = await repository.getDailyProgressForGroup(matchedGroup.id, queryDate, defaultKpi);

        // 2. Thống kê tổng hợp
        const totalMembers = members.length;
        let completedCount = 0;
        let inProgressCount = 0;
        let notStartedCount = 0;
        let totalPoints = 0;

        for (const m of members) {
            totalPoints += m.validPoints;
            if (m.isCompleted) {
                completedCount++;
            } else if (m.validPoints > 0) {
                inProgressCount++;
            } else {
                notStartedCount++;
            }
        }

        return {
            date: queryDate,
            group: {
                id: matchedGroup.id,
                telegramGroupId: matchedGroup.telegram_group_id,
                groupName: matchedGroup.group_name,
                shiftStart: (matchedGroup.shift_start_time || '08:30').slice(0, 5),
                shiftEnd: (matchedGroup.shift_end_time || '18:00').slice(0, 5),
                defaultKpi
            },
            summary: {
                totalMembers,
                completedCount,
                inProgressCount,
                notStartedCount,
                totalPoints
            },
            members
        };
    };
}

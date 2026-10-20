/**
 * Use case: Cập nhật hoặc xóa chỉ tiêu KPI cá nhân của 1 nhân viên trong nhóm.
 */
export function createUpdateMemberRetailKpi({ repository }) {
    return async function updateMemberRetailKpi({ employeeId, telegramGroupId, dailyKpiTarget }) {
        if (!employeeId || !telegramGroupId) {
            throw Object.assign(new Error('Thiếu thông tin employeeId hoặc telegramGroupId.'), { status: 400 });
        }

        let parsedTarget = null;
        if (dailyKpiTarget !== null && dailyKpiTarget !== undefined && dailyKpiTarget !== '') {
            parsedTarget = parseInt(dailyKpiTarget, 10);
            if (isNaN(parsedTarget) || parsedTarget <= 0) {
                throw Object.assign(new Error('Chỉ tiêu KPI phải là một số nguyên dương (> 0).'), { status: 400 });
            }
        }

        const result = await repository.upsertEmployeeKpi(employeeId, telegramGroupId, parsedTarget);
        return {
            success: true,
            employeeId,
            telegramGroupId,
            dailyKpiTarget: parsedTarget,
            isCustom: parsedTarget !== null,
            result
        };
    };
}

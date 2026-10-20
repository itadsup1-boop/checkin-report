/**
 * Use case: Lấy toàn bộ lịch sử các buổi đi làm và chi tiết check-in điểm bán của 1 nhân viên.
 */
export function createGetMemberRetailHistory({ repository }) {
    return async function getMemberRetailHistory({ employeeId, groupId, month = null }) {
        if (!employeeId || !groupId) {
            throw Object.assign(new Error('Thiếu thông tin employeeId hoặc groupId.'), { status: 400 });
        }

        const history = await repository.getEmployeeRetailHistory(employeeId, groupId, { month });
        if (!history) {
            throw Object.assign(new Error('Không tìm thấy thông tin nhân viên hoặc lịch sử đi tuyến.'), { status: 404 });
        }

        return history;
    };
}

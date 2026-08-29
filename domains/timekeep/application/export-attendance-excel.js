/**
 * Xuất Excel điểm danh một ngày cho Web Admin — mỗi nhân viên một dòng, kèm ca
 * làm, giờ vào/ra, trạng thái, số phút muộn, lý do và tiền phạt.
 */
function resolveShiftDisplay(userSchedule, groupSettings, telegramGroupId) {
    if (!userSchedule) return 'Không có ca';
    if (userSchedule.shift_type === 'OFF') return 'Nghỉ';

    const gs = groupSettings.find(g => g.telegram_group_id === telegramGroupId);
    const s1Start = gs?.shift_1_time ? gs.shift_1_time.substring(0, 5) : '08:00';
    const s2Start = gs?.shift_2_time ? gs.shift_2_time.substring(0, 5) : '13:30';

    if (['CA_1', 'CA_SANG', 'FULL_DAY'].includes(userSchedule.shift_type)) return `${s1Start}–17:30`;
    if (['CA_2', 'CA_CHIEU'].includes(userSchedule.shift_type)) return `${s2Start}–17:30`;
    if (userSchedule.shift_type === 'HALF_DAY_PM_WORK') return '13:30-17:30';
    return userSchedule.shift_type;
}

function buildRow(user, { schedules, checkins, penalties, leaveRequests, groupSettings, moment }) {
    const userSchedule = schedules.find(s => s.user_id === user.id);
    const userCheckins = checkins.filter(c => c.user_id === user.id);
    const userPenalties = penalties.filter(p => p.user_id === user.id);
    const userLeave = leaveRequests.find(l => l.user_id === user.id && (l.status === 'APPROVED' || l.status === 'approved'));

    const hasCheckin = userCheckins.length > 0;
    const isOffDay = userSchedule?.shift_type === 'OFF';
    const shiftDisplay = resolveShiftDisplay(userSchedule, groupSettings, user.telegram_group_id);

    let checkInDisplay = '';
    let checkOutDisplay = '';
    if (hasCheckin) {
        const sorted = [...userCheckins].sort((a, b) => new Date(a.check_in_time) - new Date(b.check_in_time));
        checkInDisplay = moment(sorted[0].check_in_time).utcOffset(7).format('HH:mm');
        if (sorted.length > 1) {
            checkOutDisplay = moment(sorted[sorted.length - 1].check_in_time).utcOffset(7).format('HH:mm');
        }
    }

    let status = 'Đạt';
    let lateMinutes = '';
    const reasonParts = [];

    if (isOffDay || !userSchedule) {
        status = 'Nghỉ';
        if (userLeave) reasonParts.push(userLeave.reason);
    } else if (hasCheckin) {
        const latePenalty = userPenalties.find(p => p.violation_type === 'LATE');
        if (latePenalty) {
            status = 'Đi muộn';
            lateMinutes = latePenalty.late_minutes || '';
        }
    } else if (userLeave) {
        status = 'Nghỉ có phép';
        reasonParts.push(userLeave.reason);
    } else {
        status = 'Nghỉ không phép';
    }

    const penaltyAmount = userPenalties.reduce((sum, p) => sum + Number(p.amount), 0);
    userPenalties.forEach(p => { if (p.reason) reasonParts.push(p.reason); });
    if (userLeave && !reasonParts.includes(userLeave.reason)) reasonParts.push(userLeave.reason);

    return {
        employee: user.full_name,
        groupName: user.group_name || '',
        shift: shiftDisplay,
        checkin: checkInDisplay,
        checkout: checkOutDisplay,
        status,
        lateMinutes,
        reason: reasonParts.filter(Boolean).join(', ') || '',
        penalty: penaltyAmount
    };
}

export function createExportAttendanceExcel({ repository, ExcelJS, moment }) {
    async function checkAccess({ adminId, adminRole, requestedGroupId }) {
        if (!adminId || !adminRole) {
            return { ok: false, status: 401, message: 'Thiếu thông tin xác thực admin' };
        }

        let allowedGroupIds = null;
        if (adminRole !== 'SUPER_ADMIN') {
            allowedGroupIds = await repository.findAllowedGroupIds(adminId);
        }

        if (requestedGroupId && allowedGroupIds !== null) {
            const canAccess = allowedGroupIds.some(groupId => String(groupId) === requestedGroupId);
            if (!canAccess) {
                return { ok: false, status: 403, message: 'Không có quyền xuất dữ liệu của nhóm này' };
            }
        }

        return { ok: true, exportGroupIds: requestedGroupId ? [requestedGroupId] : allowedGroupIds };
    }

    async function buildWorkbook(dateStr, exportGroupIds) {
        const users = await repository.findExportEmployees(exportGroupIds);
        const schedules = await repository.findSchedulesOfDate(dateStr);
        const { checkins, penalties, leaves: leaveRequests, settings: groupSettings } = await repository.exportRowsOfDay(dateStr);

        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Báo cáo điểm danh');
        ws.columns = [
            { header: 'Nhân viên', key: 'employee', width: 25 },
            { header: 'Tên nhóm', key: 'groupName', width: 25 },
            { header: 'Ca làm', key: 'shift', width: 20 },
            { header: 'Check-in', key: 'checkin', width: 12 },
            { header: 'Check-out', key: 'checkout', width: 12 },
            { header: 'Trạng thái', key: 'status', width: 18 },
            { header: 'Số phút muộn', key: 'lateMinutes', width: 15 },
            { header: 'Lý do', key: 'reason', width: 30 },
            { header: 'Tiền phạt', key: 'penalty', width: 15 }
        ];

        ws.getColumn('employee').alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getColumn('groupName').alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getColumn('shift').alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getColumn('checkin').alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getColumn('checkout').alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getColumn('status').alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getColumn('lateMinutes').alignment = { horizontal: 'right', vertical: 'middle' };
        ws.getColumn('reason').alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getColumn('penalty').alignment = { horizontal: 'right', vertical: 'middle' };
        ws.getColumn('penalty').numFmt = '#,##0';

        users.forEach(user => {
            ws.addRow(buildRow(user, { schedules, checkins, penalties, leaveRequests, groupSettings, moment }));
        });

        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 25;
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: users.length + 1, column: 9 } };

        return workbook;
    }

    async function exportAttendanceExcel({ dateStr, adminId, adminRole, requestedGroupId }) {
        const access = await checkAccess({ adminId, adminRole, requestedGroupId });
        if (!access.ok) return access;

        const workbook = await buildWorkbook(dateStr, access.exportGroupIds);
        const buffer = await workbook.xlsx.writeBuffer();
        return { ok: true, buffer };
    }

    return { exportAttendanceExcel };
}

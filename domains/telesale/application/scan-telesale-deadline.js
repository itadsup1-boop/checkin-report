/**
 * Use case: Quét hạn chót 19:00, đối chiếu lịch nghỉ OFF và áp phạt 50.000đ.
 */

import { buildTelesalePenaltyNotice } from '../domain/telesale-messages.js';

export function createScanTelesaleDeadline({
    telesaleRepository,
    telesaleSheetSync,
    bot,
    now = () => new Date()
}) {
    return async function scanTelesaleDeadline() {
        try {
            const currentDate = now();
            const vnDateObj = new Date(currentDate.getTime() + 7 * 3600 * 1000);
            const dateStr = vnDateObj.toISOString().split('T')[0];
            const dParts = dateStr.split('-');
            const displayDate = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}/${dParts[0]}` : dateStr;

            const groups = await telesaleRepository.findActiveTelesaleGroups();
            if (!groups || groups.length === 0) return;

            // Lấy danh sách ID nhân viên có lịch OFF hoặc đơn nghỉ hôm nay
            const offDutyIds = new Set(await telesaleRepository.findOffDutyEmployeeIds(dateStr));
            const onLeaveIds = new Set(await telesaleRepository.findOnLeaveEmployeeIds(dateStr));

            for (const g of groups) {
                const groupId = g.telegram_group_id;
                const members = await telesaleRepository.findMembersInTelesaleGroup(groupId);
                if (!members || members.length === 0) continue;

                const reportedIds = new Set(await telesaleRepository.findReportedEmployeeIds(groupId, dateStr));

                for (const member of members) {
                    // Đã nộp -> bỏ qua
                    if (reportedIds.has(member.id)) continue;

                    const effectiveEmpId = member.linked_employee_id || member.id;
                    const effectiveTgId = member.linked_telegram_id || member.telegram_id;

                    // Được nghỉ theo lịch OFF hoặc có đơn nghỉ phép -> bỏ qua
                    if (
                        offDutyIds.has(member.id) || onLeaveIds.has(member.id) ||
                        (effectiveEmpId && (offDutyIds.has(effectiveEmpId) || onLeaveIds.has(effectiveEmpId)))
                    ) {
                        console.log(`[Telesale] Nhân sự ${member.full_name} nghỉ ca OFF / có phép ngày ${dateStr}, miễn phạt.`);
                        continue;
                    }

                    // Kiểm tra hôm nay nhân sự có đi làm (có điểm danh) không
                    if (typeof telesaleRepository.hasEmployeeWorkedToday === 'function') {
                        const workedToday = await telesaleRepository.hasEmployeeWorkedToday({
                            employeeId: effectiveEmpId,
                            telegramId: effectiveTgId,
                            dateStr
                        });

                        if (!workedToday) {
                            console.log(`[Telesale] Nhân sự ${member.full_name} hôm nay không đi làm (không có điểm danh ngày ${dateStr}), miễn phạt.`);
                            continue;
                        }
                    }

                    // Vi phạm quá 19:00 không nộp -> Tạo phạt 50.000đ
                    const penalty = await telesaleRepository.createPenalty({
                        telegramGroupId: groupId,
                        employeeId: member.id,
                        dateStr,
                        amount: 50000,
                        reason: 'Chậm nộp báo cáo Telesale sau 19:00'
                    });

                    if (telesaleSheetSync && typeof telesaleSheetSync.syncPenalty === 'function') {
                        telesaleSheetSync.syncPenalty({
                            spreadsheetId: g.customer_sheet_id,
                            dateStr: displayDate,
                            employeeName: member.full_name,
                            penaltyAmount: 50000,
                            reason: 'Chậm nộp báo cáo Telesale sau 19:00',
                            recordedTimeStr: `${displayDate} 19:00:00`
                        }).catch(err => console.error('[Telesale Sheet Sync Penalty Err]:', err.message || err));
                    }

                    // Gửi tin thông báo phạt lên nhóm
                    if (bot && penalty) {
                        const notice = buildTelesalePenaltyNotice({
                            employeeName: member.full_name,
                            telegramId: effectiveTgId || member.telegram_id,
                            dateStr: displayDate,
                            penaltyAmount: 50000
                        });

                        await bot.telegram.sendMessage(groupId, notice, {
                            parse_mode: 'HTML'
                        }).catch(err => {
                            console.error(`[Telesale] Lỗi gửi thông báo phạt nhân sự ${member.full_name}:`, err.message);
                        });
                    }
                }
            }
        } catch (err) {
            console.error('[Telesale] Lỗi tiến trình quét hạn chót 19:00:', err.message || err);
        }
    };
}

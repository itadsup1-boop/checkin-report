/**
 * Quét mỗi phút: đúng giờ `remind_time_1` thì nhắc ai chưa nộp báo cáo; đúng
 * giờ đó + 2 tiếng (hết ân hạn) thì chốt sổ phạt và ghi lên Sheet. Chỉ áp dụng
 * nhóm role `report` (không áp dụng report_tour).
 */

import { findMissingReporters } from '../../domain/missing-reporters.js';

async function findMissing(reminderRepository, groupId, todayStr) {
    const [employees, reportedIds, offDutyIds, onLeaveIds] = await Promise.all([
        reminderRepository.findEmployeesNeedingReport(groupId),
        reminderRepository.findReportedTelegramIds(groupId, todayStr),
        reminderRepository.findOffDutyTelegramIds(todayStr),
        reminderRepository.findOnLeaveTelegramIds(todayStr)
    ]);
    return findMissingReporters(employees, { reportedIds, offDutyIds, onLeaveIds });
}

export function registerReminderCron({ cron, reminderRepository, sheetSync, sendMessageToRoleGroup, bot, isCompanyHoliday }) {
    return cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            const currentTimeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
            const todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().split('T')[0];
            const holiday = await isCompanyHoliday(todayStr);
            if (holiday) {
                console.log(`[Company Holiday] Bỏ qua nhắc và phạt KPI ngày ${todayStr}: ${holiday.name}`);
                return;
            }
            const groups = await reminderRepository.findActiveReportGroups();

            for (const group of groups) {
                // 1. Nhắc nhở nộp báo cáo
                const remindTime = group.remind_time_1 || '17:00:00';
                if (remindTime === currentTimeString) {
                    console.log(`⏰ Đến giờ nhắc nhở cho nhóm: ${group.group_name}`);
                    const missing = await findMissing(reminderRepository, group.telegram_group_id, todayStr);

                    if (missing.length > 0) {
                        const names = missing.map(m => m.full_name).join(', ');
                        await sendMessageToRoleGroup(bot, group.telegram_group_id, ['report', 'report_tour'], `⚠️ ĐÃ ĐẾN GIỜ BÁO CÁO KPI!\nDanh sách chưa nộp: ${names}\n⏰ Các bạn có đúng 2 tiếng nữa để nộp trước khi hệ thống chốt phạt tiền!`, {}, 'kpi_daily_reminder');
                    } else {
                        await sendMessageToRoleGroup(bot, group.telegram_group_id, ['report', 'report_tour'], `🎉 Tuyệt vời! Tất cả nhân sự đã nộp báo cáo đúng hạn ngày hôm nay.`, {}, 'kpi_all_reported');
                    }
                }

                // 2. Chốt sổ phạt sau deadline 2 tiếng
                if (group.remind_time_1) {
                    const [h, m] = group.remind_time_1.split(':').map(Number);
                    const penaltyDate = new Date();
                    penaltyDate.setHours(h, m + 120, 0, 0);
                    const penaltyTimeString = `${String(penaltyDate.getHours()).padStart(2, '0')}:${String(penaltyDate.getMinutes()).padStart(2, '0')}:00`;

                    if (currentTimeString === penaltyTimeString) {
                        const missing = await findMissing(reminderRepository, group.telegram_group_id, todayStr);

                        if (missing.length > 0) {
                            const parsedAmount = parseFloat(group.penalty_missing_report);
                            const amount = isNaN(parsedAmount) ? 100000 : parsedAmount;
                            const penaltyMsg = amount > 0 ? `\n💸 Phạt: -${amount.toLocaleString('vi-VN')}đ / người` : '';
                            const names = missing.map(m => m.full_name).join(', ');

                            await sendMessageToRoleGroup(bot, group.telegram_group_id, ['report', 'report_tour'], `⛔ ĐÃ HẾT THỜI GIAN ÂN HẠN!\nDanh sách KHÔNG nộp báo cáo: ${names}${penaltyMsg}\n📋 Hệ thống đã lưu vào sổ đen cuối tháng!`, {}, 'kpi_grace_period_expired');

                            await sheetSync.enqueueMissingReportRows(group.telegram_group_id, missing, amount);
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Lỗi Cron Job:', err);
        }
    });
}

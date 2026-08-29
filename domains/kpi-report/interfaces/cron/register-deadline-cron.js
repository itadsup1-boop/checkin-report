/**
 * Quét mỗi phút: dọn nháp của nhân viên đã vô hiệu hóa, rồi với mỗi báo cáo
 * đang chờ ảnh — chốt nợ ảnh nếu quá hạn, hoặc nhắc theo 3 mốc (còn 15 phút,
 * còn 5 phút, im lặng 5 phút sau khi nộp dở).
 */

import { parseReport } from '../../domain/report-parsing.js';
import { getEffectiveKpiTarget } from '../../domain/kpi-target.js';

export function registerDeadlineCron({
    cron, reportRepository, groupConfigRepository, finalizeReport,
    getEmployeeMembership, pool, sendMessageToRoleGroup, bot
}) {
    return cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();

            await reportRepository.deletePendingReportsForDeactivatedEmployees();
            const pending = await reportRepository.findActivePendingForDeadlineScan();

            for (const report of pending) {
                const deadline = new Date(report.deadline_at);
                const diffMinutes = Math.floor((deadline - now) / 60000);

                if (diffMinutes <= 0) {
                    const user = await getEmployeeMembership(pool, report.telegram_id, report.group_id, { activeOnly: true }) ||
                        { id: null, full_name: 'Nhân viên', employee_code: null, current_kpi_target: 40 };
                    const kpiTarget = getEffectiveKpiTarget(user);

                    const command_trigger = (await groupConfigRepository.findWorkflowTrigger(report.group_id)) || '#baocao';
                    const parsedJSON = parseReport(report.raw_text, command_trigger);

                    const debt_info = {
                        missing: report.required_photos - report.received_photos,
                        received: report.received_photos,
                        required: report.required_photos
                    };

                    await reportRepository.markPendingDoneWithDebt(report.telegram_id, report.group_id);
                    await finalizeReport(user, parsedJSON, kpiTarget, report.telegram_id, report.group_id, report.raw_text, bot, debt_info);
                } else if (diffMinutes <= 5 && report.last_reminder_stage < 2) {
                    const fullName = (await reportRepository.findEmployeeFullName(report.telegram_id)) || 'Nhân viên';
                    await reportRepository.markReminderStage(report.telegram_id, report.group_id, 2);
                    await sendMessageToRoleGroup(bot, report.group_id, ['report', 'report_tour'], `🚨 CẢNH BÁO CHÓT: ${fullName} ơi, còn đúng ${diffMinutes} phút nữa là hết hạn nộp ảnh! Bạn đang thiếu ${report.required_photos - report.received_photos} ảnh nữa.`, {}, 'photo_deadline_stage_2');
                } else if (diffMinutes <= 15 && report.last_reminder_stage < 1) {
                    const fullName = (await reportRepository.findEmployeeFullName(report.telegram_id)) || 'Nhân viên';
                    await reportRepository.markReminderStage(report.telegram_id, report.group_id, 1);
                    await sendMessageToRoleGroup(bot, report.group_id, ['report', 'report_tour'], `⚠️ Nhắc nhở: ${fullName} mới tải lên được ${report.received_photos}/${report.required_photos} ảnh. Bạn còn ${diffMinutes} phút để hoàn thành nhé.`, {}, 'photo_deadline_stage_1');
                } else if (report.received_photos > 0 && report.received_photos < report.required_photos && !report.inactivity_reminded && report.last_photo_received_at) {
                    const inactiveMinutes = Math.floor((now - new Date(report.last_photo_received_at)) / 60000);
                    if (inactiveMinutes >= 5) {
                        const fullName = (await reportRepository.findEmployeeFullName(report.telegram_id)) || 'Nhân viên';
                        await reportRepository.markInactivityReminded(report.telegram_id, report.group_id);
                        await sendMessageToRoleGroup(bot, report.group_id, ['report', 'report_tour'], `⚠️ Nhắc nhở: ${fullName} ơi, hệ thống đã ghi nhận ${report.received_photos}/${report.required_photos} ảnh. Còn thiếu ${report.required_photos - report.received_photos} ảnh nữa nhưng đã 5 phút không thấy bạn nộp thêm. Vui lòng gửi nốt để hoàn thành báo cáo nhé!`, {}, 'photo_inactivity_reminder');
                    }
                }
            }
        } catch (err) {
            console.error('Lỗi khi chạy Cronjob đếm giờ:', err);
        }
    });
}

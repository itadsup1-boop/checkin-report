/**
 * Use case: Gửi tin nhắc nộp báo cáo lúc 18:00 cho các nhóm Telesale.
 */

import crypto from 'node:crypto';
import { buildTelesaleReminderMessage } from '../domain/telesale-messages.js';

export function createSendTelesaleReminder({
    telesaleRepository,
    bot,
    now = () => new Date()
}) {
    return async function sendTelesaleReminder(targetGroupId = null, options = {}) {
        try {
            const currentDate = now();
            const vnDateObj = new Date(currentDate.getTime() + 7 * 3600 * 1000);
            const dateStr = vnDateObj.toISOString().split('T')[0];

            const groups = await telesaleRepository.findActiveTelesaleGroups();
            if (!groups || groups.length === 0) return { success: false, message: 'Không có nhóm Telesale nào đang hoạt động' };

            const targetGroups = targetGroupId
                ? groups.filter(g => String(g.telegram_group_id) === String(targetGroupId))
                : groups;

            if (targetGroups.length === 0) {
                return { success: false, message: 'Không tìm thấy nhóm Telesale yêu cầu' };
            }

            const results = [];

            for (const g of targetGroups) {
                const groupId = g.telegram_group_id;
                const members = await telesaleRepository.findMembersInTelesaleGroup(groupId);
                if (!members || members.length === 0) continue;

                const slotId = options.slotId || null;
                const reportedIds = new Set(await telesaleRepository.findReportedEmployeeIds(groupId, dateStr, slotId));

                // Lọc danh sách nhân sự ĐI LÀM HÔM NAY nhưng CHƯA NỘP BÁO CÁO (hoặc mốc slotId)
                const pendingWorkingStaff = [];
                for (const member of members) {
                    const effectiveEmpId = member.linked_employee_id || member.id;
                    const effectiveTgId = member.linked_telegram_id || member.telegram_id;

                    if (reportedIds.has(member.id) || (effectiveEmpId && reportedIds.has(effectiveEmpId))) continue;

                    let workedToday = true;
                    if (typeof telesaleRepository.hasEmployeeWorkedToday === 'function') {
                        workedToday = await telesaleRepository.hasEmployeeWorkedToday({
                            employeeId: effectiveEmpId,
                            telegramId: effectiveTgId,
                            dateStr
                        });
                    }

                    if (workedToday) {
                        pendingWorkingStaff.push(member);
                    }
                }

                // Nếu là nhắc nhở quá hạn (isOverdueReminder) mà không có ai nợ báo cáo (tất cả đã nộp), bỏ qua không gửi tin
                if (options.isOverdueReminder && pendingWorkingStaff.length === 0) {
                    console.log(`[Telesale] Tất cả nhân sự đã nộp báo cáo${slotId ? ` mốc ${slotId}` : ''}, bỏ qua nhắc nhở quá hạn.`);
                    results.push({
                        groupId,
                        groupName: g.group_name,
                        totalMembers: members.length,
                        reportedCount: reportedIds.size,
                        pendingWorkingCount: 0,
                        skipped: true
                    });
                    continue;
                }

                let formConfig = null;
                if (telesaleRepository.getFormConfig) {
                    try {
                        formConfig = await telesaleRepository.getFormConfig(groupId);
                    } catch (_) {}
                }

                const sched = formConfig?.schedule_settings || {};
                const effectiveDate = sched.rules_effective_date || sched.effective_from || null;
                if (effectiveDate && dateStr < effectiveDate) {
                    console.log(`[Telesale Reminder] Nhóm ${g.group_name || groupId} áp dụng luật từ ngày ${effectiveDate}, hôm nay là ${dateStr} nên bỏ qua nhắc nhở.`);
                    results.push({
                        groupId,
                        groupName: g.group_name,
                        skipped: true,
                        reason: `Chưa đến ngày áp dụng (${effectiveDate})`
                    });
                    continue;
                }

                const text = buildTelesaleReminderMessage({
                    groupName: g.group_name,
                    pendingStaff: pendingWorkingStaff,
                    fields: formConfig?.fields,
                    remindTime: options.remindTime || sched.remind_time || '18:00',
                    deadlineTime: options.deadlineTime || sched.deadline_time || '19:00',
                    penaltyAmount: options.penaltyAmount || sched.penalty_amount || 50000,
                    slotId: options.slotId,
                    slotLabel: options.slotLabel,
                    isOverdueReminder: Boolean(options.isOverdueReminder),
                    overdueHours: options.overdueHours || 1
                });

                const botUsername = bot?.botInfo?.username || process.env.BOT_USERNAME || 'baocao_kpi_adsup_bot';
                const appShortName = process.env.TELEGRAM_MINI_APP_SHORT_NAME || 'app';
                const token = process.env.TELEGRAM_BOT_TOKEN || '';
                const ts = Date.now();
                const dataString = `telesale:${groupId}:${ts}`;
                const sig = crypto.createHmac('sha256', token).update(dataString).digest('hex');
                const telesaleUrl = `https://t.me/${botUsername}/${appShortName}?startapp=telesale_${groupId}_${ts}_${sig}`;

                const reminderDedupKey = options.customDedupKey ||
                    (options.slotId
                        ? `reminder:${groupId}:${dateStr}:${options.slotId}:${options.isOverdueReminder ? 'overdue' : 'normal'}`
                        : (options.isOverdueReminder
                            ? `reminder:${groupId}:${dateStr}:overdue`
                            : `reminder:${groupId}:${dateStr}`));

                let canSendReminder = true;
                if (typeof telesaleRepository.acquireNotificationLock === 'function') {
                    const acquired = await telesaleRepository.acquireNotificationLock(reminderDedupKey);
                    if (!acquired) {
                        canSendReminder = false;
                        console.log(`[Telesale] Tin nhắc nhở nhóm ${groupId} ngày ${dateStr} key ${reminderDedupKey} đã được gửi trước đó, bỏ qua.`);
                    }
                }

                const buttonLabel = options.slotLabel || options.slotId
                    ? `⚡️ Điền Báo Cáo Mốc ${options.slotLabel || options.slotId}`
                    : '⚡️ Điền Báo Cáo Telesale';

                if (canSendReminder && bot?.telegram?.sendMessage) {
                    await bot.telegram.sendMessage(groupId, text, {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: buttonLabel, url: telesaleUrl }]
                            ]
                        }
                    }).catch(err => {
                        console.error(`[Telesale] Lỗi gửi nhắc nhở nhóm ${groupId}:`, err.message);
                    });
                }

                results.push({
                    groupId,
                    groupName: g.group_name,
                    totalMembers: members.length,
                    reportedCount: reportedIds.size,
                    pendingWorkingCount: pendingWorkingStaff.length
                });
            }

            return { success: true, results };
        } catch (err) {
            console.error('[Telesale] Lỗi tiến trình gửi nhắc nhở 18:00:', err.message || err);
            return { success: false, error: err.message || err };
        }
    };
}

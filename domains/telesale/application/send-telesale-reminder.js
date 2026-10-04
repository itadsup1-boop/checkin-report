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
    return async function sendTelesaleReminder(targetGroupId = null) {
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

                const reportedIds = new Set(await telesaleRepository.findReportedEmployeeIds(groupId, dateStr));

                // Lọc danh sách nhân sự ĐI LÀM HÔM NAY nhưng CHƯA NỘP BÁO CÁO
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

                let formConfig = null;
                if (telesaleRepository.getFormConfig) {
                    try {
                        formConfig = await telesaleRepository.getFormConfig(groupId);
                    } catch (_) {}
                }

                const sched = formConfig?.schedule_settings || {};
                const text = buildTelesaleReminderMessage({
                    groupName: g.group_name,
                    pendingStaff: pendingWorkingStaff,
                    fields: formConfig?.fields,
                    remindTime: sched.remind_time || '18:00',
                    deadlineTime: sched.deadline_time || '19:00',
                    penaltyAmount: sched.penalty_amount || 50000
                });

                const botUsername = bot?.botInfo?.username || process.env.BOT_USERNAME || 'baocao_kpi_adsup_bot';
                const appShortName = process.env.TELEGRAM_MINI_APP_SHORT_NAME || 'app';
                const token = process.env.TELEGRAM_BOT_TOKEN || '';
                const ts = Date.now();
                const dataString = `telesale:${groupId}:${ts}`;
                const sig = crypto.createHmac('sha256', token).update(dataString).digest('hex');
                const telesaleUrl = `https://t.me/${botUsername}/${appShortName}?startapp=telesale_${groupId}_${ts}_${sig}`;

                const reminderDedupKey = `reminder:${groupId}:${dateStr}`;
                let canSendReminder = true;
                if (typeof telesaleRepository.acquireNotificationLock === 'function') {
                    const acquired = await telesaleRepository.acquireNotificationLock(reminderDedupKey);
                    if (!acquired) {
                        canSendReminder = false;
                        console.log(`[Telesale] Tin nhắc nhở nhóm ${groupId} ngày ${dateStr} đã được gửi trước đó, bỏ qua.`);
                    }
                }

                if (canSendReminder && bot?.telegram?.sendMessage) {
                    await bot.telegram.sendMessage(groupId, text, {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⚡️ Điền Báo Cáo Telesale', url: telesaleUrl }]
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

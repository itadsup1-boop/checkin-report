/**
 * Đăng ký cron job tự động cho module Telesale:
 * - Hỗ trợ lập lịch linh hoạt theo từng nhóm (remind_time, deadline_time, summary_time).
 * - Fallback chuẩn: 18:00 nhắc nộp, 19:00 quét phạt 50k & gửi tổng kết ngày toàn đội.
 */

import { calculateLateRemindTime } from '../../domain/safe-formula-engine.js';

export const TELESALE_CRONS = {
    REMINDER_18H: '0 18 * * *',
    DEADLINE_19H: '0 19 * * *',
    DISPATCHER_TICK: '* * * * *'
};

export function registerTelesaleCrons({
    cron,
    telesaleRepository = null,
    sendTelesaleReminder,
    scanTelesaleDeadline,
    summarizeDailyTelesale,
    now = () => new Date()
}) {
    if (!cron) return [];

    // Fallback nếu không truyền telesaleRepository (ví dụ trong mock test đơn giản)
    if (!telesaleRepository) {
        const reminderJob = cron.schedule(TELESALE_CRONS.REMINDER_18H, async () => {
            console.log('[Telesale Cron] Kích hoạt nhắc nộp báo cáo lúc 18:00...');
            await sendTelesaleReminder();
        });

        const deadlineJob = cron.schedule(TELESALE_CRONS.DEADLINE_19H, async () => {
            console.log('[Telesale Cron] Kích hoạt quét hạn chót 19:00 và tổng kết ngày...');
            await scanTelesaleDeadline();
            await summarizeDailyTelesale();
        });

        return [reminderJob, deadlineJob];
    }

    // Dynamic Cron Dispatcher: Chạy mỗi phút 1 lần để quét đúng cấu hình giờ của từng nhóm
    const dispatcherJob = cron.schedule(TELESALE_CRONS.DISPATCHER_TICK, async () => {
        try {
            const currentDate = now();
            const vnDateObj = new Date(currentDate.getTime() + 7 * 3600 * 1000);
            const hours = String(vnDateObj.getUTCHours()).padStart(2, '0');
            const minutes = String(vnDateObj.getUTCMinutes()).padStart(2, '0');
            const currentTimeStr = `${hours}:${minutes}`;
            const dateStr = vnDateObj.toISOString().split('T')[0];

            const groups = await telesaleRepository.findActiveTelesaleGroups();
            if (!groups || groups.length === 0) return;

            for (const g of groups) {
                const groupId = g.telegram_group_id;
                let sched = null;
                let features = null;
                try {
                    const cfg = await telesaleRepository.getFormConfig(groupId);
                    sched = cfg?.schedule_settings || {};
                    features = cfg?.features || {};
                } catch (e) {
                    sched = {};
                    features = {};
                }

                // Kiểm tra ngày bắt đầu áp dụng luật báo cáo (effective_from / rules_effective_date)
                const effectiveDate = sched.rules_effective_date || sched.effective_from || null;
                if (effectiveDate && dateStr < effectiveDate) {
                    // Chưa đến ngày áp dụng luật (ví dụ: áp dụng từ ngày mai), bỏ qua nhóm này hôm nay
                    continue;
                }

                const isMultiSlot = (sched.schedule_mode || features.schedule_mode) === 'MULTI_SLOT';
                const overdueRemindEnabled = sched.overdue_remind_enabled ?? true;

                if (isMultiSlot && Array.isArray(sched.slots) && sched.slots.length > 0) {
                    for (const slot of sched.slots) {
                        const slotId = slot.id || slot.label;
                        const slotLabel = slot.label || slot.id;
                        const slotRemindTime = slot.remind_time;
                        const slotDeadlineTime = slot.deadline_time || (slotId.includes(':') ? slotId : `${slotId.replace(/\D/g, '').padStart(2, '0')}:00`);
                        const slotLateRemindTime = slot.late_remind_time || calculateLateRemindTime(slotDeadlineTime, 1);
                        const slotSummaryTime = slot.summary_time;
                        const slotPenaltyAmount = Number(slot.penalty_amount) || Number(sched.penalty_amount) || 50000;

                        // 1. Nhắc nhở trước hạn chót (nếu có cấu hình remind_time)
                        if ((sched.remind_enabled ?? true) && slotRemindTime && currentTimeStr === slotRemindTime) {
                            console.log(`[Telesale Dynamic Cron] Nhắc nộp trước hạn mốc ${slotLabel} nhóm ${g.group_name || groupId} lúc ${slotRemindTime}...`);
                            await sendTelesaleReminder(groupId, {
                                slotId,
                                slotLabel,
                                remindTime: slotRemindTime,
                                deadlineTime: slotDeadlineTime,
                                isOverdueReminder: false
                            });
                        }

                        // 2. Nhắc nhở sau 1h kể từ khung giờ set nếu chưa báo cáo
                        if (overdueRemindEnabled && slotLateRemindTime && currentTimeStr === slotLateRemindTime) {
                            console.log(`[Telesale Dynamic Cron] Nhắc nộp quá hạn 1h mốc ${slotLabel} nhóm ${g.group_name || groupId} lúc ${slotLateRemindTime}...`);
                            await sendTelesaleReminder(groupId, {
                                slotId,
                                slotLabel,
                                deadlineTime: slotDeadlineTime,
                                remindTime: slotLateRemindTime,
                                isOverdueReminder: true,
                                overdueHours: 1
                            });
                        }

                        // 3. Quét hạn chót và áp phạt
                        if ((sched.penalty_enabled ?? true) && slotDeadlineTime && currentTimeStr === slotDeadlineTime) {
                            console.log(`[Telesale Dynamic Cron] Quét hạn chót mốc ${slotLabel} nhóm ${g.group_name || groupId} lúc ${slotDeadlineTime}...`);
                            await scanTelesaleDeadline(groupId, slotPenaltyAmount, { slotId });
                        }

                        // 4. Tổng kết theo mốc giờ
                        if ((sched.summary_enabled ?? true) && slotSummaryTime && currentTimeStr === slotSummaryTime) {
                            console.log(`[Telesale Dynamic Cron] Tổng kết mốc ${slotLabel} nhóm ${g.group_name || groupId} lúc ${slotSummaryTime}...`);
                            await summarizeDailyTelesale(groupId, sched.summary_fields, { slotId });
                        }
                    }

                    // Cuối ngày: Tổng kết toàn đội (nếu bật)
                    const dailyFinalSummaryTime = sched.daily_final_summary_time || sched.summary_time || '19:00';
                    if ((sched.daily_final_summary_enabled ?? true) && currentTimeStr === dailyFinalSummaryTime) {
                        console.log(`[Telesale Dynamic Cron] Tổng kết cuối ngày nhóm ${g.group_name || groupId} lúc ${dailyFinalSummaryTime}...`);
                        await summarizeDailyTelesale(groupId, sched.summary_fields, { isFinalDailySummary: true });
                    }
                } else {
                    const remindEnabled = sched.remind_enabled ?? true;
                    const remindTime = sched.remind_time || '18:00';

                    const penaltyEnabled = sched.penalty_enabled ?? true;
                    const deadlineTime = sched.deadline_time || '19:00';
                    const penaltyAmount = Number(sched.penalty_amount) || 50000;

                    const summaryEnabled = sched.summary_enabled ?? true;
                    const summaryTime = sched.summary_time || '19:00';
                    const summaryFields = sched.summary_fields || null;

                    const lateRemindTime = sched.late_remind_time || calculateLateRemindTime(deadlineTime, 1);

                    // 1. Nhắc nhở trước hạn chót
                    if (remindEnabled && currentTimeStr === remindTime) {
                        console.log(`[Telesale Dynamic Cron] Kích hoạt nhắc nộp nhóm ${g.group_name || groupId} lúc ${remindTime}...`);
                        await sendTelesaleReminder(groupId);
                    }

                    // 2. Nhắc nhở sau 1h kể từ hạn chót nếu chưa nộp
                    if (overdueRemindEnabled && lateRemindTime && currentTimeStr === lateRemindTime) {
                        console.log(`[Telesale Dynamic Cron] Kích hoạt nhắc nộp quá hạn 1h nhóm ${g.group_name || groupId} lúc ${lateRemindTime}...`);
                        await sendTelesaleReminder(groupId, {
                            deadlineTime,
                            remindTime: lateRemindTime,
                            isOverdueReminder: true,
                            overdueHours: 1
                        });
                    }

                    // 3. Quét hạn chót và áp phạt
                    if (penaltyEnabled && currentTimeStr === deadlineTime) {
                        console.log(`[Telesale Dynamic Cron] Kích hoạt quét hạn chót nhóm ${g.group_name || groupId} lúc ${deadlineTime}...`);
                        await scanTelesaleDeadline(groupId, penaltyAmount);
                    }

                    // 4. Tổng kết toàn đội
                    if (summaryEnabled && currentTimeStr === summaryTime) {
                        console.log(`[Telesale Dynamic Cron] Kích hoạt tổng kết ngày nhóm ${g.group_name || groupId} lúc ${summaryTime}...`);
                        await summarizeDailyTelesale(groupId, summaryFields);
                    }
                }
            }
        } catch (err) {
            console.error('[Telesale Dynamic Cron Dispatcher Error]:', err.message || err);
        }
    });

    return [dispatcherJob];
}

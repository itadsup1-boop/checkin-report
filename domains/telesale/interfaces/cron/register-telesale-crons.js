/**
 * Đăng ký cron job tự động cho module Telesale:
 * - Hỗ trợ lập lịch linh hoạt theo từng nhóm (remind_time, deadline_time, summary_time).
 * - Fallback chuẩn: 18:00 nhắc nộp, 19:00 quét phạt 50k & gửi tổng kết ngày toàn đội.
 */

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

            const groups = await telesaleRepository.findActiveTelesaleGroups();
            if (!groups || groups.length === 0) return;

            for (const g of groups) {
                const groupId = g.telegram_group_id;
                let sched = null;
                try {
                    const cfg = await telesaleRepository.getFormConfig(groupId);
                    sched = cfg?.schedule_settings || {};
                } catch (e) {
                    sched = {};
                }

                const remindEnabled = sched.remind_enabled ?? true;
                const remindTime = sched.remind_time || '18:00';

                const penaltyEnabled = sched.penalty_enabled ?? true;
                const deadlineTime = sched.deadline_time || '19:00';
                const penaltyAmount = Number(sched.penalty_amount) || 50000;

                const summaryEnabled = sched.summary_enabled ?? true;
                const summaryTime = sched.summary_time || '19:00';
                const summaryFields = sched.summary_fields || null;

                // 1. Nhắc nhở
                if (remindEnabled && currentTimeStr === remindTime) {
                    console.log(`[Telesale Dynamic Cron] Kích hoạt nhắc nộp nhóm ${g.group_name || groupId} lúc ${remindTime}...`);
                    await sendTelesaleReminder(groupId);
                }

                // 2. Quét hạn chót và áp phạt
                if (penaltyEnabled && currentTimeStr === deadlineTime) {
                    console.log(`[Telesale Dynamic Cron] Kích hoạt quét hạn chót nhóm ${g.group_name || groupId} lúc ${deadlineTime}...`);
                    await scanTelesaleDeadline(groupId, penaltyAmount);
                }

                // 3. Tổng kết toàn đội
                if (summaryEnabled && currentTimeStr === summaryTime) {
                    console.log(`[Telesale Dynamic Cron] Kích hoạt tổng kết ngày nhóm ${g.group_name || groupId} lúc ${summaryTime}...`);
                    await summarizeDailyTelesale(groupId, summaryFields);
                }
            }
        } catch (err) {
            console.error('[Telesale Dynamic Cron Dispatcher Error]:', err.message || err);
        }
    });

    return [dispatcherJob];
}

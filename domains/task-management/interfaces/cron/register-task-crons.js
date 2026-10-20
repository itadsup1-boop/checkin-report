/**
 * Cron + worker của module quản lý & giao việc:
 * - Outbox worker: gửi tin nhắn trong notification_outbox mỗi 30 giây
 *   (setInterval thay vì cron phút vì các luồng nút bấm cần phản hồi nhanh).
 * - Cron nhắc việc: chưa nhận 15', sắp hạn 30', quá hạn, nhắc hàng ngày sau
 *   check-in, tổng hợp cuối ngày 18:00 — giờ VN.
 */

export const TASK_CRONS = {
    OUTBOX_TICK_MS: 30 * 1000,
    OUTBOX_BATCH: 10,
    NOT_ACCEPTED: '*/5 * * * *',
    DUE_SOON: '*/5 * * * *',
    OVERDUE: '*/10 * * * *',
    DAILY_REMINDER: '*/10 * * * *',
    EOD_SUMMARY: '0 18 * * *',
    ATTENDANCE_REPORT: '* * * * *',
    FORM_DUE_SOON: '*/15 * * * *',
    FORM_OVERDUE: '*/15 * * * *'
};

const BACKOFF_MINUTES = [1, 5, 15, 60];

export function createOutboxWorker({ bot, taskRepository, tickMs = TASK_CRONS.OUTBOX_TICK_MS, directMessageRepository = null }) {
    let sending = false;
    let timer = null;

    async function tick() {
        if (sending) return;
        sending = true;
        try {
            const rows = await taskRepository.claimOutboxBatch(TASK_CRONS.OUTBOX_BATCH);
            for (const row of rows) {
                await deliver(row);
            }
        } catch (error) {
            console.error('[TaskManagement Outbox] Lỗi worker:', error.message);
        } finally {
            sending = false;
        }
    }

    async function deliver(row) {
        let replyMarkup = row.reply_markup;
        if (typeof replyMarkup === 'string') {
            try { replyMarkup = JSON.parse(replyMarkup); } catch { replyMarkup = null; }
        }
        try {
            const sent = await bot.telegram.sendMessage(
                row.chat_id, row.text,
                replyMarkup ? { reply_markup: replyMarkup } : undefined
            );
            await taskRepository.markOutboxSent(row.id);
            const meta = row.link_meta;
            if (meta?.taskId && sent?.message_id) {
                await taskRepository.saveMessageLink({
                    chatId: row.chat_id,
                    messageId: sent.message_id,
                    taskId: meta.taskId,
                    assigneeId: meta.assigneeId ?? null,
                    direction: meta.direction
                }).catch(err => console.error('[TaskManagement Outbox] Lưu message link lỗi:', err.message));
            }
            if (meta?.directMessageLogId && sent?.message_id && directMessageRepository) {
                await directMessageRepository.markDirectMessageSent(meta.directMessageLogId, sent.message_id)
                    .catch(err => console.error('[TaskManagement Outbox] Cập nhật nhật ký gửi tin lỗi:', err.message));
            }
        } catch (error) {
            // attempt_count đã được claimOutboxBatch tăng trước khi trả về
            const attempt = Number(row.attempt_count) || 1;
            const retry = attempt <= BACKOFF_MINUTES.length;
            await taskRepository.markOutboxFailed(row.id, {
                error: error.message || String(error),
                retry,
                backoffMinutes: retry ? BACKOFF_MINUTES[attempt - 1] : 0
            });
            console.error(`[TaskManagement Outbox] Gửi lỗi outbox #${row.id} (lần ${attempt}):`, error.message);
        }
    }

    function start() {
        if (timer) return;
        timer = setInterval(tick, tickMs);
        timer.unref?.();
        tick();
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    return { tick, start, stop };
}

export function registerTaskCrons({ cron, bot, taskService, taskRepository, formService = null, directMessageRepository = null, outboxWorker = null, attendanceReportService = null }) {
    if (!cron) return [];

    const worker = outboxWorker || createOutboxWorker({ bot, taskRepository, directMessageRepository });
    worker.start();

    const every = (expr, name, fn) => cron.schedule(expr, async () => {
        try {
            await fn();
        } catch (error) {
            console.error(`[TaskManagement Cron] ${name}:`, error.message);
        }
    }, { timezone: 'Asia/Ho_Chi_Minh' });

    const schedules = [
        every(TASK_CRONS.NOT_ACCEPTED, 'Nhắc chưa nhận việc', () => taskService.processNotAcceptedReminders()),
        every(TASK_CRONS.DUE_SOON, 'Nhắc sắp đến hạn', () => taskService.processDueSoonReminders()),
        every(TASK_CRONS.OVERDUE, 'Nhắc quá hạn', () => taskService.processOverdueReminders()),
        every(TASK_CRONS.DAILY_REMINDER, 'Nhắc hàng ngày sau check-in', () => taskService.processDailyReminders()),
        every(TASK_CRONS.EOD_SUMMARY, 'Tổng hợp cuối ngày', () => taskService.sendEodSummaries())
    ];
    if (attendanceReportService) {
        schedules.push(every(TASK_CRONS.ATTENDANCE_REPORT, 'Báo cáo chấm công định kỳ', () => attendanceReportService.runScheduledReports()));
    }
    if (formService) {
        schedules.push(
            every(TASK_CRONS.FORM_DUE_SOON, 'Nhắc form sắp đến hạn', () => formService.remindDueSoonForms()),
            every(TASK_CRONS.FORM_OVERDUE, 'Nhắc form quá hạn', () => formService.remindOverdueForms())
        );
    }
    return schedules;
}

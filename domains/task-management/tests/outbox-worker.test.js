import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutboxWorker, registerTaskCrons, TASK_CRONS } from '../interfaces/cron/register-task-crons.js';

function createMockBot(sent = null) {
    const calls = [];
    return {
        calls,
        telegram: {
            async sendMessage(chatId, text, extra) {
                calls.push({ chatId, text, extra });
                if (sent) return sent(chatId, text, extra);
                return { message_id: 42 };
            }
        }
    };
}

function createMockRepo(rows) {
    const calls = { sent: [], failed: [], links: [] };
    return {
        calls,
        async claimOutboxBatch() { return rows; },
        async markOutboxSent(id) { calls.sent.push(id); },
        async markOutboxFailed(id, info) { calls.failed.push({ id, ...info }); },
        async saveMessageLink(link) { calls.links.push(link); }
    };
}

const BASE_ROW = {
    id: 1, chat_id: '111', text: 'xin chào', attempt_count: 1,
    reply_markup: null, link_meta: null
};

test('outbox worker: gửi tin, đánh dấu SENT và lưu message link từ link_meta', async () => {
    const bot = createMockBot();
    const repo = createMockRepo([{
        ...BASE_ROW,
        link_meta: { taskId: 't-1', assigneeId: 7, direction: 'EMPLOYEE_TASK' }
    }]);
    const worker = createOutboxWorker({ bot, taskRepository: repo });

    await worker.tick();

    assert.deepEqual(bot.calls, [{ chatId: '111', text: 'xin chào', extra: undefined }]);
    assert.deepEqual(repo.calls.sent, [1]);
    assert.deepEqual(repo.calls.links, [{
        chatId: '111', messageId: 42, taskId: 't-1', assigneeId: 7, direction: 'EMPLOYEE_TASK'
    }]);
});

test('outbox worker: reply_markup dạng chuỗi được parse trước khi gửi', async () => {
    const bot = createMockBot();
    const repo = createMockRepo([{
        ...BASE_ROW,
        reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'OK', callback_data: 'x' }]] })
    }]);
    const worker = createOutboxWorker({ bot, taskRepository: repo });

    await worker.tick();

    assert.deepEqual(bot.calls[0].extra.reply_markup.inline_keyboard[0][0].callback_data, 'x');
});

test('outbox worker: lỗi lần 1 → thử lại sau 1 phút, không lưu link', async () => {
    const bot = createMockBot(() => { throw new Error('Forbidden: bot was blocked'); });
    const repo = createMockRepo([{ ...BASE_ROW, attempt_count: 1 }]);
    const worker = createOutboxWorker({ bot, taskRepository: repo });

    await worker.tick();

    assert.deepEqual(repo.calls.sent, []);
    assert.equal(repo.calls.failed.length, 1);
    assert.equal(repo.calls.failed[0].retry, true);
    assert.equal(repo.calls.failed[0].backoffMinutes, 1);
    assert.match(repo.calls.failed[0].error, /blocked/);
    assert.deepEqual(repo.calls.links, []);
});

test('outbox worker: lỗi lần 5 → hẳn FAILED, không retry nữa', async () => {
    const bot = createMockBot(() => { throw new Error('still failing'); });
    const repo = createMockRepo([{ ...BASE_ROW, attempt_count: 5 }]);
    const worker = createOutboxWorker({ bot, taskRepository: repo });

    await worker.tick();

    assert.equal(repo.calls.failed[0].retry, false);
    assert.equal(repo.calls.failed[0].backoffMinutes, 0);
});

test('hằng số cron: giờ VN, tổng hợp cuối ngày 18:00, worker tick 30 giây', () => {
    assert.equal(TASK_CRONS.EOD_SUMMARY, '0 18 * * *');
    assert.equal(TASK_CRONS.OUTBOX_TICK_MS, 30 * 1000);
    assert.equal(TASK_CRONS.DAILY_REMINDER, '*/10 * * * *');
    assert.equal(TASK_CRONS.FORM_DUE_SOON, '*/15 * * * *');
    assert.equal(TASK_CRONS.FORM_OVERDUE, '*/15 * * * *');
});

function createFakeCron() {
    const jobs = [];
    return { jobs, schedule(expr, fn) { jobs.push({ expr, fn }); return { stop() {} }; } };
}

test('registerTaskCrons: 5 cron nhiệm vụ, có form thì thêm 2 cron nhắc form', () => {
    const taskService = { processNotAcceptedReminders() {}, processDueSoonReminders() {}, processOverdueReminders() {}, processDailyReminders() {}, sendEodSummaries() {} };
    const formService = { remindDueSoonForms() {}, remindOverdueForms() {} };

    const cronWithoutForm = createFakeCron();
    registerTaskCrons({ cron: cronWithoutForm, bot: createMockBot(), taskService, taskRepository: createMockRepo([]) });
    assert.equal(cronWithoutForm.jobs.length, 5);

    const cronWithForm = createFakeCron();
    registerTaskCrons({ cron: cronWithForm, bot: createMockBot(), taskService, taskRepository: createMockRepo([]), formService });
    assert.equal(cronWithForm.jobs.length, 7);
    assert.ok(cronWithForm.jobs.every(j => j.expr === '*/5 * * * *' || j.expr === '*/10 * * * *' || j.expr === '0 18 * * *' || j.expr === TASK_CRONS.FORM_DUE_SOON || j.expr === TASK_CRONS.FORM_OVERDUE));
});

test('registerTaskCrons: cron null → không đăng ký gì, không khởi động worker', () => {
    const result = registerTaskCrons({ cron: null, bot: createMockBot(), taskService: {}, taskRepository: createMockRepo([]) });
    assert.deepEqual(result, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    registerTaskHandlers, parseGiaoCommand, parseDeadlineVi
} from '../interfaces/telegram/register-task-handlers.js';
import { formatVnTime } from '../application/task-service.js';

function createBotHarness() {
    const commands = new Map();
    const actions = [];
    const messageHandlers = [];
    const bot = {
        command(name, handler) { commands.set(name, handler); },
        action(re, handler) { actions.push({ re, handler }); },
        on(event, handler) { if (event === 'message') messageHandlers.push(handler); }
    };
    return {
        bot,
        runCommand: (name, ctx) => {
            ctx.nextCalled = false;
            return commands.get(name)?.(ctx, async () => { ctx.nextCalled = true; });
        },
        runAction: async (data, ctx) => {
            for (const { re, handler } of actions) {
                const m = re.exec(data);
                if (m) { ctx.match = m; return handler(ctx); }
            }
            throw new Error(`Không có action khớp: ${data}`);
        },
        runMessage: (ctx) => {
            ctx.nextCalled = false;
            return messageHandlers[0]?.(ctx, async () => { ctx.nextCalled = true; });
        }
    };
}

function createCtx({ text = '', fromId = 999, chatId = 999, chatType = 'private', replyTo = null } = {}) {
    const recorded = { replies: [], edits: [], replyMarkups: [], cbAnswers: [] };
    const ctx = {
        chat: { type: chatType, id: chatId },
        from: { id: fromId },
        message: { text, message_id: 10, reply_to_message: replyTo },
        match: null, nextCalled: false,
        reply: async (t, extra) => { recorded.replies.push({ text: t, extra }); },
        editMessageText: async (t) => { recorded.edits.push(t); },
        editMessageReplyMarkup: async (markup) => { recorded.replyMarkups.push(markup); },
        answerCbQuery: async (t, extra) => { recorded.cbAnswers.push({ text: t, extra }); }
    };
    ctx.recorded = recorded;
    return ctx;
}

function createMocks() {
    const calls = { createTask: [], assertAssignee: [], acceptTask: [], declineTask: [], completeTask: [], saveEmployeeComment: [], saveManagerComment: [], reviewReject: [], cancelTask: [], decideExtend: [] };
    const taskService = {
        async createTask(input) { calls.createTask.push(input); return { duplicated: false, task: { display_code: 105 } }; },
        async assertAssignee(input) { calls.assertAssignee.push(input); },
        async acceptTask(input) { calls.acceptTask.push(input); },
        async declineTask(input) { calls.declineTask.push(input); },
        async completeTask(input) { calls.completeTask.push(input); },
        async saveEmployeeComment(input) { calls.saveEmployeeComment.push(input); },
        async saveManagerComment(input) { calls.saveManagerComment.push(input); },
        async reviewReject(input) { calls.reviewReject.push(input); },
        async cancelTask(input) { calls.cancelTask.push(input); },
        async decideExtend(input) { calls.decideExtend.push(input); },
        async reviewApprove() {},
        async requestExtend() {},
        async listOpenForManager() { return []; }
    };
    const taskRepository = {
        async findEmployeesByCodes(codes) {
            const book = {
                NV001: { id: 'e1', employee_code: 'NV001', full_name: 'Nguyễn Văn A', telegram_id: '111' },
                NV002: { id: 'e2', employee_code: 'NV002', full_name: 'Trần B', telegram_id: null }
            };
            return codes.map(c => book[c]).filter(Boolean);
        },
        async findMessageLink(chatId, messageId) {
            return messageId === 55
                ? { task_id: 't-1', assignee_id: 7, direction: 'EMPLOYEE_TASK', display_code: 105 }
                : messageId === 66
                    ? { task_id: 't-2', assignee_id: 8, direction: 'MANAGER_REVIEW', display_code: 106 }
                    : null;
        }
    };
    return { calls, taskService, taskRepository };
}

function register(harness, mocks) {
    registerTaskHandlers({ bot: harness.bot, taskService: mocks.taskService, taskRepository: mocks.taskRepository });
}

const FIXED_NOW = new Date('2026-10-19T10:00:00+07:00');

test('parseGiaoCommand: đọc mã, nội dung, giờ và cờ', () => {
    const parsed = parseGiaoCommand('/giao nv001, nv002 | Gọi lại 20 khách | 17:30 daily !cao');
    assert.deepEqual(parsed, {
        codes: ['NV001', 'NV002'], title: 'Gọi lại 20 khách',
        dueInput: '17:30', reminderMode: 'DAILY_AFTER_CHECKIN', priority: 'HIGH'
    });
});

test('parseGiaoCommand: thiếu phần hoặc cờ lạ báo lỗi rõ ràng', () => {
    assert.match(parseGiaoCommand('/giao NV001 | chỉ có tiêu đề').error, /Cú pháp/);
    assert.match(parseGiaoCommand('/giao NV001 | tiêu đề | 17:30 !sai').error, /Cờ không rõ/);
});

test('parseDeadlineVi: giờ trễ hơn hiện tại dời sang mai, chấp nhận DD/MM', () => {
    const today1730 = parseDeadlineVi('17:30', FIXED_NOW);
    assert.equal(today1730.toISOString(), new Date('2026-10-19T17:30:00+07:00').toISOString());

    const tomorrow900 = parseDeadlineVi('9:00', FIXED_NOW);
    assert.equal(tomorrow900.toISOString(), new Date('2026-10-20T09:00:00+07:00').toISOString());

    const dated = parseDeadlineVi('8:00 25/10', FIXED_NOW);
    assert.equal(dated.toISOString(), new Date('2026-10-25T08:00:00+07:00').toISOString());

    assert.equal(parseDeadlineVi('25h', FIXED_NOW), null);
    assert.equal(parseDeadlineVi('25:00', FIXED_NOW), null);
});

test('/giao: tạo bản nháp có nút xác nhận, nhân viên không có Telegram bị bỏ qua', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);
    const ctx = createCtx({ text: '/giao NV001,NV002 | Gọi khách | 17:30', fromId: 999 });
    await harness.runCommand('giao', ctx);

    const preview = ctx.recorded.replies[0];
    assert.match(preview.text, /NV001 — Nguyễn Văn A/);
    assert.match(preview.text, /Bỏ qua \(không có Telegram\): NV002/);
    assert.match(preview.text, new RegExp(`⏰ Deadline: ${formatVnTime(parseDeadlineVi('17:30'))}`));
    assert.match(preview.extra.reply_markup.inline_keyboard[0][0].callback_data, /^tmgr:ok:[a-f0-9]+$/);
});

test('/giao: mã không tồn tại thì từ chối trước khi tạo bản nháp', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);
    const ctx = createCtx({ text: '/giao NV999 | Gọi khách | 17:30' });
    await harness.runCommand('giao', ctx);
    assert.match(ctx.recorded.replies[0].text, /NV999/);
    assert.equal(mocks.calls.createTask.length, 0);
});

test('bấm Giao: gọi createTask đủ tham số và sửa tin thành kết quả', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);
    const ctx = createCtx({ text: '/giao NV001 | Gọi khách | 17:30', fromId: 999 });
    await harness.runCommand('giao', ctx);
    const draftId = ctx.recorded.replies[0].extra.reply_markup.inline_keyboard[0][0].callback_data.split(':')[2];

    const cbCtx = createCtx({ fromId: 999 });
    await harness.runAction(`tmgr:ok:${draftId}`, cbCtx);
    assert.equal(mocks.calls.createTask.length, 1);
    assert.equal(mocks.calls.createTask[0].createdBy, '999');
    assert.equal(mocks.calls.createTask[0].idempotencyKey, `giao:999:${draftId}`);
    assert.equal(mocks.calls.createTask[0].assignees[0].telegramUserId, '111');
    assert.match(cbCtx.recorded.edits[0], /#T-105 cho 1 người/);

    const again = createCtx({ fromId: 999 });
    await harness.runAction(`tmgr:ok:${draftId}`, again);
    assert.equal(mocks.calls.createTask.length, 1); // bản nháp đã xóa, không giao trùng
});

test('nút nhận việc: đúng tham số, lỗi service hiện alert', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    mocks.taskService.acceptTask = async (input) => {
        mocks.calls.acceptTask.push(input);
        const e = new Error('Nhiệm vụ này không ở trạng thái chờ nhận.');
        e.code = 'WRONG_STATE';
        throw e;
    };
    register(harness, mocks);

    const ctx = createCtx({ fromId: 111 });
    await harness.runAction('task:accept:105', ctx);
    assert.deepEqual(mocks.calls.acceptTask, [{ displayCode: '105', telegramUserId: '111' }]);
    assert.equal(ctx.recorded.cbAnswers[0].extra.show_alert, true);
});

test('nhận việc: đổi nút sang phản hồi/hoàn thành; không nhận thì nhập lý do', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const acceptCtx = createCtx({ fromId: 111 });
    await harness.runAction('task:accept:105', acceptCtx);
    assert.deepEqual(acceptCtx.recorded.replyMarkups[0].inline_keyboard[0].map(button => button.text), ['💬 Phản hồi', '✔ Hoàn thành']);

    const declineCtx = createCtx({ fromId: 222, chatType: 'group', chatId: -10 });
    await harness.runAction('task:decline:105', declineCtx);
    assert.match(declineCtx.recorded.replies[0].text, /Vì sao bạn không nhận/);
    const reasonCtx = createCtx({ fromId: 222, chatType: 'group', chatId: -10, text: 'Đang nghỉ phép' });
    await harness.runMessage(reasonCtx);
    assert.deepEqual(mocks.calls.declineTask, [{ displayCode: '105', telegramUserId: '222', reason: 'Đang nghỉ phép' }]);
    assert.equal(reasonCtx.nextCalled, false);
});

test('luồng phản hồi: nút → tin nhắn → saveEmployeeComment và dừng chuỗi', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const actionCtx = createCtx({ fromId: 111 });
    await harness.runAction('task:comment:105', actionCtx);
    assert.match(actionCtx.recorded.replies[0].text, /Nhập nội dung phản hồi/);

    const msgCtx = createCtx({ fromId: 111, text: 'Đã gọi 15/20 khách' });
    await harness.runMessage(msgCtx);
    assert.deepEqual(mocks.calls.saveEmployeeComment[0], {
        displayCode: '105', telegramUserId: '111', text: 'Đã gọi 15/20 khách'
    });
    assert.equal(msgCtx.nextCalled, false);
});

test('luồng chưa đạt: nút review_no → feedback text → reviewReject', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    await harness.runAction('task:review_no:105:7', createCtx({ fromId: 999 }));
    const msgCtx = createCtx({ fromId: 999, text: 'Thiếu danh sách khách lạnh' });
    await harness.runMessage(msgCtx);
    assert.deepEqual(mocks.calls.reviewReject[0], {
        displayCode: '105', assigneeId: '7', managerId: '999', feedback: 'Thiếu danh sách khách lạnh'
    });
});

test('reply vào tin nhiệm vụ: nhân viên thành comment, người giao thành trả lời', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const employeeCtx = createCtx({
        fromId: 111, chatId: 111, text: 'Khách hẹn lại mai',
        replyTo: { message_id: 55 }
    });
    await harness.runMessage(employeeCtx);
    assert.deepEqual(mocks.calls.saveEmployeeComment[0], {
        displayCode: 105, telegramUserId: '111', text: 'Khách hẹn lại mai'
    });

    const managerCtx = createCtx({
        fromId: 999, chatId: 999, text: 'Gọi thêm nhóm khách lạnh',
        replyTo: { message_id: 66 }
    });
    await harness.runMessage(managerCtx);
    assert.deepEqual(mocks.calls.saveManagerComment[0], {
        taskId: 't-2', assigneeId: 8, managerId: '999', text: 'Gọi thêm nhóm khách lạnh'
    });
});

test('tin nhắn thường không liên quan thì đi tiếp chuỗi', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);
    const ctx = createCtx({ fromId: 555, text: 'hello bot' });
    await harness.runMessage(ctx);
    assert.equal(ctx.nextCalled, true);
});

test('/huytask: đọc mã và lý do rồi gọi cancelTask', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);
    const ctx = createCtx({ text: '/huytask #T-101 Đổi kế hoạch', fromId: 999 });
    await harness.runCommand('huytask', ctx);
    assert.deepEqual(mocks.calls.cancelTask[0], { displayCode: '101', managerId: '999', reason: 'Đổi kế hoạch' });
    assert.match(ctx.recorded.replies[0].text, /Đã hủy/);
});

test('/huy xóa trạng thái đang dở và nhường chain', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);
    await harness.runAction('task:comment:105', createCtx({ fromId: 111 }));
    const huyCtx = createCtx({ fromId: 111, text: '/huy' });
    await harness.runCommand('huy', huyCtx);
    assert.equal(huyCtx.nextCalled, true);
    const ctx = createCtx({ fromId: 111, text: 'tin nhắn sau khi hủy' });
    await harness.runMessage(ctx);
    assert.equal(mocks.calls.saveEmployeeComment.length, 0);
    assert.equal(ctx.nextCalled, true);
});

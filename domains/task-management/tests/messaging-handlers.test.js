import test from 'node:test';
import assert from 'node:assert/strict';
import { registerMessagingHandlers } from '../interfaces/telegram/register-messaging-handlers.js';

function createBotHarness() {
    const commands = new Map();
    const actions = [];
    const bot = {
        command(name, handler) { commands.set(name, handler); },
        action(re, handler) { actions.push({ re, handler }); },
        on() {}
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
        }
    };
}

function createCtx({ text = '', fromId = 888, chatType = 'private' } = {}) {
    const recorded = { replies: [], edits: [], cbAnswers: [] };
    const ctx = {
        chat: { type: chatType, id: fromId },
        from: { id: fromId },
        message: { text },
        match: null, nextCalled: false,
        reply: async (t, extra) => { recorded.replies.push({ text: t, extra }); },
        editMessageText: async (t) => { recorded.edits.push(t); },
        answerCbQuery: async (t, extra) => { recorded.cbAnswers.push({ text: t, extra }); }
    };
    ctx.recorded = recorded;
    return ctx;
}

function createMocks() {
    const calls = { prepareMessage: [], confirmSend: [] };
    const messagingService = {
        async prepareMessage(input) {
            calls.prepareMessage.push(input);
            if (input.text === 'quá dài') {
                const err = new Error('Nội dung quá dài (3001/3000 ký tự).');
                err.code = 'TEXT_TOO_LONG';
                throw err;
            }
            return {
                managerId: input.managerId, content: input.text,
                recipients: [
                    { id: 'e1', employee_code: 'NV001', full_name: 'Nguyễn Văn A', telegram_id: '111' }
                ],
                missing: input.codes.includes('NV999') ? ['NV999'] : [],
                unreachable: input.codes.includes('NV003') ? ['NV003'] : [],
                duplicates: []
            };
        },
        async confirmSend(input) {
            calls.confirmSend.push(input);
            return {
                sentAt: new Date(),
                results: input.recipients.map(r => ({
                    logId: 1, outboxId: 2, employeeCode: r.employee_code,
                    employeeName: r.full_name, chatId: r.telegram_id
                }))
            };
        }
    };
    const accessService = {
        async getManager(id) {
            if (id !== 888) return null;
            return { status: 'ACTIVE', permissions: ['messages.send_individual'] };
        },
        hasPermission(manager, permission) {
            if (!manager || manager.status !== 'ACTIVE') return false;
            return (manager.permissions || []).includes(permission);
        }
    };
    return { messagingService, accessService, calls };
}

test('/guitin: tạo preview có nút gửi/hủy cho manager có quyền', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerMessagingHandlers({ bot: harness.bot, messagingService: mocks.messagingService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/guitin NV001 | Nhớ nộp báo cáo trước 17:00' });
    await harness.runCommand('guitin', ctx);

    assert.equal(mocks.calls.prepareMessage.length, 1);
    assert.deepEqual(mocks.calls.prepareMessage[0].codes, ['NV001']);
    const preview = ctx.recorded.replies[0];
    assert.match(preview.text, /XÁC NHẬN GỬI TIN CÁ NHÂN/);
    assert.match(preview.text, /NV001 — Nguyễn Văn A/);
    assert.match(preview.text, /Nhớ nộp báo cáo trước 17:00/);
    assert.match(preview.extra.reply_markup.inline_keyboard[0][0].callback_data, /^msg:send:[0-9a-f]+$/);
    assert.match(preview.extra.reply_markup.inline_keyboard[0][1].callback_data, /^msg:no:[0-9a-f]+$/);
});

test('/guitin: từ chối khi thiếu quyền messages.send_individual', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerMessagingHandlers({ bot: harness.bot, messagingService: mocks.messagingService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/guitin NV001 | chào', fromId: 777 });
    await harness.runCommand('guitin', ctx);
    assert.match(ctx.recorded.replies[0].text, /chưa được cấp quyền/);
    assert.equal(mocks.calls.prepareMessage.length, 0);
});

test('/guitin: chỉ dùng trong DM, không chạy trong nhóm', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerMessagingHandlers({ bot: harness.bot, messagingService: mocks.messagingService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/guitin NV001 | chào', chatType: 'group' });
    await harness.runCommand('guitin', ctx);
    assert.match(ctx.recorded.replies[0].text, /tin nhắn riêng/);
    assert.equal(mocks.calls.prepareMessage.length, 0);
});

test('/guitin: nhiều hơn 1 mã thì hướng sang /guitinall', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerMessagingHandlers({ bot: harness.bot, messagingService: mocks.messagingService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/guitin NV001,NV002 | chào cả nhà' });
    await harness.runCommand('guitin', ctx);
    assert.match(ctx.recorded.replies[0].text, /guitinall/);
    assert.equal(mocks.calls.prepareMessage.length, 0);
});

test('/guitinall: manager thường thiếu quyền send_bulk thì từ chối', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerMessagingHandlers({ bot: harness.bot, messagingService: mocks.messagingService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/guitinall NV001,NV002 | chào cả nhà' });
    await harness.runCommand('guitinall', ctx);
    assert.match(ctx.recorded.replies[0].text, /gửi tin hàng loạt/);
    assert.equal(mocks.calls.prepareMessage.length, 0);
});

test('/guitinall: OWNER có send_bulk thì tạo preview hàng loạt', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    const ownerAccess = {
        async getManager() { return { status: 'ACTIVE', permissions: ['messages.send_individual', 'messages.send_bulk'] }; },
        hasPermission(m, p) { return (m.permissions || []).includes(p); }
    };
    registerMessagingHandlers({ bot: harness.bot, messagingService: mocks.messagingService, accessService: ownerAccess });
    const ctx = createCtx({ text: '/guitinall NV001 | Chào cả team' });
    await harness.runCommand('guitinall', ctx);
    assert.match(ctx.recorded.replies[0].text, /GỬI TIN HÀNG LOẠT/);
    assert.equal(mocks.calls.prepareMessage.length, 1);
});

test('preview hiện cảnh báo missing/unreachable từ service', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    const ownerAccess = {
        async getManager() { return { status: 'ACTIVE', permissions: ['messages.send_individual', 'messages.send_bulk'] }; },
        hasPermission(m, p) { return (m.permissions || []).includes(p); }
    };
    registerMessagingHandlers({ bot: harness.bot, messagingService: mocks.messagingService, accessService: ownerAccess });
    const ctx = createCtx({ text: '/guitinall NV001,NV003,NV999 | chào' });
    await harness.runCommand('guitinall', ctx);
    assert.match(ctx.recorded.replies[0].text, /Không tìm thấy: NV999/);
    assert.match(ctx.recorded.replies[0].text, /không có Telegram\): NV003/);
});

test('lỗi service (TEXT_TOO_LONG) trả về người dùng trước khi tạo nháp', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerMessagingHandlers({ bot: harness.bot, messagingService: mocks.messagingService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/guitin NV001 | quá dài' });
    await harness.runCommand('guitin', ctx);
    assert.match(ctx.recorded.replies[0].text, /quá dài/);
});

test('bấm Gửi: gọi confirmSend và sửa tin thành kết quả', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerMessagingHandlers({ bot: harness.bot, messagingService: mocks.messagingService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/guitin NV001 | Nhớ nộp báo cáo' });
    await harness.runCommand('guitin', ctx);
    const draftId = ctx.recorded.replies[0].extra.reply_markup.inline_keyboard[0][0].callback_data.split(':')[2];

    const cbCtx = createCtx({});
    await harness.runAction(`msg:send:${draftId}`, cbCtx);
    assert.equal(mocks.calls.confirmSend.length, 1);
    assert.equal(mocks.calls.confirmSend[0].managerId, '888');
    assert.equal(mocks.calls.confirmSend[0].text, 'Nhớ nộp báo cáo');
    assert.equal(mocks.calls.confirmSend[0].recipients[0].employee_code, 'NV001');
    assert.match(cbCtx.recorded.edits[0], /Đã đưa 1 tin vào hàng gửi/);
    assert.match(cbCtx.recorded.edits[0], /NV001/);
});

test('bấm Hủy: không gửi, sửa tin thành đã hủy', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerMessagingHandlers({ bot: harness.bot, messagingService: mocks.messagingService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/guitin NV001 | chào' });
    await harness.runCommand('guitin', ctx);
    const draftId = ctx.recorded.replies[0].extra.reply_markup.inline_keyboard[0][1].callback_data.split(':')[2];

    const cbCtx = createCtx({});
    await harness.runAction(`msg:no:${draftId}`, cbCtx);
    assert.equal(mocks.calls.confirmSend.length, 0);
    assert.match(cbCtx.recorded.edits[0], /Đã hủy/);
});

test('nháp hết hạn: cảnh báo và không gửi', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerMessagingHandlers({ bot: harness.bot, messagingService: mocks.messagingService, accessService: mocks.accessService });
    const cbCtx = createCtx({});
    await harness.runAction('msg:send:deadbeef', cbCtx);
    assert.equal(mocks.calls.confirmSend.length, 0);
    assert.match(cbCtx.recorded.cbAnswers[0].text, /không còn hiệu lực/);
});

test('/huy xóa nháp gửi tin và nhường chuỗi cho module khác', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerMessagingHandlers({ bot: harness.bot, messagingService: mocks.messagingService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/guitin NV001 | chào' });
    await harness.runCommand('guitin', ctx);
    const draftId = ctx.recorded.replies[0].extra.reply_markup.inline_keyboard[0][0].callback_data.split(':')[2];

    const huyCtx = createCtx({ text: '/huy' });
    await harness.runCommand('huy', huyCtx);
    assert.ok(huyCtx.nextCalled);

    const cbCtx = createCtx({});
    await harness.runAction(`msg:send:${draftId}`, cbCtx);
    assert.equal(mocks.calls.confirmSend.length, 0);
    assert.match(cbCtx.recorded.cbAnswers[0].text, /không còn hiệu lực/);
});

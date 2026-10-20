import test from 'node:test';
import assert from 'node:assert/strict';
import { registerFormHandlers } from '../interfaces/telegram/register-form-handlers.js';

const FIXED_NOW = new Date('2026-10-19T10:00:00+07:00');

function createBotHarness() {
    const commands = new Map();
    const actions = [];
    const messageHandlers = [];
    const bot = {
        command(name, handler) { commands.set(name, handler); },
        action(re, handler) { actions.push({ re: re instanceof RegExp ? re : new RegExp(`^${re}$`), handler }); },
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

function createCtx({ text = '', fromId = 999, chatId = 999, chatType = 'private' } = {}) {
    const recorded = { replies: [], edits: [], cbAnswers: [] };
    const ctx = {
        chat: { type: chatType, id: chatId },
        from: { id: fromId },
        message: { text, message_id: 10, reply_to_message: null },
        match: null, nextCalled: false,
        reply: async (t, extra) => { recorded.replies.push({ text: t, extra }); },
        editMessageText: async (t) => { recorded.edits.push(t); },
        answerCbQuery: async (t, extra) => { recorded.cbAnswers.push({ text: t, extra }); }
    };
    ctx.recorded = recorded;
    return ctx;
}

const FILL_ASSIGNMENT = {
    id: 1, display_code: 101, title: 'Báo cáo tuần', status: 'OPEN',
    template_status: 'PUBLISHED', telegram_user_id_snapshot: '999',
    created_by: '888', version_id: 5, due_at: FIXED_NOW,
    fields: [
        { key: 'doanh_so', label: 'Doanh số', type: 'money', required: true },
        { key: 'kenh', label: 'Kênh bán', type: 'single_choice', required: false, options: ['Online', 'Cửa hàng'] }
    ]
};

function createMocks() {
    const calls = {
        createFormDraft: [], assignForm: [], aggregateForm: [], cancelForm: [],
        submitForm: [], evaluateSubmission: [], loadFillableAssignment: [], loadEvaluableAssignment: []
    };
    const formService = {
        async createFormDraft(input) { calls.createFormDraft.push(input); return { id: 500, display_code: 101, title: input.title }; },
        async assignForm(input) {
            calls.assignForm.push(input);
            return {
                template: { display_code: 101, status: 'PUBLISHED' }, version: { version_no: 1 },
                created: [{ id: 1, telegram_user_id_snapshot: '111' }], skipped: ['NV002']
            };
        },
        async aggregateForm(input) {
            calls.aggregateForm.push(input);
            if (String(input.displayCode) === '999') throw new Error('Không tìm thấy form #F-999.');
            return '📊 TỔNG HỢP #F-101 — Báo cáo tuần';
        },
        async cancelForm(input) { calls.cancelForm.push(input); return 2; },
        async submitForm(input) { calls.submitForm.push(input); return { isLate: false }; },
        async evaluateSubmission(input) { calls.evaluateSubmission.push(input); return { evaluation: {} }; },
        async loadFillableAssignment(assignmentId, telegramUserId) {
            calls.loadFillableAssignment.push({ assignmentId, telegramUserId });
            if (assignmentId !== FILL_ASSIGNMENT.id || String(telegramUserId) !== FILL_ASSIGNMENT.telegram_user_id_snapshot) {
                throw Object.assign(new Error('Form này không gán cho bạn.'), { code: 'NOT_ASSIGNEE' });
            }
            return FILL_ASSIGNMENT;
        },
        async loadEvaluableAssignment(assignmentId, managerId) {
            calls.loadEvaluableAssignment.push({ assignmentId, managerId });
            if (String(managerId) !== FILL_ASSIGNMENT.created_by) {
                throw Object.assign(new Error('Chỉ người tạo form mới đánh giá được.'), { code: 'FORBIDDEN' });
            }
            return { ...FILL_ASSIGNMENT, rubric: ['Đầy đủ', 'Cụ thể'] };
        }
    };
    const taskRepository = {
        async listFormTemplatesByCreator() {
            return [{ display_code: 101, title: 'Báo cáo tuần', status: 'PUBLISHED', version_no: 1, published_at: FIXED_NOW, assignment_count: 3 }];
        },
        async findEmployeesByCodes(codes) {
            const book = {
                NV001: { id: 'e1', employee_code: 'NV001', full_name: 'Nguyễn Văn A', telegram_id: '111' },
                NV002: { id: 'e2', employee_code: 'NV002', full_name: 'Trần B', telegram_id: null }
            };
            return codes.map(c => book[c]).filter(Boolean);
        }
    };
    return { calls, formService, taskRepository };
}

function register(harness, mocks) {
    registerFormHandlers({ bot: harness.bot, formService: mocks.formService, taskRepository: mocks.taskRepository });
}

test('Wizard /taoform: đi đủ 4 bước hiện preview có nút Lưu, bấm Lưu tạo draft', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ text: '/taoform' });
    await harness.runCommand('taoform', ctx);
    assert.match(ctx.recorded.replies[0].text, /bước 1\/4/);

    ctx.message.text = 'Báo cáo tuần Telesale';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Bước 2\/4/);

    ctx.message.text = 'không';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Bước 3\/4/);

    ctx.message.text = 'Doanh số | tiền | bắt buộc';
    await harness.runMessage(ctx);
    ctx.message.text = 'Kênh bán | chọn | gợi ý: Online, Cửa hàng';
    await harness.runMessage(ctx);
    ctx.message.text = 'xong';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Bước 4\/4/);

    ctx.message.text = 'Đầy đủ, Cụ thể';
    await harness.runMessage(ctx);
    const preview = ctx.recorded.replies.at(-1);
    assert.match(preview.text, /XEM TRƯỚC FORM/);
    assert.match(preview.text, /Tiêu đề: Báo cáo tuần Telesale/);
    assert.match(preview.text, /Doanh số — Tiền \(bắt buộc\)/);
    assert.match(preview.text, /Kênh bán — Chọn 1 \[Online, Cửa hàng\]/);
    assert.match(preview.text, /Rubric: Đầy đủ, Cụ thể/);
    const keyboard = preview.extra.reply_markup.inline_keyboard[0];
    assert.equal(keyboard[0].callback_data, 'report:fok');
    assert.equal(keyboard[1].callback_data, 'report:fno');

    await harness.runAction('report:fok', ctx);
    assert.equal(mocks.calls.createFormDraft.length, 1);
    assert.equal(mocks.calls.createFormDraft[0].createdBy, '999');
    assert.equal(mocks.calls.createFormDraft[0].title, 'Báo cáo tuần Telesale');
    assert.equal(mocks.calls.createFormDraft[0].description, null);
    assert.equal(mocks.calls.createFormDraft[0].fields.length, 2);
    assert.deepEqual(mocks.calls.createFormDraft[0].rubric, ['Đầy đủ', 'Cụ thể']);
    assert.match(ctx.recorded.edits.at(-1), /#F-101/);
    assert.match(ctx.recorded.edits.at(-1), /\/giaoform #F-101/);
});

test('Wizard: dòng câu hỏi sai định dạng giữ state để sửa tiếp', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ text: '/taoform' });
    await harness.runCommand('taoform', ctx);
    ctx.message.text = 'Báo cáo';
    await harness.runMessage(ctx);
    ctx.message.text = 'không';
    await harness.runMessage(ctx);

    ctx.message.text = 'Doanh số | kiểu lạ';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Kiểu không rõ/);

    ctx.message.text = 'Doanh số | tiền | bắt buộc';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Đã thêm câu 1/);
});

test('Wizard: gõ xong khi chưa có câu hỏi bị chặn, thêm được sau đó', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ text: '/taoform' });
    await harness.runCommand('taoform', ctx);
    ctx.message.text = 'Báo cáo';
    await harness.runMessage(ctx);
    ctx.message.text = 'không';
    await harness.runMessage(ctx);

    ctx.message.text = 'xong';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /ít nhất một câu hỏi/);

    ctx.message.text = 'Doanh số | tiền';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Đã thêm câu 1/);
});

test('report:fno hủy bản nháp; report:fok khi hết state báo tạo lại', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const noState = createCtx({});
    await harness.runAction('report:fok', noState);
    assert.match(noState.recorded.cbAnswers[0].text, /không còn hiệu lực/);

    const cancelCtx = createCtx({});
    await harness.runAction('report:fno', cancelCtx);
    assert.match(cancelCtx.recorded.edits[0], /Đã hủy bản nháp/);
    assert.equal(mocks.calls.createFormDraft.length, 0);
});

test('/giaoform: gán thành công, lọc người thiếu Telegram, báo danh sách bỏ qua', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ text: '/giaoform #F-101 | NV001,NV002 | 17:30' });
    await harness.runCommand('giaoform', ctx);
    assert.equal(mocks.calls.assignForm.length, 1);
    assert.equal(mocks.calls.assignForm[0].displayCode, '101');
    assert.deepEqual(mocks.calls.assignForm[0].employees, [
        { employeeId: 'e1', employeeCode: 'NV001', employeeName: 'Nguyễn Văn A', telegramUserId: '111' }
    ]);
    const reply = ctx.recorded.replies.at(-1).text;
    assert.match(reply, /Đã gán #F-101 cho 1 người/);
    assert.match(reply, /Bỏ qua \(đã được gán trước đó\): NV002/);
});

test('/giaoform: thiếu cú pháp hoặc hạn sai không gọi service', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const syntax = createCtx({ text: '/giaoform #F-101 | NV001' });
    await harness.runCommand('giaoform', syntax);
    assert.match(syntax.recorded.replies[0].text, /Cú pháp/);

    const deadline = createCtx({ text: '/giaoform #F-101 | NV001 | 25h' });
    await harness.runCommand('giaoform', deadline);
    assert.match(deadline.recorded.replies[0].text, /Không đọc được hạn nộp/);

    assert.equal(mocks.calls.assignForm.length, 0);
});

test('/giaoform: mã nhân viên lạ hoặc không có Telegram đều bị chặn', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const missing = createCtx({ text: '/giaoform #F-101 | NV999 | 17:30' });
    await harness.runCommand('giaoform', missing);
    assert.match(missing.recorded.replies[0].text, /Không tìm thấy nhân viên.*NV999/s);
    assert.equal(mocks.calls.assignForm.length, 0);

    const noTg = createCtx({ text: '/giaoform #F-101 | NV002 | 17:30' });
    await harness.runCommand('giaoform', noTg);
    assert.match(noTg.recorded.replies[0].text, /Không nhân viên nào có Telegram ID/);
    assert.equal(mocks.calls.assignForm.length, 0);
});

test('report:fill: mở form hiện câu hỏi đầu; sai người nhận bị chặn', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ fromId: 999 });
    await harness.runAction('report:fill:1', ctx);
    assert.equal(mocks.calls.loadFillableAssignment[0].telegramUserId, '999');
    const first = ctx.recorded.replies.at(-1).text;
    assert.match(first, /ĐIỀN FORM #F-101 — Báo cáo tuần/);
    assert.match(first, /Câu 1\/2: Doanh số \(Tiền, bắt buộc\)/);

    const intruder = createCtx({ fromId: 777 });
    await harness.runAction('report:fill:1', intruder);
    assert.match(intruder.recorded.cbAnswers[0].text, /không gán cho bạn/);
});

test('Điền form: trả lời tuần tự, sai lựa chọn phải nhập lại, xác nhận OK gọi submitForm', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ fromId: 999 });
    await harness.runAction('report:fill:1', ctx);

    ctx.message.text = '1.250.000';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Câu 2\/2: Kênh bán/);

    ctx.message.text = 'Shopee';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /chỉ nhận: Online, Cửa hàng/);

    ctx.message.text = 'Online';
    await harness.runMessage(ctx);
    const confirm = ctx.recorded.replies.at(-1).text;
    assert.match(confirm, /Xác nhận bài nộp/);
    assert.match(confirm, /Doanh số: 1250000/);
    assert.match(confirm, /Kênh bán: Online/);

    ctx.message.text = 'OK';
    await harness.runMessage(ctx);
    assert.equal(mocks.calls.submitForm.length, 1);
    assert.deepEqual(mocks.calls.submitForm[0].answers, { doanh_so: 1250000, kenh: 'Online' });
    assert.equal(mocks.calls.submitForm[0].assignmentId, 1);
    assert.match(ctx.recorded.replies.at(-1).text, /Đã nộp form/);
});

test('Xác nhận nộp: gõ nội dung khác OK thì điền lại từ đầu', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ fromId: 999 });
    await harness.runAction('report:fill:1', ctx);
    ctx.message.text = '500000';
    await harness.runMessage(ctx);
    ctx.message.text = 'Online';
    await harness.runMessage(ctx);
    ctx.message.text = 'để xem lại đã';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Điền lại từ đầu/);
    assert.match(ctx.recorded.replies.at(-1).text, /Câu 1\/2/);
    assert.equal(mocks.calls.submitForm.length, 0);

    ctx.message.text = '500000';
    await harness.runMessage(ctx);
    ctx.message.text = 'Online';
    await harness.runMessage(ctx);
    ctx.message.text = 'ok';
    await harness.runMessage(ctx);
    assert.equal(mocks.calls.submitForm.length, 1);
});

test('report:eval: chấm đủ rubric, điểm sai bị chặn, nhận xét gửi evaluateSubmission', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ fromId: 888 });
    await harness.runAction('report:eval:1', ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Chấm điểm "Đầy đủ"/);

    ctx.message.text = '3';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Chấm điểm "Cụ thể"/);

    ctx.message.text = '9';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Nhập điểm nguyên từ 1 đến 5/);

    ctx.message.text = '4';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Nhận xét/);

    ctx.message.text = 'Bài viết đủ ý';
    await harness.runMessage(ctx);
    assert.equal(mocks.calls.evaluateSubmission.length, 1);
    assert.deepEqual(mocks.calls.evaluateSubmission[0].criteriaScores, [3, 4]);
    assert.equal(mocks.calls.evaluateSubmission[0].comment, 'Bài viết đủ ý');
    assert.match(ctx.recorded.replies.at(-1).text, /Đã lưu đánh giá/);
});

test('report:eval: không phải người tạo bị chặn; nhận xét "-" lưu comment null', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const intruder = createCtx({ fromId: 777 });
    await harness.runAction('report:eval:1', intruder);
    assert.match(intruder.recorded.cbAnswers[0].text, /Chỉ người tạo form/);
    assert.equal(mocks.calls.evaluateSubmission.length, 0);

    const ctx = createCtx({ fromId: 888 });
    await harness.runAction('report:eval:1', ctx);
    ctx.message.text = '5';
    await harness.runMessage(ctx);
    ctx.message.text = '4';
    await harness.runMessage(ctx);
    ctx.message.text = '-';
    await harness.runMessage(ctx);
    assert.equal(mocks.calls.evaluateSubmission[0].comment, null);
});

test('/tonghop: trả text tổng hợp; lỗi service hiển thị ❌', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ text: '/tonghop #F-101' });
    await harness.runCommand('tonghop', ctx);
    assert.match(ctx.recorded.replies[0].text, /TỔNG HỢP #F-101/);
    assert.equal(mocks.calls.aggregateForm[0].managerId, '999');

    const missing = createCtx({ text: '/tonghop #F-999' });
    await harness.runCommand('tonghop', missing);
    assert.match(missing.recorded.replies[0].text, /❌ Không tìm thấy form #F-999/);

    const syntax = createCtx({ text: '/tonghop' });
    await harness.runCommand('tonghop', syntax);
    assert.match(syntax.recorded.replies[0].text, /Cú pháp/);
});

test('/huyform: hủy thành công kèm lý do; thiếu lý do báo cú pháp', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ text: '/huyform #F-101 | không còn cần thiết' });
    await harness.runCommand('huyform', ctx);
    assert.equal(mocks.calls.cancelForm.length, 1);
    assert.equal(mocks.calls.cancelForm[0].displayCode, '101');
    assert.equal(mocks.calls.cancelForm[0].reason, 'không còn cần thiết');
    assert.match(ctx.recorded.replies[0].text, /2 bài gán đang mở/);

    const noReason = createCtx({ text: '/huyform #F-101' });
    await harness.runCommand('huyform', noReason);
    assert.match(noReason.recorded.replies[0].text, /Cú pháp/);
    assert.equal(mocks.calls.cancelForm.length, 1);
});

test('/huy: xóa state form đang dở và nhường chain cho module sau', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ text: '/taoform' });
    await harness.runCommand('taoform', ctx);
    ctx.message.text = 'Tiêu đề mới';
    await harness.runMessage(ctx);
    assert.match(ctx.recorded.replies.at(-1).text, /Bước 2\/4/);

    const huyCtx = createCtx({ text: '/huy' });
    await harness.runCommand('huy', huyCtx);
    assert.equal(huyCtx.nextCalled, true);
    assert.match(huyCtx.recorded.replies[0].text, /Đã bỏ thao tác form đang dở/);

    const after = createCtx({ text: 'văn bản tự do' });
    await harness.runMessage(after);
    assert.equal(after.nextCalled, true);
    assert.equal(after.recorded.replies.length, 0);
});

test('/dsform: liệt kê form của người tạo kèm số lượt gán', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({});
    await harness.runCommand('dsform', ctx);
    assert.match(ctx.recorded.replies[0].text, /#F-101 Báo cáo tuần \[PUBLISHED\]/);
    assert.match(ctx.recorded.replies[0].text, /v1/);
    assert.match(ctx.recorded.replies[0].text, /Đã gán: 3 người/);
});

test('Lệnh form ngoài tin nhắn riêng bị từ chối', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    for (const name of ['taoform', 'dsform', 'tonghop', 'huyform']) {
        const ctx = createCtx({ chatType: 'group', text: `/${name}` });
        await harness.runCommand(name, ctx);
        assert.match(ctx.recorded.replies[0].text, /tin nhắn riêng/, `/${name}`);
    }
    assert.equal(mocks.calls.aggregateForm.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerExcelHandlers, parseXuatExcelArgs } from '../interfaces/telegram/register-excel-handlers.js';

function createBotHarness() {
    const commands = new Map();
    const actions = [];
    const onHandlers = new Map();
    const bot = {
        command(name, handler) { commands.set(name, handler); },
        action(re, handler) { actions.push({ re, handler }); },
        on(event, handler) {
            if (!onHandlers.has(event)) onHandlers.set(event, []);
            onHandlers.get(event).push(handler);
        }
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
        runDocument: (ctx) => {
            ctx.nextCalled = false;
            return onHandlers.get('document')?.[0]?.(ctx, async () => { ctx.nextCalled = true; });
        }
    };
}

function createCtx({ text = '', fromId = 888, chatType = 'private', document = null } = {}) {
    const recorded = { replies: [], documents: [], edits: [], cbAnswers: [] };
    const ctx = {
        chat: { type: chatType, id: fromId },
        from: { id: fromId },
        message: { text, document },
        match: null, nextCalled: false,
        telegram: {
            async getFileLink() { return 'https://file.telegram/fake'; }
        },
        reply: async (t, extra) => { recorded.replies.push({ text: t, extra }); },
        replyWithDocument: async (source, extra) => { recorded.documents.push({ source, extra }); },
        editMessageText: async (t) => { recorded.edits.push(t); },
        answerCbQuery: async (t, extra) => { recorded.cbAnswers.push({ text: t, extra }); }
    };
    ctx.recorded = recorded;
    return ctx;
}

function createMocks() {
    const calls = {
        dryRunTaskImport: [], commitTaskImport: [], exportTasks: [], exportForm: []
    };
    const excelService = {
        async dryRunTaskImport(input) {
            calls.dryRunTaskImport.push(input);
            if (input.fileName.endsWith('empty.xlsx')) {
                return { checksum: 'c1', fileName: input.fileName, sheetName: 'S', rowsTotal: 1, okRows: [], errors: [{ rowNo: 2, reason: 'Dòng 2: thiếu MÃ NV.' }], conflictCount: 0 };
            }
            return {
                checksum: 'checksum-abc', fileName: input.fileName, sheetName: 'Giao việc',
                rowsTotal: 3, okRows: [
                    { rowNo: 2, code: 'NV001', title: 'Việc 1', dueAt: new Date('2026-10-20T10:00:00+07:00'), conflict: false, employee: { employeeId: 'e1', employeeCode: 'NV001', employeeName: 'A', telegramUserId: '111' } },
                    { rowNo: 3, code: 'NV001', title: 'Việc đang mở', dueAt: new Date('2026-10-20T10:00:00+07:00'), conflict: true, employee: { employeeId: 'e1', employeeCode: 'NV001', employeeName: 'A', telegramUserId: '111' } }
                ],
                errors: [{ rowNo: 4, reason: 'Dòng 4: không tìm thấy nhân viên NV999.' }],
                conflictCount: 1
            };
        },
        async commitTaskImport(input) {
            calls.commitTaskImport.push(input);
            if (input.rows.length && input.rows[0].rowNo === 99) {
                return { created: 0, skipped: 0, failed: [{ rowNo: 99, reason: 'Dòng 99: Deadline đã qua.' }] };
            }
            return { created: input.includeConflicts ? 2 : 1, skipped: 0, failed: [] };
        },
        async exportTasks(input) {
            calls.exportTasks.push(input);
            if (input.empty) return { buffer: Buffer.from('x'), count: 0 };
            return { buffer: Buffer.from('workbook'), count: 12 };
        },
        async exportForm(input) {
            calls.exportForm.push(input);
            if (input.displayCode === '777') throw new Error('Chỉ người tạo form mới xuất được.');
            return { buffer: Buffer.from('formwb'), count: 5 };
        }
    };
    const accessService = {
        async getManager(id) { return id === 888 ? { status: 'ACTIVE', permissions: ['excel.import', 'excel.export'] } : null; },
        hasPermission(manager, permission) {
            if (!manager || manager.status !== 'ACTIVE') return false;
            return (manager.permissions || []).includes(permission);
        }
    };
    return { calls, excelService, accessService };
}

function register(harness, mocks) {
    registerExcelHandlers({ bot: harness.bot, excelService: mocks.excelService, accessService: mocks.accessService });
}

async function withFakeFetch(fn, body = 'workbook') {
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from(body) });
    try {
        return await fn();
    } finally {
        globalThis.fetch = original;
    }
}

test('parseXuatExcelArgs: tasks mặc định, khoảng ngày, form, help và lỗi', () => {
    assert.deepEqual(parseXuatExcelArgs('/xuatexcel tasks'), { kind: 'TASKS' });
    const range = parseXuatExcelArgs('/xuatexcel tasks 1/11 15/11');
    assert.equal(range.kind, 'TASKS');
    assert.deepEqual(range.from, { day: 1, month: 11, year: new Date().getFullYear() });
    assert.deepEqual(range.to, { day: 15, month: 11, year: new Date().getFullYear() });
    assert.equal(parseXuatExcelArgs('/xuatexcel tasks abc').error.match(/ngày bắt đầu/) !== null, true);
    assert.match(parseXuatExcelArgs('/xuatexcel tasks 1/11 abc').error, /ngày kết thúc/);
    assert.deepEqual(parseXuatExcelArgs('/xuatexcel form #F-101'), { kind: 'FORM', displayCode: '101' });
    assert.match(parseXuatExcelArgs('/xuatexcel form').error, /Cú pháp/);
    assert.deepEqual(parseXuatExcelArgs('/xuatexcel'), { help: true });
    assert.match(parseXuatExcelArgs('/xuatexcel xyz').error, /không rõ/);
});

test('/xuatexcel: chặn nhóm và người chưa có quyền Excel', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const group = createCtx({ text: '/xuatexcel tasks', chatType: 'group' });
    await harness.runCommand('xuatexcel', group);
    assert.match(group.recorded.replies[0].text, /tin nhắn riêng/);

    const stranger = createCtx({ text: '/xuatexcel tasks', fromId: 777 });
    await harness.runCommand('xuatexcel', stranger);
    assert.match(stranger.recorded.replies[0].text, /chưa được cấp quyền Excel/);
    assert.equal(mocks.calls.exportTasks.length, 0);
});

test('/xuatexcel tasks: mặc định 7 ngày, có file đính kèm và caption số dòng', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ text: '/xuatexcel tasks' });
    await harness.runCommand('xuatexcel', ctx);
    assert.equal(mocks.calls.exportTasks[0].fromDate, null);
    assert.equal(mocks.calls.exportTasks[0].toDate, null);
    assert.equal(mocks.calls.exportTasks[0].managerId, '888');
    assert.equal(ctx.recorded.documents.length, 1);
    assert.deepEqual(ctx.recorded.documents[0].source.source, Buffer.from('workbook'));
    assert.match(ctx.recorded.documents[0].extra.caption, /12 dòng/);
    assert.match(ctx.recorded.documents[0].source.filename, /^nhiem-vu-\d{2}-\d{2}-\d{4}\.xlsx$/);
});

test('/xuatexcel tasks 1/11 15/11: đổi sang mốc giờ VN 00:00 đầu/ngày sau kết thúc', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    await harness.runCommand('xuatexcel', createCtx({ text: '/xuatexcel tasks 1/11 15/11' }));
    const year = new Date().getFullYear();
    assert.equal(mocks.calls.exportTasks[0].fromDate.getTime(), new Date(`${year}-11-01T00:00:00+07:00`).getTime());
    assert.equal(mocks.calls.exportTasks[0].toDate.getTime(), new Date(`${year}-11-16T00:00:00+07:00`).getTime());
});

test('/xuatexcel tasks: không có dữ liệu báo lại, không gửi file', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ text: '/xuatexcel tasks' });
    mocks.excelService.exportTasks = async () => ({ buffer: Buffer.from('x'), count: 0 });
    await harness.runCommand('xuatexcel', ctx);
    assert.match(ctx.recorded.replies[0].text, /Không có nhiệm vụ nào/);
    assert.equal(ctx.recorded.documents.length, 0);
});

test('/xuatexcel form: gửi file form; lỗi quyền hiển thị ❌', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ text: '/xuatexcel form #F-101' });
    await harness.runCommand('xuatexcel', ctx);
    assert.deepEqual(mocks.calls.exportForm[0], { displayCode: '101', managerId: '888' });
    assert.match(ctx.recorded.documents[0].source.filename, /^form-F-101-\d{2}-\d{2}-\d{4}\.xlsx$/);
    assert.match(ctx.recorded.documents[0].extra.caption, /5 bài gán/);

    const forbidden = createCtx({ text: '/xuatexcel form #F-777' });
    await harness.runCommand('xuatexcel', forbidden);
    assert.match(forbidden.recorded.replies[0].text, /❌ Chỉ người tạo form/);
});

test('/xuatexcel không đối số: hiện hướng dẫn', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ text: '/xuatexcel' });
    await harness.runCommand('xuatexcel', ctx);
    assert.match(ctx.recorded.replies[0].text, /XUẤT EXCEL/);
    assert.match(ctx.recorded.replies[0].text, /MÃ NV \| NỘI DUNG \| HẠN/);
});

test('Gửi file trong nhóm bị bỏ qua, nhường handler khác', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ chatType: 'group', document: { file_id: 'f1', file_name: 'a.xlsx', file_size: 100 } });
    await withFakeFetch(() => harness.runDocument(ctx));
    assert.equal(ctx.nextCalled, true);
    assert.equal(ctx.recorded.replies.length, 0);
});

test('Gửi file sai định dạng/dung lượng bị chặn trước khi tải', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const pdf = createCtx({ document: { file_id: 'f1', file_name: 'ghichu.pdf', mime_type: 'application/pdf', file_size: 100 } });
    await harness.runDocument(pdf);
    assert.match(pdf.recorded.replies[0].text, /Chỉ nhận file/);

    const xlsm = createCtx({ document: { file_id: 'f2', file_name: 'macro.xlsm', mime_type: 'application/vnd.ms-excel.sheet.macroenabled.12', file_size: 100 } });
    await harness.runDocument(xlsm);
    assert.match(xlsm.recorded.replies[0].text, /macro/);

    const big = createCtx({ document: { file_id: 'f3', file_name: 'to.xlsx', file_size: 10 * 1024 * 1024 } });
    await harness.runDocument(big);
    assert.match(big.recorded.replies[0].text, /quá lớn/);
    assert.equal(mocks.calls.dryRunTaskImport.length, 0);
});

test('Gửi file hợp lệ: dry-run hiện preview + 3 nút khi có dòng trùng', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ document: { file_id: 'f1', file_name: 'giao.xlsx', file_size: 100 } });
    await withFakeFetch(() => harness.runDocument(ctx));
    assert.equal(mocks.calls.dryRunTaskImport[0].managerId, '888');
    const preview = ctx.recorded.replies.at(-1);
    assert.match(preview.text, /KIỂM TRA FILE: giao\.xlsx/);
    assert.match(preview.text, /Hợp lệ: 2 \| Lỗi: 1 \| Trùng việc đang mở: 1/);
    const buttons = preview.extra.reply_markup.inline_keyboard;
    assert.match(buttons[0][0].callback_data, /^excel:ok:[0-9a-f]{8}$/);
    assert.match(buttons[1][0].callback_data, /^excel:all:[0-9a-f]{8}$/);
    assert.match(buttons[2][0].callback_data, /^excel:no:[0-9a-f]{8}$/);
    assert.match(buttons[1][0].text, /kể cả 1 dòng trùng/);
});

test('File không còn dòng hợp lệ: chỉ preview, không nút import', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ document: { file_id: 'f1', file_name: 'empty.xlsx', file_size: 100 } });
    await withFakeFetch(() => harness.runDocument(ctx));
    const preview = ctx.recorded.replies.at(-1);
    assert.match(preview.text, /Không còn dòng hợp lệ nào/);
    assert.equal(preview.extra, undefined);
});

test('Nút Import: gọi commit bỏ qua trùng, tổng hợp kết quả vào tin preview', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ document: { file_id: 'f1', file_name: 'giao.xlsx', file_size: 100 } });
    await withFakeFetch(() => harness.runDocument(ctx));
    const draftId = ctx.recorded.replies.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data.split(':')[2];

    const click = createCtx({ fromId: 888 });
    await harness.runAction(`excel:ok:${draftId}`, click);
    assert.equal(mocks.calls.commitTaskImport[0].includeConflicts, false);
    assert.equal(mocks.calls.commitTaskImport[0].checksum, 'checksum-abc');
    assert.equal(mocks.calls.commitTaskImport[0].rows.length, 2);
    assert.match(click.recorded.edits[0], /Đã tạo 1 nhiệm vụ từ file giao\.xlsx/);

    const stale = createCtx({ fromId: 888 });
    await harness.runAction(`excel:ok:${draftId}`, stale);
    assert.match(stale.recorded.cbAnswers[0].text, /không còn hiệu lực/);
});

test('Nút Import tất cả: includeConflicts=true; dòng lỗi hiển thị từng dòng', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ document: { file_id: 'f1', file_name: 'loi.xlsx', file_size: 100 } });
    await withFakeFetch(() => harness.runDocument(ctx));
    const keyboard = ctx.recorded.replies.at(-1).extra.reply_markup.inline_keyboard;
    const allId = keyboard[1][0].callback_data.split(':')[2];

    const click = createCtx({ fromId: 888 });
    await harness.runAction(`excel:all:${allId}`, click);
    assert.equal(mocks.calls.commitTaskImport[0].includeConflicts, true);
});

test('Nút Hủy: xóa state và không gọi commit', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ document: { file_id: 'f1', file_name: 'giao.xlsx', file_size: 100 } });
    await withFakeFetch(() => harness.runDocument(ctx));
    const noId = ctx.recorded.replies.at(-1).extra.reply_markup.inline_keyboard.at(-1)[0].callback_data.split(':')[2];

    const click = createCtx({ fromId: 888 });
    await harness.runAction(`excel:no:${noId}`, click);
    assert.match(click.recorded.edits[0], /Đã hủy import Excel/);
    assert.equal(mocks.calls.commitTaskImport.length, 0);
});

test('/huy: dọn state import Excel và nhường chain', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    register(harness, mocks);

    const ctx = createCtx({ document: { file_id: 'f1', file_name: 'giao.xlsx', file_size: 100 } });
    await withFakeFetch(() => harness.runDocument(ctx));
    const draftId = ctx.recorded.replies.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data.split(':')[2];

    const huyCtx = createCtx({ text: '/huy' });
    await harness.runCommand('huy', huyCtx);
    assert.equal(huyCtx.nextCalled, true);
    assert.match(huyCtx.recorded.replies[0].text, /import Excel đang dở/);

    const stale = createCtx({ fromId: 888 });
    await harness.runAction(`excel:ok:${draftId}`, stale);
    assert.match(stale.recorded.cbAnswers[0].text, /không còn hiệu lực/);
});

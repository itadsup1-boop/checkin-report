import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTaskManagementModule } from '../index.js';

function createFakeBot() {
    const commands = new Map();
    const actions = [];
    const onHandlers = [];
    return {
        commands, actions, onHandlers,
        command(name, handler) { commands.set(name, handler); },
        action(re, handler) { actions.push({ re, handler }); },
        on(event, handler) { onHandlers.push({ event, handler }); }
    };
}

function createCtx({ chatType = 'private', userId = 1, text = '' }) {
    const replies = [];
    return {
        ctx: {
            chat: { type: chatType },
            from: { id: userId },
            message: { text },
            reply: async (t) => { replies.push(t); }
        },
        replies
    };
}

test('TASK_MANAGEMENT_ENABLED=false → không đăng ký handler nào', () => {
    const bot = createFakeBot();
    const result = registerTaskManagementModule({ bot, pool: {}, env: {} });

    assert.equal(result, null);
    assert.equal(bot.commands.size, 0);
});

test('TASK_MANAGEMENT_ENABLED=true → đăng ký đủ lệnh DM, nút bấm và handler tin nhắn', () => {
    const bot = createFakeBot();
    const result = registerTaskManagementModule({ bot, pool: {}, env: { TASK_MANAGEMENT_ENABLED: 'true' } });

    assert.ok(result?.accessService);
    assert.ok(result?.taskService);
    assert.ok(result?.formService);
    assert.deepEqual([...bot.commands.keys()].sort(),
        ['cauhinh', 'capma', 'chohay', 'congviec', 'dsform', 'giao', 'giaoform', 'guitin', 'guitinall', 'huy', 'huyform', 'huytask', 'kichhoat', 'quyen', 'taoform', 'tamdung', 'thuhoi', 'tonghop'].sort());
    // nút nhân viên/nhóm quản lý + bản nháp /giao + điền/chấm form
    assert.ok(bot.actions.length >= 8);
    // 2 router tin nhắn: nhiệm vụ + form
    assert.ok(bot.onHandlers.filter(h => h.event === 'message').length >= 2);
});

test('EXCEL_SYNC_ENABLED=true → thêm /xuatexcel + handler document; mặc định tắt', () => {
    const offBot = createFakeBot();
    const offResult = registerTaskManagementModule({ bot: offBot, pool: {}, env: { TASK_MANAGEMENT_ENABLED: 'true' } });
    assert.equal(offResult?.excelService ?? null, null);
    assert.equal(offBot.commands.has('xuatexcel'), false);

    const onBot = createFakeBot();
    const onResult = registerTaskManagementModule({
        bot: onBot, pool: {}, env: { TASK_MANAGEMENT_ENABLED: 'true', EXCEL_SYNC_ENABLED: 'true' }
    });
    assert.ok(onResult?.excelService);
    assert.ok(onBot.commands.has('xuatexcel'));
    assert.ok(onBot.onHandlers.some(h => h.event === 'document'));
});

test('/kichhoat từ chối khi dùng trong nhóm', async () => {
    const bot = createFakeBot();
    registerTaskManagementModule({ bot, pool: {}, env: { TASK_MANAGEMENT_ENABLED: 'true' } });

    const { ctx, replies } = createCtx({ chatType: 'group', text: '/kichhoat TM-X' });
    await bot.commands.get('kichhoat')(ctx);

    assert.match(replies[0], /tin nhắn riêng/);
});

test('/kichhoat: thành công hiển thị role, thất bại hiển thị lý do', async () => {
    const bot = createFakeBot();
    const calls = [];
    const fakeService = {
        async redeemCode(input) {
            calls.push(input);
            if (input.code === 'BAD') {
                throw Object.assign(new Error('❌ Mã này đã được sử dụng trước đó.'), { code: 'CODE_USED' });
            }
            return { role: 'MANAGER', permissions: ['tasks.create', 'alerts.view'], scope: [] };
        },
        async getManager() { return null; }
    };
    registerTaskManagementModule({ bot, pool: {}, env: { TASK_MANAGEMENT_ENABLED: 'true' }, accessService: fakeService });

    const ok = createCtx({ userId: 42, text: '/kichhoat TM-AAAA-BBBB' });
    await bot.commands.get('kichhoat')(ok.ctx);
    assert.equal(calls[0].telegramUserId, '42');
    assert.match(ok.replies[0], /Kích hoạt thành công/);
    assert.match(ok.replies[0], /MANAGER/);

    const bad = createCtx({ userId: 42, text: '/kichhoat BAD' });
    await bot.commands.get('kichhoat')(bad.ctx);
    assert.match(bad.replies[0], /đã được sử dụng/);
});

test('/capma từ chối người không có trong ADMIN_IDS và từ chối tham số sai', async () => {
    const bot = createFakeBot();
    registerTaskManagementModule({
        bot, pool: {}, env: { TASK_MANAGEMENT_ENABLED: 'true' },
        loadAdminIds: () => ['111']
    });

    const stranger = createCtx({ userId: 999999, text: '/capma MANAGER' });
    await bot.commands.get('capma')(stranger.ctx);
    assert.match(stranger.replies[0], /quản trị viên/);

    const badArg = createCtx({ userId: 111, text: '/capma MANAGER abc' });
    await bot.commands.get('capma')(badArg.ctx);
    assert.match(badArg.replies[0], /không hợp lệ/);
});

test('/capma admin tạo mã và trả mã rõ trong tin nhắn', async () => {
    const bot = createFakeBot();
    const fakeService = {
        async createAccessCode(input) {
            return {
                id: 'code-1', code: 'TM-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH',
                role: input.role, scope: input.scope,
                expiresAt: new Date('2026-10-20T10:00:00Z')
            };
        },
        async getManager() { return null; }
    };
    registerTaskManagementModule({
        bot, pool: {}, env: { TASK_MANAGEMENT_ENABLED: 'true' },
        accessService: fakeService, loadAdminIds: () => ['111']
    });

    const { ctx, replies } = createCtx({ userId: 111, text: '/capma MANAGER -100123' });
    await bot.commands.get('capma')(ctx);

    assert.match(replies[0], /TM-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH/);
    assert.match(replies[0], /Role: MANAGER/);
});

test('/quyen báo chưa kích hoạt khi không có tài khoản', async () => {
    const bot = createFakeBot();
    const fakeService = { async getManager() { return null; } };
    registerTaskManagementModule({
        bot, pool: {}, env: { TASK_MANAGEMENT_ENABLED: 'true' }, accessService: fakeService
    });

    const { ctx, replies } = createCtx({ userId: 5, text: '/quyen' });
    await bot.commands.get('quyen')(ctx);

    assert.match(replies[0], /chưa kích hoạt/);
});

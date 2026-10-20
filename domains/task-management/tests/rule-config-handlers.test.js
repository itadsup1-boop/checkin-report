import test from 'node:test';
import assert from 'node:assert/strict';
import { registerRuleConfigHandlers } from '../interfaces/telegram/register-rule-config-handlers.js';
import { createRuleConfigService, RULE_DEFAULTS } from '../application/rule-config-service.js';

function createBotHarness() {
    const commands = new Map();
    const bot = {
        command(name, handler) { commands.set(name, handler); },
        action() {}, on() {}
    };
    return {
        bot,
        runCommand: (name, ctx) => {
            ctx.nextCalled = false;
            return commands.get(name)?.(ctx, async () => { ctx.nextCalled = true; });
        }
    };
}

function createCtx({ text = '', fromId = 888, chatType = 'private' } = {}) {
    const recorded = { replies: [] };
    const ctx = {
        chat: { type: chatType, id: fromId },
        from: { id: fromId },
        message: { text },
        reply: async (t) => { recorded.replies.push(t); }
    };
    ctx.recorded = recorded;
    return ctx;
}

function createMocks() {
    const calls = { describeConfig: [], applyRuleConfig: [], togglePaused: [] };
    const ruleConfigService = {
        async describeConfig(managerId) {
            calls.describeConfig.push(managerId);
            return { config: { ...RULE_DEFAULTS }, text: 'CONFIG TEXT' };
        },
        async applyRuleConfig(managerId, rawKey, rawValue) {
            calls.applyRuleConfig.push({ managerId, rawKey, rawValue });
            if (String(rawValue) === '9999') {
                const err = new Error('nhắc trước hạn (phút) phải là số nguyên 5–720.');
                err.code = 'VALUE_OUT_OF_RANGE';
                throw err;
            }
            return { ...RULE_DEFAULTS, due_soon_minutes: Number(rawValue) };
        },
        resolveRuleField(rawKey) {
            return String(rawKey).toLowerCase() === 'due' ? 'due_soon_minutes' : null;
        },
        async togglePaused(managerId, paused) {
            calls.togglePaused.push({ managerId, paused });
            return { ...RULE_DEFAULTS, paused };
        }
    };
    const accessService = {
        async getManager(id) { return id === 888 ? { status: 'ACTIVE' } : null; }
    };
    return { ruleConfigService, accessService, calls };
}

test('/cauhinh không tham số: xem cấu hình + mô phỏng', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerRuleConfigHandlers({ bot: harness.bot, ruleConfigService: mocks.ruleConfigService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/cauhinh' });
    await harness.runCommand('cauhinh', ctx);
    assert.deepEqual(mocks.calls.describeConfig, ['888']);
    assert.equal(mocks.calls.applyRuleConfig.length, 0);
    assert.match(ctx.recorded.replies[0], /CONFIG TEXT/);
});

test('/cauhinh due 45: lưu ngưỡng và xác nhận kèm đơn vị phút', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerRuleConfigHandlers({ bot: harness.bot, ruleConfigService: mocks.ruleConfigService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/cauhinh due 45' });
    await harness.runCommand('cauhinh', ctx);
    assert.deepEqual(mocks.calls.applyRuleConfig[0], { managerId: '888', rawKey: 'due', rawValue: '45' });
    assert.match(ctx.recorded.replies[0], /due soon minutes = 45 phút/);
});

test('/cauhinh giá trị sai dải: trả lỗi service, không lưu', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerRuleConfigHandlers({ bot: harness.bot, ruleConfigService: mocks.ruleConfigService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/cauhinh due 9999' });
    await harness.runCommand('cauhinh', ctx);
    assert.match(ctx.recorded.replies[0], /phải là số nguyên 5–720/);
});

test('/cauhinh thiếu giá trị hoặc thừa đối số: hướng dẫn cú pháp', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerRuleConfigHandlers({ bot: harness.bot, ruleConfigService: mocks.ruleConfigService, accessService: mocks.accessService });
    const missing = createCtx({ text: '/cauhinh due' });
    await harness.runCommand('cauhinh', missing);
    assert.match(missing.recorded.replies[0], /Cú pháp/);

    const extra = createCtx({ text: '/cauhinh due 45 60' });
    await harness.runCommand('cauhinh', extra);
    assert.match(extra.recorded.replies[0], /Cú pháp/);
    assert.equal(mocks.calls.applyRuleConfig.length, 0);
});

test('/tamdung: tạm dừng automation của chính mình', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerRuleConfigHandlers({ bot: harness.bot, ruleConfigService: mocks.ruleConfigService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/tamdung' });
    await harness.runCommand('tamdung', ctx);
    assert.deepEqual(mocks.calls.togglePaused, [{ managerId: '888', paused: true }]);
    assert.match(ctx.recorded.replies[0], /TẠM DỪNG/);
});

test('/chohay: bật lại automation', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerRuleConfigHandlers({ bot: harness.bot, ruleConfigService: mocks.ruleConfigService, accessService: mocks.accessService });
    const ctx = createCtx({ text: '/chohay' });
    await harness.runCommand('chohay', ctx);
    assert.deepEqual(mocks.calls.togglePaused, [{ managerId: '888', paused: false }]);
    assert.match(ctx.recorded.replies[0], /tiếp tục/i);
});

test('từ chối khi chưa có tài khoản quản lý hoặc dùng trong nhóm', async () => {
    const harness = createBotHarness();
    const mocks = createMocks();
    registerRuleConfigHandlers({ bot: harness.bot, ruleConfigService: mocks.ruleConfigService, accessService: mocks.accessService });

    const stranger = createCtx({ text: '/cauhinh', fromId: 777 });
    await harness.runCommand('cauhinh', stranger);
    assert.match(stranger.recorded.replies[0], /chưa có tài khoản quản lý/);

    const group = createCtx({ text: '/tamdung', chatType: 'group' });
    await harness.runCommand('tamdung', group);
    assert.match(group.recorded.replies[0], /tin nhắn riêng/);

    assert.equal(mocks.calls.togglePaused.length, 0);
    assert.equal(mocks.calls.describeConfig.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createRuleConfigService, RULE_DEFAULTS, RULE_RANGES,
    RULE_FIELD_ALIASES, FETCH_WINDOW
} from '../application/rule-config-service.js';

const FIXED_NOW = new Date('2026-10-19T10:00:00+07:00');

function createMockRepo() {
    const state = { configs: new Map() };
    return {
        state,
        async getRuleConfig(managerId) { return state.configs.get(String(managerId)) || null; },
        async getRuleConfigsForManagers(managerIds) {
            return managerIds.map(id => state.configs.get(String(id))).filter(Boolean);
        },
        async upsertRuleConfig(managerId, fields) {
            const current = state.configs.get(String(managerId)) || { manager_id: String(managerId), ...RULE_DEFAULTS };
            const updated = { ...current };
            if (fields.dueSoonMinutes !== null && fields.dueSoonMinutes !== undefined) updated.due_soon_minutes = fields.dueSoonMinutes;
            if (fields.notAcceptedMinutes !== null && fields.notAcceptedMinutes !== undefined) updated.not_accepted_minutes = fields.notAcceptedMinutes;
            if (fields.overdueManagerHours !== null && fields.overdueManagerHours !== undefined) updated.overdue_manager_hours = fields.overdueManagerHours;
            if (fields.formDueSoonHours !== null && fields.formDueSoonHours !== undefined) updated.form_due_soon_hours = fields.formDueSoonHours;
            if (fields.formOverdueManagerHours !== null && fields.formOverdueManagerHours !== undefined) updated.form_overdue_manager_hours = fields.formOverdueManagerHours;
            state.configs.set(String(managerId), updated);
            return updated;
        },
        async setRuleConfigPaused(managerId, paused) {
            const current = state.configs.get(String(managerId)) || { manager_id: String(managerId), ...RULE_DEFAULTS };
            current.paused = paused;
            state.configs.set(String(managerId), current);
            return current;
        },
        async countAssigneesNotAcceptedPending() { return 3; },
        async countAssigneesDueWithin() { return 5; },
        async countFormsDueWithin() { return 2; }
    };
}

function createSvc(repo = createMockRepo()) {
    return { repo, service: createRuleConfigService({ ruleConfigRepository: repo, now: () => FIXED_NOW }) };
}

test('loadConfigsForTick: điền mặc định cho quản lý chưa có cấu hình', async () => {
    const { repo, service } = createSvc();
    repo.state.configs.set('999', { manager_id: '999', due_soon_minutes: 60 });
    const configs = await service.loadConfigsForTick(['999', '777', null]);
    assert.equal(configs.size, 2);
    assert.equal(configs.get('999').due_soon_minutes, 60);
    assert.equal(configs.get('777').due_soon_minutes, RULE_DEFAULTS.due_soon_minutes);
    assert.equal(configs.get('777').paused, false);
});

test('loadConfigsForTick: danh sách rỗng thì không chạm DB', async () => {
    const { repo, service } = createSvc();
    const configs = await service.loadConfigsForTick([]);
    assert.equal(configs.size, 0);
    assert.equal(repo.state.configs.size, 0);
});

test('applyRuleConfig: nhận alias tiếng Việt không dấu và cập nhật đúng trường', async () => {
    const { repo, service } = createSvc();
    const config = await service.applyRuleConfig('999', 'due', 45);
    assert.equal(config.due_soon_minutes, 45);
    assert.equal(repo.state.configs.get('999').due_soon_minutes, 45);

    await service.applyRuleConfig('999', 'nhan', 20);
    await service.applyRuleConfig('999', 'tre', 3);
    await service.applyRuleConfig('999', 'formdue', 48);
    await service.applyRuleConfig('999', 'formtre', 4);
    const saved = repo.state.configs.get('999');
    assert.equal(saved.not_accepted_minutes, 20);
    assert.equal(saved.overdue_manager_hours, 3);
    assert.equal(saved.form_due_soon_hours, 48);
    assert.equal(saved.form_overdue_manager_hours, 4);
    assert.equal(saved.due_soon_minutes, 45); // giữ nguyên từ lần trước
});

test('applyRuleConfig: từ chối trường lạ và giá trị ngoài dải', async () => {
    const { service } = createSvc();
    await assert.rejects(
        () => service.applyRuleConfig('999', 'khongro', 10),
        err => err.code === 'UNKNOWN_FIELD'
    );
    await assert.rejects(
        () => service.applyRuleConfig('999', 'due', RULE_RANGES.due_soon_minutes.max + 1),
        err => err.code === 'VALUE_OUT_OF_RANGE'
    );
    await assert.rejects(
        () => service.applyRuleConfig('999', 'tre', 0),
        err => err.code === 'VALUE_OUT_OF_RANGE'
    );
    await assert.rejects(
        () => service.applyRuleConfig('999', 'nhan', 12.5),
        err => err.code === 'VALUE_OUT_OF_RANGE'
    );
});

test('togglePaused: bật/tắt tạm dừng automation riêng từng quản lý', async () => {
    const { service } = createSvc();
    const paused = await service.togglePaused('999', true);
    assert.equal(paused.paused, true);
    const resumed = await service.togglePaused('999', false);
    assert.equal(resumed.paused, false);
});

test('describeConfig: hiện cấu hình + mô phỏng đếm trên dữ liệu hiện tại', async () => {
    const { service } = createSvc();
    const { config, text } = await service.describeConfig('999');
    assert.equal(config.due_soon_minutes, RULE_DEFAULTS.due_soon_minutes);
    assert.match(text, /Nhắc trước hạn: 30 phút/);
    assert.match(text, /5 lượt việc sắp đến hạn/);
    assert.match(text, /3 lượt việc chưa nhận/);
    assert.match(text, /2 bài form sắp đến hạn/);
    assert.match(text, /\/cauhinh <trường> <số>/);
});

test('describeConfig: đang tạm dừng thì cảnh báo rõ ở đầu', async () => {
    const { repo, service } = createSvc();
    repo.state.configs.set('999', { manager_id: '999', ...RULE_DEFAULTS, paused: true });
    const { text } = await service.describeConfig('999');
    assert.match(text, /ĐANG TẠM DỪNG/);
});

test('predicate: đúng ngưỡng phút/giờ của từng config', () => {
    const { service } = createSvc();
    const nowMs = FIXED_NOW.getTime();
    const config = { due_soon_minutes: 60, form_due_soon_hours: 48, overdue_manager_hours: 5, form_overdue_manager_hours: 1 };

    assert.equal(service.isDueSoonWithin(config, new Date(nowMs + 60 * 60 * 1000), nowMs), true);
    assert.equal(service.isDueSoonWithin(config, new Date(nowMs + 61 * 60 * 1000), nowMs), false);

    assert.equal(service.isFormDueSoonWithin(config, new Date(nowMs + 48 * 3600 * 1000), nowMs), true);
    assert.equal(service.isFormDueSoonWithin(config, new Date(nowMs + 49 * 3600 * 1000), nowMs), false);

    assert.equal(service.isOverdueManagerDue(config, new Date(nowMs - 5 * 3600 * 1000), nowMs), true);
    assert.equal(service.isOverdueManagerDue(config, new Date(nowMs - 4 * 3600 * 1000), nowMs), false);

    assert.equal(service.isFormOverdueManagerDue(config, new Date(nowMs - 3600 * 1000), nowMs), true);
    assert.equal(service.isFormOverdueManagerDue(config, new Date(nowMs - 30 * 60 * 1000), nowMs), false);

    assert.equal(service.isNotAcceptedLateEnough({ not_accepted_minutes: 15 }, new Date(nowMs - 15 * 60 * 1000), nowMs), true);
    assert.equal(service.isNotAcceptedLateEnough({ not_accepted_minutes: 15 }, new Date(nowMs - 14 * 60 * 1000), nowMs), false);
});

test('shouldSkip: paused hoặc thiếu config thì bỏ qua', () => {
    const { service } = createSvc();
    assert.equal(service.shouldSkip({ paused: true }), true);
    assert.equal(service.shouldSkip({ paused: false }), false);
    assert.equal(service.shouldSkip(null), true);
});

test('FETCH_WINDOW bao phủ mọi dải cấu hình hợp lệ', () => {
    assert.equal(FETCH_WINDOW.minutesMin, Math.min(RULE_RANGES.due_soon_minutes.min, RULE_RANGES.not_accepted_minutes.min));
    assert.equal(FETCH_WINDOW.minutesMax, RULE_RANGES.due_soon_minutes.max);
    assert.equal(FETCH_WINDOW.hoursMax, RULE_RANGES.form_due_soon_hours.max);
});

test('alias map có đủ 5 trường cấu hình', () => {
    const targets = new Set(Object.values(RULE_FIELD_ALIASES));
    assert.deepEqual([...targets].sort(), [
        'due_soon_minutes', 'form_due_soon_hours', 'form_overdue_manager_hours',
        'not_accepted_minutes', 'overdue_manager_hours'
    ]);
});

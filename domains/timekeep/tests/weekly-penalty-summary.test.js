import test from 'node:test';
import assert from 'node:assert/strict';
import moment from 'moment';
import {
    aggregateWeeklyPenalties,
    buildWeeklyPenaltyMessage
} from '../domain/weekly-penalty-summary.js';
import { createRunWeeklyPenaltySummary } from '../application/run-weekly-penalty-summary.js';
import { registerWeeklyPenaltyCron } from '../interfaces/cron/register-weekly-penalty-cron.js';

/* ---------- Tổng hợp domain ---------- */

test('gộp dòng phạt tuần về từng nhân viên, tách đúng ba nhóm vi phạm', () => {
    const rows = [
        { group_id: 'g1', user_id: 'u1', full_name: 'Nguyễn Văn A', violation_type: 'LATE', late_minutes: 12, amount: 20000 },
        { group_id: 'g1', user_id: 'u1', full_name: 'Nguyễn Văn A', violation_type: 'LATE', late_minutes: 35, amount: 30000 },
        { group_id: 'g1', user_id: 'u1', full_name: 'Nguyễn Văn A', violation_type: 'SUDDEN_LEAVE', late_minutes: 0, amount: 100000 },
        { group_id: 'g1', user_id: 'u2', full_name: 'Trần Thị B', violation_type: 'UNAUTHORIZED_ABSENT', late_minutes: 0, amount: 50000 },
        { group_id: 'g1', user_id: 'u2', full_name: 'Trần Thị B', violation_type: 'CONSECUTIVE_LEAVE', late_minutes: 0, amount: 200000 }
    ];

    const employees = aggregateWeeklyPenalties(rows);

    assert.equal(employees.length, 2);
    const a = employees.find(employee => employee.userId === 'u1');
    assert.deepEqual(
        { lateCount: a.lateCount, lateMinutesList: a.lateMinutesList, lateAmount: a.lateAmount, suddenLeaveCount: a.suddenLeaveCount, totalAmount: a.totalAmount },
        { lateCount: 2, lateMinutesList: [12, 35], lateAmount: 50000, suddenLeaveCount: 1, totalAmount: 150000 }
    );
    const b = employees.find(employee => employee.userId === 'u2');
    assert.equal(b.absentCount, 1);
    assert.equal(b.suddenLeaveCount, 1);
    assert.equal(b.totalAmount, 250000);
});

test('bỏ qua dòng đã miễn trừ (amount = 0) và loại vi phạm ngoài danh sách', () => {
    const rows = [
        { group_id: 'g1', user_id: 'u1', full_name: 'A', violation_type: 'LATE', late_minutes: 10, amount: 0 },
        { group_id: 'g1', user_id: 'u1', full_name: 'A', violation_type: 'DRESS_CODE', late_minutes: 0, amount: 50000 }
    ];

    assert.equal(aggregateWeeklyPenalties(rows).length, 0);
    assert.equal(aggregateWeeklyPenalties([]).length, 0);
});

/* ---------- Soạn tin ---------- */

test('tin tổng kết đủ ba loại phạt, tổng từng người và tổng nhóm', () => {
    const employees = aggregateWeeklyPenalties([
        { group_id: 'g1', user_id: 'u1', full_name: 'Nguyễn Văn A', violation_type: 'LATE', late_minutes: 12, amount: 20000 },
        { group_id: 'g1', user_id: 'u1', full_name: 'Nguyễn Văn A', violation_type: 'LATE', late_minutes: 35, amount: 30000 },
        { group_id: 'g1', user_id: 'u1', full_name: 'Nguyễn Văn A', violation_type: 'SUDDEN_LEAVE', late_minutes: 0, amount: 100000 },
        { group_id: 'g1', user_id: 'u2', full_name: 'Trần Thị B', violation_type: 'UNAUTHORIZED_ABSENT', late_minutes: 0, amount: 50000 }
    ]);

    const msg = buildWeeklyPenaltyMessage({
        groupName: '00. CHECK IN vp Nam Đồng',
        startDate: '2026-09-28',
        endDate: '2026-10-04',
        employees
    });

    assert.match(msg, /TỔNG HỢP PHẠT CHẤM CÔNG TUẦN \(28\/09\/2026 → 04\/10\/2026\)/);
    assert.match(msg, /00\. CHECK IN vp Nam Đồng/);
    assert.match(msg, /Đi muộn 2 lần \(12p, 35p\): 50\.000đ/);
    assert.match(msg, /Nghỉ đột xuất không phép 1 lần: 100\.000đ/);
    assert.match(msg, /Vắng không phép 1 ngày: 50\.000đ/);
    assert.match(msg, /→ Tổng: <b>150\.000đ<\/b>/);
    assert.match(msg, /Tổng nhóm: <b>2<\/b> người vi phạm — <b>200\.000đ<\/b> \(4 lần vi phạm\)/);
});

test('tuần không ai vi phạm vẫn gửi tin báo sạch', () => {
    const msg = buildWeeklyPenaltyMessage({
        groupName: '00. CHECK IN vp Nam Đồng',
        startDate: '2026-09-28',
        endDate: '2026-10-04',
        employees: []
    });

    assert.match(msg, /TỔNG HỢP PHẠT CHẤM CÔNG TUẦN/);
    assert.match(msg, /không có nhân sự nào vi phạm/);
});

test('tên nhân viên được thoát HTML trước khi đưa vào tin', () => {
    const employees = aggregateWeeklyPenalties([
        { group_id: 'g1', user_id: 'u1', full_name: '<b>Hacker</b>', violation_type: 'LATE', late_minutes: 5, amount: 20000 }
    ]);

    const msg = buildWeeklyPenaltyMessage({ startDate: '2026-09-28', endDate: '2026-10-04', employees });

    assert.match(msg, /&lt;b&gt;Hacker&lt;\/b&gt;/);
    assert.doesNotMatch(msg, /<b>Hacker<\/b>/);
});

/* ---------- Ứng dụng: cửa sổ tuần và khóa chống trùng ---------- */

function buildAppRepository({ lockAcquired = true, groups = [], rows = [] }) {
    const calls = { lockedKeys: [], releasedKeys: [], queriedGroupIds: null, queriedWindow: null };
    return {
        repository: {
            async findWeeklySummaryGroups() { return groups; },
            async findWeeklyPenaltyRows({ groupIds, startDate, endDate }) {
                calls.queriedGroupIds = groupIds;
                calls.queriedWindow = { startDate, endDate };
                return rows;
            },
            async acquireWeeklySummaryLock(key) {
                calls.lockedKeys.push(key);
                return lockAcquired;
            },
            async releaseWeeklySummaryLock(key) { calls.releasedKeys.push(key); }
        },
        calls
    };
}

test('tính tuần Thứ Hai → Chủ nhật kể cả khi chạy tối Chủ nhật', async () => {
    const { repository, calls } = buildAppRepository({
        groups: [{ group_uuid: 'g1', telegram_group_id: '-100', group_name: '00. CHECK IN vp Nam Đồng' }],
        rows: []
    });
    const sent = [];
    const { runWeeklyPenaltySummary } = createRunWeeklyPenaltySummary({
        repository, bot: {}, moment,
        sendMessageToRoleGroup: async (_bot, groupId, role, message, options, source) => {
            sent.push({ groupId, role, options, source, message });
            return { message_id: 1 };
        }
    });

    // 2026-10-04 là Chủ nhật, 20:30 giờ VN.
    const result = await runWeeklyPenaltySummary(moment('2026-10-04T20:30:00+07:00'));

    assert.equal(result.sent, true);
    assert.deepEqual(calls.queriedWindow, { startDate: '2026-09-28', endDate: '2026-10-04' });
    assert.deepEqual(calls.lockedKeys, ['timekeep_weekly_penalty_-100_2026-10-04']);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].groupId, '-100');
    assert.equal(sent[0].role, 'timekeep');
    assert.equal(sent[0].source, 'weekly_penalty_summary');
    assert.deepEqual(sent[0].options, { parse_mode: 'HTML' });
    assert.match(sent[0].message, /TỔNG HỢP PHẠT CHẤM CÔNG TUẦN \(28\/09\/2026 → 04\/10\/2026\)/);
});

test('tuần đã gửi rồi thì không gửi lại', async () => {
    const { repository, calls } = buildAppRepository({
        lockAcquired: false,
        groups: [{ group_uuid: 'g1', telegram_group_id: '-100', group_name: '00. CHECK IN vp Nam Đồng' }]
    });
    let sent = 0;
    const { runWeeklyPenaltySummary } = createRunWeeklyPenaltySummary({
        repository, bot: {}, moment,
        sendMessageToRoleGroup: async () => { sent += 1; return { message_id: 1 }; }
    });

    const result = await runWeeklyPenaltySummary(moment('2026-10-04T21:00:00+07:00'));

    assert.equal(result.sent, false);
    assert.equal(sent, 0);
    assert.equal(calls.releasedKeys.length, 0);
});

test('gửi lỗi thì nhả khóa để tick phút sau gửi lại', async () => {
    const { repository, calls } = buildAppRepository({
        lockAcquired: true,
        groups: [{ group_uuid: 'g1', telegram_group_id: '-100', group_name: '00. CHECK IN vp Nam Đồng' }]
    });
    const { runWeeklyPenaltySummary } = createRunWeeklyPenaltySummary({
        repository, bot: {}, moment,
        sendMessageToRoleGroup: async () => null
    });

    const result = await runWeeklyPenaltySummary(moment('2026-10-04T21:00:00+07:00'));

    assert.equal(result.sent, false);
    assert.deepEqual(calls.releasedKeys, ['timekeep_weekly_penalty_-100_2026-10-04']);
});

test('không tìm thấy nhóm cấu hình thì không gửi gì', async () => {
    const { repository } = buildAppRepository({ groups: [] });
    let sent = 0;
    const { runWeeklyPenaltySummary } = createRunWeeklyPenaltySummary({
        repository, bot: {}, moment,
        sendMessageToRoleGroup: async () => { sent += 1; }
    });

    const result = await runWeeklyPenaltySummary(moment('2026-10-04T21:00:00+07:00'));

    assert.equal(result.sent, false);
    assert.equal(sent, 0);
});

/* ---------- Cron: chỉ chạy tối Chủ nhật 20:05 → 23:59 ---------- */

function makeFakeMoment(day, timeStr) {
    return () => ({ utcOffset: () => ({ day: () => day, format: () => timeStr }) });
}

function scheduleCron({ day, timeStr, runCount }) {
    let captured = null;
    registerWeeklyPenaltyCron({
        cron: {
            schedule: (_expression, handler) => { captured = handler; return { stop() {} }; }
        },
        runWeeklyPenaltySummary: async () => { runCount.value += 1; },
        moment: makeFakeMoment(day, timeStr)
    });
    return captured;
}

test('cron chỉ gửi trong khung tối Chủ nhật 20:05 → 23:59', async () => {
    for (const [day, timeStr, shouldRun] of [
        [0, '20:04', false],
        [0, '20:05', true],
        [0, '23:59', true],
        [1, '21:00', false],
        [6, '20:30', false],
        [0, '00:00', false]
    ]) {
        const runCount = { value: 0 };
        const handler = scheduleCron({ day, timeStr, runCount });
        await handler();
        assert.equal(runCount.value > 0, shouldRun, `day=${day} time=${timeStr}`);
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import moment from 'moment';
import { createRunLatePenaltyCheck } from '../application/run-late-penalty-check.js';

function buildRepository({ checkin, approvedLateLeave, latePenaltyCountInMonth = 1 }) {
    const inserted = [];
    const statuses = [];
    return {
        repository: {
            async findFirstCheckInsOfDay() { return [checkin]; },
            async findExistingLatePenalty() { return null; },
            async findLatePenaltyCountInMonth() { return latePenaltyCountInMonth; },
            async findApprovedLateLeaveRequest() { return approvedLateLeave; },
            async insertLatePenalty(payload) { inserted.push(payload); },
            async upsertAttendanceResult(groupId, userId, date, result) { statuses.push(result); }
        },
        inserted,
        statuses
    };
}

function buildCheckin({ shiftStart, checkInTime, shiftType = 'CA_SANG' }) {
    return {
        group_id: 'g1', user_id: 'u1', date: '2026-08-24', telegram_group_id: '-100',
        full_name: 'Test User', shift_type: shiftType, shift_1_time: shiftStart, shift_2_time: shiftStart,
        check_in_time: `2026-08-24 ${checkInTime}`
    };
}

test('đến trong vòng 32 phút đầu vẫn tính ON_TIME, không ghi phạt dù không báo trước', async () => {
    const checkin = buildCheckin({ shiftStart: '08:30:00', checkInTime: '09:02:00' }); // muộn đúng 32 phút
    const { repository, inserted, statuses } = buildRepository({ checkin, approvedLateLeave: null });
    const { runLatePenaltyCheck } = createRunLatePenaltyCheck({ repository, sendMessageToRoleGroup: async () => {}, bot: {}, moment });

    await runLatePenaltyCheck({ todayStr: '2026-08-24', currentMonth: 8, currentYear: 2026 });

    assert.equal(inserted.length, 0);
    assert.deepEqual(statuses, ['ON_TIME']);
});

test('ân hạn 32 phút áp dụng cho mọi ca, kể cả ca chiều', async () => {
    const checkin = buildCheckin({ shiftStart: '13:30:00', checkInTime: '14:02:00', shiftType: 'CA_CHIEU' }); // muộn 32 phút
    const { repository, inserted, statuses } = buildRepository({ checkin, approvedLateLeave: null });
    const { runLatePenaltyCheck } = createRunLatePenaltyCheck({ repository, sendMessageToRoleGroup: async () => {}, bot: {}, moment });

    await runLatePenaltyCheck({ todayStr: '2026-08-24', currentMonth: 8, currentYear: 2026 });

    assert.equal(inserted.length, 0);
    assert.deepEqual(statuses, ['ON_TIME']);
});

test('từ phút thứ 33 trở đi mới ghi nhận đi muộn', async () => {
    const checkin = buildCheckin({ shiftStart: '08:30:00', checkInTime: '09:03:00' }); // muộn 33 phút
    const { repository, inserted } = buildRepository({ checkin, approvedLateLeave: null });
    const { runLatePenaltyCheck } = createRunLatePenaltyCheck({ repository, sendMessageToRoleGroup: async () => {}, bot: {}, moment });

    await runLatePenaltyCheck({ todayStr: '2026-08-24', currentMonth: 8, currentYear: 2026 });

    // 33 phút, lần thứ 2 trong tháng: 20000 + (33-15)*2000 = 56000
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].amount, 56000);
    assert.equal(inserted[0].lateMinutes, 33);
});

test('có báo trước đúng trong hạn đã khai (đến muộn <= số phút đã báo, sau khi vượt ân hạn) => miễn phạt hoàn toàn', async () => {
    const checkin = buildCheckin({ shiftStart: '08:30:00', checkInTime: '09:05:00' }); // muộn 35 phút
    const { repository, inserted } = buildRepository({
        checkin, approvedLateLeave: { id: 'req-1', late_minutes: 40 } // đã báo trước 40 phút
    });
    const { runLatePenaltyCheck } = createRunLatePenaltyCheck({ repository, sendMessageToRoleGroup: async () => {}, bot: {}, moment });

    await runLatePenaltyCheck({ todayStr: '2026-08-24', currentMonth: 8, currentYear: 2026 });

    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].amount, 0);
    assert.match(inserted[0].reason, /đến đúng trong thời gian đã báo/);
});

test('có báo trước nhưng đến muộn hơn số phút đã khai => vẫn giảm 50%, không miễn', async () => {
    const checkin = buildCheckin({ shiftStart: '08:30:00', checkInTime: '09:10:00' }); // muộn 40 phút
    const { repository, inserted } = buildRepository({
        checkin, approvedLateLeave: { id: 'req-1', late_minutes: 35 } // chỉ báo trước 35 phút
    });
    const { runLatePenaltyCheck } = createRunLatePenaltyCheck({ repository, sendMessageToRoleGroup: async () => {}, bot: {}, moment });

    await runLatePenaltyCheck({ todayStr: '2026-08-24', currentMonth: 8, currentYear: 2026 });

    // 40 phút, lần thứ 2 trong tháng: 20000 + (40-15)*2000 = 70000, giảm 50% = 35000
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].amount, 35000);
    assert.match(inserted[0].reason, /Đã giảm 50%/);
});

test('không có đơn báo trước nào => phạt đầy đủ theo số phút muộn thực tế', async () => {
    const checkin = buildCheckin({ shiftStart: '08:30:00', checkInTime: '09:10:00' }); // muộn 40 phút
    const { repository, inserted } = buildRepository({ checkin, approvedLateLeave: null });
    const { runLatePenaltyCheck } = createRunLatePenaltyCheck({ repository, sendMessageToRoleGroup: async () => {}, bot: {}, moment });

    await runLatePenaltyCheck({ todayStr: '2026-08-24', currentMonth: 8, currentYear: 2026 });

    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].amount, 70000);
});

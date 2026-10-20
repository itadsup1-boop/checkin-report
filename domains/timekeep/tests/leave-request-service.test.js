import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    effectiveShiftForRequest,
    snapshotSchedule
} from '../application/leave-request-service.js';

test('maps immediate leave request types to the effective schedule', () => {
    assert.equal(effectiveShiftForRequest('FULL_DAY'), 'OFF');
    assert.equal(effectiveShiftForRequest('HALF_DAY_AM'), 'HALF_DAY_PM_WORK');
    assert.equal(effectiveShiftForRequest('HALF_DAY_PM'), 'CA_SANG');
    assert.equal(effectiveShiftForRequest('LATE'), null);
});

test('captures enough schedule state to restore after rejection', () => {
    assert.deepEqual(snapshotSchedule(null), { existed: false });
    assert.deepEqual(snapshotSchedule({
        group_id: 'group-1',
        shift_type: 'CA_SANG',
        is_locked: false,
        proof_url: '/proof.jpg',
        updated_by: 'Admin A'
    }), {
        existed: true,
        groupId: 'group-1',
        shiftType: 'CA_SANG',
        isLocked: false,
        proofUrl: '/proof.jpg',
        updatedBy: 'Admin A'
    });
});

test('new requests are auto-accepted and group notification only exposes reject', () => {
    const route = fs.readFileSync(new URL('../application/save-leave-request.js', import.meta.url), 'utf8');

    assert.match(route, /createAutoAcceptedLeaveRequest\(\{/);
    assert.match(route, /ĐƠN ĐÃ ĐƯỢC TỰ ĐỘNG CHẤP NHẬN/);
    assert.match(route, /callback_data: `reject_leave_\$\{requestId\}`/);
    assert.doesNotMatch(route, /callback_data: `approve_leave_\$\{requestId\}`/);
});

test('only APPROVED requests affect absence and late penalty rules', () => {
    const penaltyRepo = fs.readFileSync(new URL('../infrastructure/postgres/penalty-repository.js', import.meta.url), 'utf8');
    const attendanceCronRepo = fs.readFileSync(new URL('../infrastructure/postgres/attendance-cron-repository.js', import.meta.url), 'utf8');

    assert.match(penaltyRepo, /UPPER\(r\.status\) = 'APPROVED'/);
    assert.match(attendanceCronRepo, /request_type = 'LATE'[\s\S]{0,120}status = 'APPROVED'/);
});

test('monthly late request quota: max 3 approved per month, rejects from 4th', async () => {
    const { getMonthDateRange, checkLateRequestMonthlyQuota, MAX_MONTHLY_LATE_REQUESTS } = await import('../domain/leave-request-rules.js');

    assert.equal(MAX_MONTHLY_LATE_REQUESTS, 3);

    const range = getMonthDateRange('2026-10-14');
    assert.equal(range.startOfMonth, '2026-10-01');
    assert.equal(range.endOfMonth, '2026-10-31');
    assert.equal(range.monthStr, '10/2026');

    // 0 approved requests used
    const q0 = checkLateRequestMonthlyQuota({ approvedCount: 0 });
    assert.equal(q0.isExceeded, false);
    assert.equal(q0.used, 0);
    assert.equal(q0.remaining, 3);

    // 2 approved requests used -> 3rd request is allowed
    const q2 = checkLateRequestMonthlyQuota({ approvedCount: 2 });
    assert.equal(q2.isExceeded, false);
    assert.equal(q2.used, 2);
    assert.equal(q2.remaining, 1);

    // 3 approved requests used -> 4th request is EXCEEDED (auto-rejected)
    const q3 = checkLateRequestMonthlyQuota({ approvedCount: 3 });
    assert.equal(q3.isExceeded, true);
    assert.equal(q3.used, 3);
    assert.equal(q3.remaining, 0);

    const route = fs.readFileSync(new URL('../application/save-leave-request.js', import.meta.url), 'utf8');
    assert.match(route, /countApprovedLateRequestsInMonth/);
    assert.match(route, /ĐÃ TỰ ĐỘNG TỪ CHỐI YÊU CẦU ĐI MUỘN/);
});

test('urgent leave requests do not credit checkin work', () => {
    const serviceContent = fs.readFileSync(new URL('../application/leave-request-service.js', import.meta.url), 'utf8');
    const reviewContent = fs.readFileSync(new URL('../application/review-leave-request.js', import.meta.url), 'utf8');

    assert.doesNotMatch(serviceContent, /creditClientMeetingCheckin/);
    assert.doesNotMatch(reviewContent, /creditClientMeetingCheckin/);
});



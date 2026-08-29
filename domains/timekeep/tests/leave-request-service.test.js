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

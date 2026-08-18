import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    effectiveShiftForRequest,
    snapshotSchedule
} from '../leave-request-service.js';

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
    const source = fs.readFileSync(new URL('../../../apps/bot/timekeep_bot.js', import.meta.url), 'utf8');
    const routeStart = source.indexOf("botApp.post('/api/timekeep/leave-request/save'");
    const routeEnd = source.indexOf("botApp.post('/api/timekeep/checkin/save'", routeStart);
    const route = source.slice(routeStart, routeEnd);

    assert.match(route, /createAutoAcceptedLeaveRequest\(\{/);
    assert.match(route, /ĐƠN ĐÃ ĐƯỢC TỰ ĐỘNG CHẤP NHẬN/);
    assert.match(route, /callback_data: `reject_leave_\$\{requestId\}`/);
    assert.doesNotMatch(route, /callback_data: `approve_leave_\$\{requestId\}`/);
});

test('only APPROVED requests affect absence and late penalty rules', () => {
    const attendance = fs.readFileSync(new URL('../attendance-penalties.js', import.meta.url), 'utf8');
    const bot = fs.readFileSync(new URL('../../../apps/bot/timekeep_bot.js', import.meta.url), 'utf8');

    assert.match(attendance, /UPPER\(r\.status\) = 'APPROVED'/);
    assert.match(bot, /request_type = 'LATE'[\s\S]{0,120}status = 'APPROVED'/);
});

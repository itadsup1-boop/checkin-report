import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildAbsenceNotificationText,
    groupAbsenceNotifications,
    TIMEKEEP_PENALTIES
} from '../application/attendance-penalties.js';

test('groups absence notifications by Telegram group', () => {
    const groups = groupAbsenceNotifications([
        {
            group_id: 'group-a',
            user_id: 'user-1',
            date: '2026-08-13',
            full_name: 'Nhân sự A',
            telegram_group_id: '-1001',
            group_name: 'Nhóm A'
        },
        {
            group_id: 'group-a',
            user_id: 'user-2',
            date: '2026-08-13',
            full_name: 'Nhân sự B',
            telegram_group_id: '-1001',
            group_name: 'Nhóm A'
        },
        {
            group_id: 'group-b',
            user_id: 'user-3',
            date: '2026-08-13',
            full_name: 'Nhân sự C',
            telegram_group_id: '-1002',
            group_name: 'Nhóm B'
        }
    ]);

    assert.equal(groups.length, 2);
    assert.equal(groups[0].employees.length, 2);
    assert.equal(groups[1].employees.length, 1);
});

test('builds a 14:00 notice with per-person and total penalties', () => {
    const text = buildAbsenceNotificationText({
        date: '2026-08-13',
        employees: [
            { userId: 'user-1', fullName: 'Nhân sự A' },
            { userId: 'user-2', fullName: 'Nhân sự B' }
        ]
    });

    assert.match(text, /14:00/);
    assert.match(text, /13\/08\/2026/);
    assert.match(text, /Nhân sự A — phạt 50\.000đ/);
    assert.match(text, /100\.000đ/);
    assert.equal(TIMEKEEP_PENALTIES.UNAUTHORIZED_ABSENT, 50000);
});

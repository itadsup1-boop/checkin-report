import test from 'node:test';
import assert from 'node:assert/strict';
import moment from 'moment';
import { createRunShiftReminders } from '../application/run-shift-reminders.js';

test('runShiftReminders: excludes approved late requests from 8:32 warning and alerts them at shiftStart + lateMinutes + 2m', async () => {
    const sentMessages = [];
    const markedLateWarnings = [];

    const mockRepository = {
        async findTimekeepGroupsWithShiftTimes() {
            return [{
                group_uuid: 'g-1',
                telegram_group_id: -100123456,
                group_name: 'Nhóm Test',
                shift_1_time: '08:30:00',
                shift_2_time: '13:30:00'
            }];
        },
        async findUncheckedForShift() {
            return [];
        },
        async findLateForShift({ date, shiftTypes }) {
            // Only regular late employees returned here (approved LATE requests already excluded in SQL)
            return [{ user_id: 'u-regular', full_name: 'Trần Văn A' }];
        },
        async findApprovedLateRequestsForShift({ date, shiftTypes }) {
            return [
                { user_id: 'u-late-10', full_name: 'Nguyễn Văn B', late_minutes: 10 }
            ];
        },
        async markReminderSent() {},
        async markLateWarningSent(groupUuid, userId, date) {
            markedLateWarnings.push({ groupUuid, userId, date });
        }
    };

    const mockSendMessage = async (bot, groupId, role, msg, options, source) => {
        sentMessages.push({ groupId, role, msg, source });
        return { message_id: 1 };
    };

    const { runShiftReminders } = createRunShiftReminders({
        repository: mockRepository,
        sendMessageToRoleGroup: mockSendMessage,
        bot: {},
        moment
    });

    // 1. At 08:32 (normal late alert: 08:30 + 2m):
    // Only regular late employee is alerted. Nguyễn Văn B (xin muộn 10p) should NOT be alerted for overdue.
    const dirtyAt832 = await runShiftReminders({ todayStr: '2026-09-20', currentTimeStr: '08:32' });
    assert.equal(dirtyAt832, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].msg, /Trần Văn A/);
    assert.doesNotMatch(sentMessages[0].msg, /Nguyễn Văn B/);
    assert.equal(markedLateWarnings.length, 1);
    assert.equal(markedLateWarnings[0].userId, 'u-regular');

    // 2. At 08:33 or 08:40: Nguyễn Văn B still shouldn't be alerted yet
    sentMessages.length = 0;
    markedLateWarnings.length = 0;
    await runShiftReminders({ todayStr: '2026-09-20', currentTimeStr: '08:33' });
    assert.equal(sentMessages.length, 0);

    await runShiftReminders({ todayStr: '2026-09-20', currentTimeStr: '08:40' });
    assert.equal(sentMessages.length, 0);

    // 3. At 08:42 (08:30 + 10m + 2m):
    // Nguyễn Văn B is now overdue and should be alerted!
    const dirtyAt842 = await runShiftReminders({ todayStr: '2026-09-20', currentTimeStr: '08:42' });
    assert.equal(dirtyAt842, true);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].source, 'checkin_late_overdue_warning');
    assert.match(sentMessages[0].msg, /THÔNG BÁO ĐI MUỘN QUÁ HẠN XIN PHÉP/);
    assert.match(sentMessages[0].msg, /Nguyễn Văn B/);
    assert.match(sentMessages[0].msg, /xin muộn 10 phút/);
    assert.equal(markedLateWarnings.length, 1);
    assert.equal(markedLateWarnings[0].userId, 'u-late-10');
});

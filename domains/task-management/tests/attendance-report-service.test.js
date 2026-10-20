import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNlpMessage } from '../interfaces/telegram/nlp-parser.js';
import { createAttendanceReportService } from '../application/attendance-report-service.js';

const manager = { status: 'ACTIVE', scopes: [] };

function createAccess() {
    return {
        isWithinScope() { return true; },
        hasPermission() { return true; },
        async getManager() { return manager; }
    };
}

test('NLU báo cáo: đi muộn, thống kê theo nhóm/khoảng ngày và lịch hằng ngày', () => {
    assert.deepEqual(parseNlpMessage('Hôm nay ai đi làm muộn?'), {
        command: 'baocaodiem', metric: 'late', groupQuery: null,
        fromInput: 'Hôm nay', toInput: 'Hôm nay'
    });
    const summary = parseNlpMessage('Báo cáo thống kê nhóm Kinh doanh từ 01/10/2026 đến 20/10/2026');
    assert.equal(summary.command, 'baocaodiem');
    assert.equal(summary.metric, 'summary');
    assert.equal(summary.groupQuery, 'Kinh doanh');
    assert.equal(summary.fromInput, '01/10/2026');
    assert.equal(summary.toInput, '20/10/2026');
    assert.deepEqual(parseNlpMessage('Hàng ngày lúc 18h gửi báo cáo nhóm Marketing cho tôi'), {
        command: 'datbaocao', metric: 'summary', groupQuery: 'Marketing',
        fromInput: null, toInput: null, frequency: 'DAILY', timeInput: 'lúc 18h'
    });
});

test('attendance report: liệt kê người muộn và tổng hợp theo nhóm', async () => {
    const repository = {
        async listGroups() { return [{ id: 'g1', telegram_group_id: '-1001', group_name: 'Marketing' }]; },
        async listAttendanceForDate() {
            return [{ group_id: 'g1', group_name: 'Marketing', full_name: 'Nguyễn Văn A', report_date: '2026-10-20', is_late: true, late_minutes: 14, check_in_time: '2026-10-20T02:14:00.000Z' }];
        },
        async summarizeAttendance() {
            return [{ group_name: 'Marketing', active_employee_count: 5, scheduled_count: 5, checkin_count: 4, late_count: 1, absent_count: 1, on_time_count: 3, penalty_total: 20000 }];
        }
    };
    const service = createAttendanceReportService({ reportRepository: repository, accessService: createAccess(), taskRepository: {} });
    const late = await service.buildReport({
        manager, intent: { metric: 'late', groupQuery: 'Marketing', fromInput: 'hôm nay', toInput: 'hôm nay' },
        now: new Date('2026-10-20T05:00:00.000Z')
    });
    assert.match(late, /DANH SÁCH ĐI LÀM MUỘN/);
    assert.match(late, /Nguyễn Văn A/);

    const summary = await service.buildReport({
        manager, intent: { metric: 'summary', groupQuery: 'Marketing', fromInput: '01\/10\/2026', toInput: '20\/10\/2026' },
        now: new Date('2026-10-20T05:00:00.000Z')
    });
    assert.match(summary, /Nhóm Marketing/);
    assert.match(summary, /Đi muộn: 1/);
});

test('attendance report: chuẩn hóa ngày/giờ và tạo lịch cho toàn bộ nhóm trùng tên', async () => {
    const created = [];
    const repository = {
        async listGroups() {
            return [
                { id: 'g1', telegram_group_id: '-1001', group_name: 'Kinh doanh' },
                { id: 'g2', telegram_group_id: '-1002', group_name: 'Kinh doanh miền Nam' }
            ];
        },
        async createSchedule(input) { created.push(input); return input; }
    };
    const service = createAttendanceReportService({ reportRepository: repository, accessService: createAccess(), taskRepository: {} });
    assert.equal(service.parseTimeInput('5h chiều'), '17:00');
    assert.equal(service.parseDateInput('20/10/2026', new Date()), '2026-10-20');
    const result = await service.scheduleDaily({
        manager, managerId: '42', chatId: '42',
        intent: { groupQuery: 'Kinh doanh', timeInput: '5h chiều' }
    });
    assert.equal(result.localTime, '17:00');
    assert.equal(created.length, 2);
});

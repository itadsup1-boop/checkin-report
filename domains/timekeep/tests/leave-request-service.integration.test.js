import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../../../packages/database/index.js';
import {
    createAutoAcceptedLeaveRequest,
    rejectAutoAcceptedLeaveRequest
} from '../application/leave-request-service.js';

if (!String(process.env.DATABASE_URL || '').endsWith('/telegram_kpi_test')) {
    throw new Error('Integration test chỉ được chạy trên database telegram_kpi_test.');
}

const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const ids = { groupId: null, employeeId: null };
const groupTelegramId = `-996${String(Date.now()).slice(-9)}`;

before(async () => {
    const group = await pool.query(
        `INSERT INTO telegram_groups
            (telegram_group_id, group_name, bot_role, is_active, is_deleted)
         VALUES ($1, $2, 'timekeep', TRUE, FALSE)
         RETURNING id`,
        [groupTelegramId, `Timekeep Auto Leave ${suffix}`]
    );
    ids.groupId = group.rows[0].id;

    const employee = await pool.query(
        `INSERT INTO employees
            (employee_code, full_name, telegram_id, telegram_group_id,
             group_id, department, position, role, is_active)
         VALUES ($1, 'Nhân sự test nghỉ tự động', $2, $3,
                 $4, 'Test', 'Staff', 'Nhân viên', TRUE)
         RETURNING id`,
        [`TK-AUTO-${suffix}`, `77${String(Date.now()).slice(-8)}`, groupTelegramId, ids.groupId]
    );
    ids.employeeId = employee.rows[0].id;
});

after(async () => {
    if (ids.employeeId) {
        await pool.query('DELETE FROM tk_penalties WHERE user_id = $1', [ids.employeeId]);
        await pool.query('DELETE FROM tk_attendance_daily_status WHERE user_id = $1', [ids.employeeId]);
        await pool.query('DELETE FROM tk_leave_requests WHERE user_id = $1', [ids.employeeId]);
        await pool.query('DELETE FROM tk_schedules WHERE user_id = $1', [ids.employeeId]);
        await pool.query('DELETE FROM employees WHERE id = $1', [ids.employeeId]);
    }
    if (ids.groupId) await pool.query('DELETE FROM telegram_groups WHERE id = $1', [ids.groupId]);
    await pool.end();
});

test('full-day request applies immediately and rejection restores the exact old shift', async () => {
    const date = '2099-08-10';
    await pool.query(
        `INSERT INTO tk_schedules
            (group_id, user_id, date, shift_type, is_locked, updated_by)
         VALUES ($1, $2, $3, 'CA_SANG', FALSE, 'Original Admin')`,
        [ids.groupId, ids.employeeId, date]
    );

    const created = await createAutoAcceptedLeaveRequest({
        pool,
        groupId: ids.groupId,
        userId: ids.employeeId,
        requestType: 'FULL_DAY',
        date,
        reason: 'Nghỉ đột xuất test'
    });

    assert.equal(created.request.status, 'APPROVED');
    assert.equal(created.request.auto_accepted, true);
    assert.equal(created.request.previous_schedule.shiftType, 'CA_SANG');

    const activeSchedule = await pool.query(
        'SELECT shift_type, is_locked FROM tk_schedules WHERE user_id = $1 AND date = $2',
        [ids.employeeId, date]
    );
    assert.deepEqual(activeSchedule.rows[0], { shift_type: 'OFF', is_locked: true });

    const rejected = await rejectAutoAcceptedLeaveRequest({
        pool,
        requestId: created.request.id,
        rejectedBy: 'Manager Test'
    });
    assert.equal(rejected.result, 'REJECTED');

    const restoredSchedule = await pool.query(
        'SELECT shift_type, is_locked, updated_by FROM tk_schedules WHERE user_id = $1 AND date = $2',
        [ids.employeeId, date]
    );
    assert.deepEqual(restoredSchedule.rows[0], {
        shift_type: 'CA_SANG',
        is_locked: false,
        updated_by: 'Original Admin'
    });
});

test('rejecting an accepted late request removes its 50 percent discount', async () => {
    const date = '2099-08-11';
    const created = await createAutoAcceptedLeaveRequest({
        pool,
        groupId: ids.groupId,
        userId: ids.employeeId,
        requestType: 'LATE',
        lateMinutes: 10,
        date,
        reason: 'Xin đi muộn test'
    });

    await pool.query(
        `INSERT INTO tk_penalties
            (group_id, user_id, date, violation_type, late_minutes, amount, reason, is_paid)
         VALUES ($1, $2, $3, 'LATE', 10, 10000,
                 'Đi muộn lần 2 trong tháng (10 phút - dưới 15p) (Đã giảm 50% do có đơn báo trước)', FALSE)`,
        [ids.groupId, ids.employeeId, date]
    );

    await rejectAutoAcceptedLeaveRequest({
        pool,
        requestId: created.request.id,
        rejectedBy: 'Manager Test'
    });

    const penalty = await pool.query(
        `SELECT amount, reason FROM tk_penalties
         WHERE user_id = $1 AND date = $2 AND violation_type = 'LATE'`,
        [ids.employeeId, date]
    );
    assert.equal(penalty.rows[0].amount, 20000);
    assert.doesNotMatch(penalty.rows[0].reason, /giảm 50%/);
});

test('rejecting a past full-day request restores absence processing for that employee', async () => {
    const date = '2026-08-15';
    await pool.query(
        `INSERT INTO tk_schedules
            (group_id, user_id, date, shift_type, is_locked, created_at)
         VALUES ($1, $2, $3, 'CA_SANG', FALSE, $3::date + TIME '08:00')`,
        [ids.groupId, ids.employeeId, date]
    );

    const created = await createAutoAcceptedLeaveRequest({
        pool,
        groupId: ids.groupId,
        userId: ids.employeeId,
        requestType: 'FULL_DAY',
        date,
        reason: 'Nghỉ đột xuất đã qua giờ chốt'
    });

    await rejectAutoAcceptedLeaveRequest({
        pool,
        requestId: created.request.id,
        rejectedBy: 'Manager Test',
        now: new Date('2026-08-16T03:00:00.000Z')
    });

    const status = await pool.query(
        `SELECT result FROM tk_attendance_daily_status
         WHERE group_id = $1 AND user_id = $2 AND date = $3`,
        [ids.groupId, ids.employeeId, date]
    );
    const penalty = await pool.query(
        `SELECT violation_type, amount FROM tk_penalties
         WHERE group_id = $1 AND user_id = $2 AND date = $3
           AND violation_type = 'UNAUTHORIZED_ABSENT'`,
        [ids.groupId, ids.employeeId, date]
    );
    assert.equal(status.rows[0].result, 'ABSENT');
    assert.deepEqual(penalty.rows[0], { violation_type: 'UNAUTHORIZED_ABSENT', amount: 50000 });
});

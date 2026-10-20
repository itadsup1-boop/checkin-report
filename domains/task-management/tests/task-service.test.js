import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createTaskService, vietnamToday, buildEodText
} from '../application/task-service.js';
import { RULE_DEFAULTS } from '../application/rule-config-service.js';

const FIXED_NOW = new Date('2026-10-19T10:00:00+07:00');

function createMockRepo() {
    const state = {
        tasks: [], assignees: [], events: [], outbox: [],
        extendRequests: [], checkins: new Map()
    };
    let seq = 100; // display_code bắt đầu như sequence v59
    let rowId = 1;

    const findTask = (id) => state.tasks.find(t => t.id === id);
    const findTaskByCode = (code) => state.tasks.find(t => t.display_code === Number(code));

    return {
        state,
        async createTaskWithAssignees({ task, assignees, idempotencyKey }) {
            if (state.tasks.some(t => t.idempotency_key === idempotencyKey)) {
                return { duplicated: true, task: state.tasks.find(t => t.idempotency_key === idempotencyKey) };
            }
            const created = {
                id: `task-${rowId++}`, display_code: seq++, title: task.title,
                description: task.description, status: 'ACTIVE', priority: task.priority,
                reminder_mode: task.reminderMode, due_at: task.dueAt,
                created_by: task.createdBy, idempotency_key: idempotencyKey
            };
            state.tasks.push(created);
            const createdAssignees = assignees.map(a => {
                const row = {
                    id: rowId++, task_id: created.id, employee_id: a.employeeId,
                    employee_code_snapshot: a.employeeCode, employee_name_snapshot: a.employeeName,
                    telegram_user_id_snapshot: a.telegramUserId, assignment_status: 'ASSIGNED',
                    assigned_at: FIXED_NOW, completed_at: null, accepted_at: null,
                    reviewed_at: null, review_note: null,
                    not_accepted_reminded_at: null, before_due_reminded_due_at: null,
                    overdue_reminded_at: null, overdue_manager_notified_at: null,
                    last_daily_reminded_on: null
                };
                state.assignees.push(row);
                return row;
            });
            state.events.push({ task_id: created.id, event_type: 'CREATED', actor_id: task.createdBy });
            for (const a of createdAssignees) {
                state.events.push({ task_id: created.id, assignee_id: a.id, event_type: 'ASSIGNED' });
            }
            return { duplicated: false, task: created, assignees: createdAssignees };
        },
        async findTaskByDisplayCode(code) { return findTaskByCode(code) || null; },
        async getTaskWithAssignees(taskId) {
            return { task: findTask(taskId), assignees: state.assignees.filter(a => a.task_id === taskId) };
        },
        async findAssigneeByTaskAndTelegram(taskId, tg) {
            return state.assignees.find(a => a.task_id === taskId && a.telegram_user_id_snapshot === String(tg)) || null;
        },
        async findAssigneeById(id) {
            const a = state.assignees.find(a => a.id === id);
            if (!a) return null;
            const t = findTask(a.task_id);
            return { ...a, title: t.title, due_at: t.due_at, created_by: t.created_by, task_status: t.status, display_code: t.display_code };
        },
        // mirrors real repo contract: camelCase patch in, snake_case columns out
        async updateAssigneeStatus(assigneeId, { status, acceptedAt = null, completedAt = null, reviewedAt = null, reviewedBy = null, reviewNote = null }) {
            const a = state.assignees.find(a => a.id === assigneeId);
            Object.assign(a, {
                assignment_status: status,
                accepted_at: acceptedAt ?? a.accepted_at,
                completed_at: completedAt ?? a.completed_at,
                reviewed_at: reviewedAt ?? a.reviewed_at,
                reviewed_by: reviewedBy ?? a.reviewed_by,
                review_note: reviewNote ?? a.review_note
            });
            return a;
        },
        async reopenAssignee(assigneeId, { reviewedBy, reviewNote }) {
            const a = state.assignees.find(a => a.id === assigneeId);
            Object.assign(a, { assignment_status: 'ACCEPTED', completed_at: null, reviewed_at: FIXED_NOW, reviewed_by: reviewedBy, review_note: reviewNote });
            return a;
        },
        async resetReminderFlags(assigneeId) {
            const a = state.assignees.find(a => a.id === assigneeId);
            Object.assign(a, { before_due_reminded_due_at: null, overdue_reminded_at: null, overdue_manager_notified_at: null });
        },
        // mirrors real repo contract: camelCase event in, snake_case columns stored
        async appendTaskEvent({ taskId, assigneeId = null, eventType, actorType, actorId, oldValues = null, newValues = null, reason = null }) {
            state.events.push({
                task_id: taskId, assignee_id: assigneeId, event_type: eventType,
                actor_type: actorType, actor_id: actorId,
                old_values: oldValues, new_values: newValues, reason
            });
        },
        async getLastComment(taskId, assigneeId) {
            const c = [...state.events].reverse().find(e => e.task_id === taskId && e.assignee_id === assigneeId && e.event_type === 'COMMENT');
            return c?.reason || null;
        },
        async cancelTask(taskId, { cancelledBy, reason }) {
            const t = findTask(taskId);
            if (t.status !== 'ACTIVE') return null;
            Object.assign(t, { status: 'CANCELLED', cancelled_by: cancelledBy, cancelled_reason: reason });
            return t;
        },
        async updateTaskDueAt(taskId, dueAt) {
            const t = findTask(taskId);
            t.due_at = dueAt;
            return t;
        },
        async createExtendRequest({ taskId, assigneeId, proposedDueAt, reason, requestedBy }) {
            const row = { id: rowId++, task_id: taskId, assignee_id: assigneeId, proposed_due_at: proposedDueAt, reason, status: 'PENDING', requested_by: requestedBy };
            state.extendRequests.push(row);
            return row;
        },
        async findExtendRequestById(id) {
            const r = state.extendRequests.find(r => r.id === id);
            if (!r) return null;
            const a = state.assignees.find(a => a.id === r.assignee_id);
            const t = findTask(r.task_id);
            return { ...r, telegram_user_id_snapshot: a.telegram_user_id_snapshot, employee_name_snapshot: a.employee_name_snapshot, display_code: t.display_code, due_at: t.due_at, created_by: t.created_by };
        },
        async decideExtendRequest(id, { status, decidedBy }) {
            const r = state.extendRequests.find(r => r.id === id);
            if (!r || r.status !== 'PENDING') return null;
            r.status = status; r.decided_by = decidedBy;
            return r;
        },
        async findNameByTelegramId() { return 'Sếp Nam'; },
        async enqueueOutbox(row) {
            if (state.outbox.some(o => o.deduplicationKey === row.deduplicationKey)) return null;
            const inserted = { id: rowId++, ...row, status: 'PENDING' };
            state.outbox.push(inserted);
            return inserted;
        },
        async findAssigneesNotAccepted(minutes) {
            return state.assignees
                .filter(a => a.assignment_status === 'ASSIGNED' && !a.not_accepted_reminded_at)
                .map(a => ({ ...a, created_by: findTask(a.task_id).created_by }));
        },
        async markNotAcceptedReminded(id) {
            state.assignees.find(a => a.id === id).not_accepted_reminded_at = FIXED_NOW;
        },
        async findAssigneesDueSoon() {
            return state.assignees
                .filter(a => ['ASSIGNED', 'ACCEPTED'].includes(a.assignment_status) && a.before_due_reminded_due_at === null)
                .map(a => ({ ...a, ...pickTask(a), before_due_reminded_due_at: a.before_due_reminded_due_at }));
        },
        async markBeforeDueReminded(id, dueAt) {
            state.assignees.find(a => a.id === id).before_due_reminded_due_at = dueAt;
        },
        async findAssigneesOverdue() {
            return state.assignees
                .filter(a => ['ASSIGNED', 'ACCEPTED'].includes(a.assignment_status))
                .map(a => ({ ...a, ...pickTask(a), overdue_reminded_at: a.overdue_reminded_at, overdue_manager_notified_at: a.overdue_manager_notified_at }));
        },
        async markOverdueReminded(id) { state.assignees.find(a => a.id === id).overdue_reminded_at = FIXED_NOW; },
        async markOverdueManagerNotified(id) { state.assignees.find(a => a.id === id).overdue_manager_notified_at = FIXED_NOW; },
        async findDailyReminderCandidates() {
            return state.assignees
                .filter(a => ['ASSIGNED', 'ACCEPTED'].includes(a.assignment_status))
                .map(a => ({ ...a, ...pickTask(a), last_daily_reminded_on: a.last_daily_reminded_on }));
        },
        async findFirstCheckinsToday(today, ids) {
            return ids
                .filter(id => state.checkins.has(id))
                .map(id => ({ telegram_id: id, first_checkin: state.checkins.get(id) }));
        },
        async markDailyReminded(id, today) { state.assignees.find(a => a.id === id).last_daily_reminded_on = today; },
        async listAllActiveTasksForEod() {
            return state.assignees
                .filter(a => findTask(a.task_id).status === 'ACTIVE')
                .map(a => ({ ...a, ...pickTask(a) }));
        },
        async listOpenTasksByCreator() { return []; },
        // seed thẳng vào state, bỏ qua validate DUE_IN_PAST của service — dùng cho fixture đã quá hạn
        seed({ dueAt, statuses = ['ASSIGNED', 'ASSIGNED'] }) {
            const created = {
                id: `task-${rowId++}`, display_code: seq++, title: 'Gọi lại 20 khách nóng',
                status: 'ACTIVE', priority: 'NORMAL', reminder_mode: 'ONCE_BEFORE_DUE',
                due_at: dueAt, created_by: '999'
            };
            state.tasks.push(created);
            const people = [
                ['emp-1', 'NV001', 'Nguyễn Văn A', '111'],
                ['emp-2', 'NV002', 'Trần B', '222']
            ];
            people.forEach(([employeeId, employeeCode, employeeName, telegramUserId], i) => {
                state.assignees.push({
                    id: rowId++, task_id: created.id, employee_id: employeeId,
                    employee_code_snapshot: employeeCode, employee_name_snapshot: employeeName,
                    telegram_user_id_snapshot: telegramUserId, assignment_status: statuses[i] || 'ASSIGNED',
                    assigned_at: FIXED_NOW, completed_at: null, accepted_at: null,
                    reviewed_at: null, review_note: null,
                    not_accepted_reminded_at: null, before_due_reminded_due_at: null,
                    overdue_reminded_at: null, overdue_manager_notified_at: null,
                    last_daily_reminded_on: null
                });
            });
            return created;
        }
    };

    function pickTask(a) {
        const t = findTask(a.task_id);
        return { display_code: t.display_code, title: t.title, due_at: t.due_at, created_by: t.created_by };
    }
}

function createSvc() {
    const repo = createMockRepo();
    const service = createTaskService({ taskRepository: repo, now: () => FIXED_NOW });
    return { repo, service };
}

function assigneesFixture() {
    return [
        { employeeId: 'emp-1', employeeCode: 'NV001', employeeName: 'Nguyễn Văn A', telegramUserId: '111' },
        { employeeId: 'emp-2', employeeCode: 'NV002', employeeName: 'Trần B', telegramUserId: '222' }
    ];
}

async function createFixtureTask(service, { dueAt = new Date('2026-10-19T17:30:00+07:00') } = {}) {
    return service.createTask({
        createdBy: '999', title: 'Gọi lại 20 khách nóng', dueAt,
        assignees: assigneesFixture(), idempotencyKey: 'idem-1'
    });
}

test('createTask: tạo 1 bản chung 2 người, gửi tin cho từng người, ghi events', async () => {
    const { repo, service } = createSvc();
    const result = await createFixtureTask(service);

    assert.equal(result.duplicated, false);
    assert.equal(repo.state.assignees.length, 2);
    const taskMsgs = repo.state.outbox.filter(o => o.deduplicationKey.startsWith('taskmsg:'));
    assert.equal(taskMsgs.length, 2);
    assert.match(taskMsgs[0].text, /#T-100/);
    assert.match(taskMsgs[0].text, /Sếp Nam/);
    assert.equal(taskMsgs[0].replyMarkup.inline_keyboard.length, 2);
    assert.deepEqual(taskMsgs[0].replyMarkup.inline_keyboard[0].map(button => button.text), ['✅ Nhận việc', '❌ Không nhận']);
    assert.equal(taskMsgs[0].linkMeta.direction, 'EMPLOYEE_TASK');
    assert.equal(repo.state.events.filter(e => e.event_type === 'ASSIGNED').length, 2);

    const dup = await createFixtureTask(service);
    assert.equal(dup.duplicated, true);
    assert.equal(repo.state.tasks.length, 1);
});

test('createTask: nhân viên có nhóm thì gửi một thông báo vào nhóm', async () => {
    const { repo, service } = createSvc();
    await service.createTask({
        createdBy: '999', title: 'Họp nhóm', dueAt: new Date('2026-10-19T17:30:00+07:00'),
        assignees: [
            { employeeId: 'emp-1', employeeCode: 'NV001', employeeName: 'Nguyễn Văn A', telegramUserId: '111', telegramGroupId: '-1001' },
            { employeeId: 'emp-2', employeeCode: 'NV002', employeeName: 'Trần B', telegramUserId: '222', telegramGroupId: '-1001' }
        ],
        idempotencyKey: 'group-idem-1'
    });

    const taskMessages = repo.state.outbox.filter(o => o.deduplicationKey.startsWith('taskmsg:'));
    assert.equal(taskMessages.length, 1);
    assert.equal(taskMessages[0].chatId, '-1001');
});

test('createTask: deadline trong quá khứ và thiếu người nhận bị từ chối', async () => {
    const { service } = createSvc();
    await assert.rejects(
        service.createTask({ createdBy: '9', title: 'x', dueAt: new Date('2026-10-19T08:00:00+07:00'), assignees: assigneesFixture(), idempotencyKey: 'k1' }),
        e => e.code === 'DUE_IN_PAST'
    );
    await assert.rejects(
        service.createTask({ createdBy: '9', title: 'x', dueAt: new Date('2026-10-20T10:00:00+07:00'), assignees: [], idempotencyKey: 'k2' }),
        e => e.code === 'NO_ASSIGNEE'
    );
});

test('nhận việc: đúng người mới được nhận, nhận 2 lần bị chặn', async () => {
    const { repo, service } = createSvc();
    const { task } = await createFixtureTask(service);

    await assert.rejects(
        service.acceptTask({ displayCode: task.display_code, telegramUserId: '333' }),
        e => e.code === 'NOT_ASSIGNEE'
    );
    await service.acceptTask({ displayCode: task.display_code, telegramUserId: '111' });
    const a = repo.state.assignees[0];
    assert.equal(a.assignment_status, 'ACCEPTED');
    assert.ok(repo.state.outbox.some(o => o.deduplicationKey === 'accepted:100' || o.text.includes('đã nhận việc')));

    await assert.rejects(
        service.acceptTask({ displayCode: task.display_code, telegramUserId: '111' }),
        e => e.code === 'WRONG_STATE'
    );
});

test('quyền thao tác nhiệm vụ: chỉ đúng người nhận mới qua được kiểm tra', async () => {
    const { service } = createSvc();
    const { task } = await createFixtureTask(service);

    await assert.rejects(
        service.assertAssignee({ displayCode: task.display_code, telegramUserId: '333' }),
        e => e.code === 'NOT_ASSIGNEE'
    );
    const result = await service.assertAssignee({ displayCode: task.display_code, telegramUserId: '111' });
    assert.equal(result.assignee.telegram_user_id_snapshot, '111');
});

test('không nhận việc: bắt buộc lý do và gửi lý do cho người giao', async () => {
    const { repo, service } = createSvc();
    const { task } = await createFixtureTask(service);

    await assert.rejects(
        service.declineTask({ displayCode: task.display_code, telegramUserId: '111', reason: ' ' }),
        e => e.code === 'DECLINE_REASON_REQUIRED'
    );
    await service.declineTask({ displayCode: task.display_code, telegramUserId: '111', reason: 'Đang nghỉ phép' });

    assert.equal(repo.state.assignees[0].assignment_status, 'DECLINED');
    assert.ok(repo.state.events.some(e => e.event_type === 'DECLINED' && e.reason === 'Đang nghỉ phép'));
    assert.match(repo.state.outbox.at(-1).text, /Đang nghỉ phép/);
});

test('hoàn thành: phải nhận việc trước; xong thì chuyển chờ duyệt và báo người giao', async () => {
    const { repo, service } = createSvc();
    const { task } = await createFixtureTask(service);

    await assert.rejects(
        service.completeTask({ displayCode: task.display_code, telegramUserId: '111' }),
        e => e.code === 'NOT_ACCEPTED_YET'
    );
    await service.acceptTask({ displayCode: task.display_code, telegramUserId: '111' });
    await service.saveEmployeeComment({ displayCode: task.display_code, telegramUserId: '111', text: 'Đã gọi 15/20 khách' });
    await service.completeTask({ displayCode: task.display_code, telegramUserId: '111' });

    const a = repo.state.assignees[0];
    assert.equal(a.assignment_status, 'DONE_PENDING_REVIEW');
    const review = repo.state.outbox.find(o => o.text.includes('đã bấm hoàn thành'));
    assert.ok(review);
    assert.match(review.text, /Đã gọi 15\/20 khách/);
    assert.ok(review.replyMarkup.inline_keyboard[0][0].callback_data.startsWith('task:review_ok:'));
});

test('duyệt: chỉ người giao được duyệt; duyệt xong nhân viên nhận xác nhận', async () => {
    const { repo, service } = createSvc();
    const { task } = await createFixtureTask(service);
    await service.acceptTask({ displayCode: task.display_code, telegramUserId: '111' });
    await service.completeTask({ displayCode: task.display_code, telegramUserId: '111' });

    await assert.rejects(
        service.reviewApprove({ displayCode: task.display_code, assigneeId: repo.state.assignees[0].id, managerId: '888' }),
        e => e.code === 'FORBIDDEN'
    );
    await service.reviewApprove({ displayCode: task.display_code, assigneeId: repo.state.assignees[0].id, managerId: '999' });
    assert.equal(repo.state.assignees[0].assignment_status, 'DONE');
    assert.ok(repo.state.outbox.some(o => o.chatId === '111' && o.text.includes('đã được duyệt')));
});

test('chưa đạt: bắt buộc feedback, mở lại task và gửi feedback cho nhân viên', async () => {
    const { repo, service } = createSvc();
    const { task } = await createFixtureTask(service);
    await service.acceptTask({ displayCode: task.display_code, telegramUserId: '111' });
    await service.completeTask({ displayCode: task.display_code, telegramUserId: '111' });
    const assigneeId = repo.state.assignees[0].id;

    await assert.rejects(
        service.reviewReject({ displayCode: task.display_code, assigneeId, managerId: '999', feedback: '   ' }),
        e => e.code === 'FEEDBACK_REQUIRED'
    );
    await service.reviewReject({ displayCode: task.display_code, assigneeId, managerId: '999', feedback: 'Chỉ gọi được khách nóng, thiếu danh sách lạnh' });
    const a = repo.state.assignees[0];
    assert.equal(a.assignment_status, 'ACCEPTED');
    assert.equal(a.completed_at, null);
    assert.match(a.review_note, /thiếu danh sách lạnh/);
    assert.ok(repo.state.outbox.some(o => o.chatId === '111' && o.text.includes('thiếu danh sách lạnh')));
    assert.ok(repo.state.events.some(e => e.event_type === 'REOPENED'));
});

test('xin gia hạn: cần lý do; duyệt thì deadline mới + reset cờ nhắc; duyệt 2 lần bị chặn', async () => {
    const { repo, service } = createSvc();
    const { task } = await createFixtureTask(service);
    await service.acceptTask({ displayCode: task.display_code, telegramUserId: '111' });
    const assigneeId = repo.state.assignees[0].id;
    repo.state.assignees[0].overdue_reminded_at = FIXED_NOW;

    await assert.rejects(
        service.requestExtend({ displayCode: task.display_code, telegramUserId: '111', proposedDueAt: new Date('2026-10-20T10:00:00+07:00'), reason: '' }),
        e => e.code === 'REASON_REQUIRED'
    );
    const request = await service.requestExtend({
        displayCode: task.display_code, telegramUserId: '111',
        proposedDueAt: new Date('2026-10-20T10:00:00+07:00'), reason: 'Khách xin gọi lại sáng mai'
    });
    assert.ok(repo.state.outbox.some(o => o.text.includes('xin gia hạn')));

    await service.decideExtend({ requestId: request.id, managerId: '999', approve: true });
    assert.equal(new Date(repo.state.tasks[0].due_at).toISOString(), new Date('2026-10-20T10:00:00+07:00').toISOString());
    assert.equal(repo.state.assignees[0].overdue_reminded_at, null);
    assert.ok(repo.state.events.some(e => e.event_type === 'EXTENDED'));

    await assert.rejects(
        service.decideExtend({ requestId: request.id, managerId: '999', approve: true }),
        e => e.code === 'WRONG_STATE'
    );
});

test('hủy task: cần lý do, người đã DONE không nhận tin hủy', async () => {
    const { repo, service } = createSvc();
    const { task } = await createFixtureTask(service);
    await service.acceptTask({ displayCode: task.display_code, telegramUserId: '111' });
    await service.completeTask({ displayCode: task.display_code, telegramUserId: '111' });
    await service.reviewApprove({ displayCode: task.display_code, assigneeId: repo.state.assignees[0].id, managerId: '999' });

    await assert.rejects(
        service.cancelTask({ displayCode: task.display_code, managerId: '999', reason: ' ' }),
        e => e.code === 'REASON_REQUIRED'
    );
    await service.cancelTask({ displayCode: task.display_code, managerId: '999', reason: 'Đổi kế hoạch kinh doanh' });
    assert.equal(repo.state.tasks[0].status, 'CANCELLED');
    const cancelMsgs = repo.state.outbox.filter(o => o.text.includes('đã bị hủy'));
    assert.equal(cancelMsgs.length, 1); // chỉ NV002 chưa xong
    assert.equal(cancelMsgs[0].chatId, '222');
});

test('nhắc chưa nhận việc: gửi 1 lần duy nhất', async () => {
    const { repo, service } = createSvc();
    await createFixtureTask(service);

    const first = await service.processNotAcceptedReminders();
    assert.equal(first, 2);
    const second = await service.processNotAcceptedReminders();
    assert.equal(second, 0);
    assert.equal(repo.state.outbox.filter(o => o.deduplicationKey.startsWith('na:')).length, 2);
});

test('nhắc hàng ngày: chỉ gửi khi đã check-in đủ 15 phút', async () => {
    const { repo, service } = createSvc();
    await createFixtureTask(service);
    const today = vietnamToday(FIXED_NOW);
    repo.state.checkins.set('111', new Date(FIXED_NOW.getTime() - 20 * 60 * 1000)); // NV001 check-in 20 phút trước
    repo.state.checkins.set('222', new Date(FIXED_NOW.getTime() - 5 * 60 * 1000));  // NV002 mới 5 phút

    const sent = await service.processDailyReminders();
    assert.equal(sent, 1);
    const daily = repo.state.outbox.find(o => o.deduplicationKey.startsWith('dr:'));
    assert.match(daily.text, /còn 1 việc chưa xong/);
    assert.match(daily.text, /#T-100/);
});

test('quá hạn: nhắc nhân viên 1 lần, người giao chỉ được báo sau 2 giờ', async () => {
    const { repo, service } = createSvc();
    repo.seed({ dueAt: new Date('2026-10-19T07:00:00+07:00') }); // quá hạn 3 tiếng

    await service.processOverdueReminders();
    assert.equal(repo.state.outbox.filter(o => o.deduplicationKey.startsWith('od:')).length, 2);
    assert.equal(repo.state.outbox.filter(o => o.deduplicationKey.startsWith('odm:')).length, 2);

    // chạy lần 2: không gửi lại
    await service.processOverdueReminders();
    assert.equal(repo.state.outbox.filter(o => o.deduplicationKey.startsWith('od:')).length, 2);
});

test('quá hạn dưới 2 tiếng: chỉ nhắc nhân viên, chưa báo người giao', async () => {
    const { repo, service } = createSvc();
    repo.seed({ dueAt: new Date('2026-10-19T09:30:00+07:00') }); // quá hạn 30 phút

    await service.processOverdueReminders();
    assert.equal(repo.state.outbox.filter(o => o.deduplicationKey.startsWith('od:')).length, 2);
    assert.equal(repo.state.outbox.filter(o => o.deduplicationKey.startsWith('odm:')).length, 0);
});

test('tổng hợp cuối ngày: nhóm theo người giao, phân biệt 4 trạng thái', () => {
    const rows = [
        { id: 1, display_code: 101, title: 'Gọi khách', due_at: new Date('2026-10-19T08:00:00+07:00'), created_by: '999', employee_name_snapshot: 'NV A', assignment_status: 'DONE', reviewed_at: new Date('2026-10-19T16:00:00+07:00') },
        { id: 1, display_code: 101, title: 'Gọi khách', due_at: new Date('2026-10-19T08:00:00+07:00'), created_by: '999', employee_name_snapshot: 'NV B', assignment_status: 'DONE_PENDING_REVIEW', reviewed_at: null },
        { id: 1, display_code: 101, title: 'Gọi khách', due_at: new Date('2026-10-19T08:00:00+07:00'), created_by: '999', employee_name_snapshot: 'NV C', assignment_status: 'ACCEPTED', reviewed_at: null },
        { id: 1, display_code: 101, title: 'Gọi khách', due_at: new Date('2026-10-19T08:00:00+07:00'), created_by: '999', employee_name_snapshot: 'NV D', assignment_status: 'ASSIGNED', reviewed_at: null },
        { id: 2, display_code: 102, title: 'Báo cáo tuần', due_at: new Date('2026-10-18T17:30:00+07:00'), created_by: '999', employee_name_snapshot: 'NV E', assignment_status: 'DONE', reviewed_at: new Date('2026-10-17T16:00:00+07:00') }
    ];
    const text = buildEodText({ rows, now: FIXED_NOW });
    assert.match(text, /TỔNG HỢP CUỐI NGÀY/);
    assert.match(text, /NV A: ✅ Xong/);
    assert.match(text, /NV B: 🕒 Chờ duyệt/);
    assert.match(text, /NV C: ❌ Chưa xong — quá hạn/);
    assert.match(text, /NV D: ⚠️ Chưa nhận việc — quá hạn/);
    assert.doesNotMatch(text, /NV E/); // đã duyệt từ hôm trước thì không nhắc lại
});

// ----- P5b: post-filter theo rule config của từng người giao -----

function createFakeRuleConfig(configByManager = {}) {
    return {
        async loadConfigsForTick(ids) {
            const map = new Map();
            for (const id of ids) {
                map.set(String(id), { ...RULE_DEFAULTS, ...(configByManager[String(id)] || {}) });
            }
            return map;
        },
        shouldSkip: (c) => !c || c.paused,
        isOverdueManagerDue: (c, dueAt, nowMs) => nowMs - new Date(dueAt).getTime() >= c.overdue_manager_hours * 3600 * 1000,
        isDueSoonWithin: (c, dueAt, nowMs) => new Date(dueAt).getTime() - nowMs <= c.due_soon_minutes * 60 * 1000,
        isFormDueSoonWithin: () => true,
        isFormOverdueManagerDue: () => true,
        isNotAcceptedLateEnough: (c, assignedAt, nowMs) => nowMs - new Date(assignedAt).getTime() >= c.not_accepted_minutes * 60 * 1000
    };
}

function createSvcWithRules(configByManager) {
    const repo = createMockRepo();
    const service = createTaskService({
        taskRepository: repo, ruleConfigService: createFakeRuleConfig(configByManager),
        now: () => FIXED_NOW
    });
    return { repo, service };
}

test('ruleConfig: người giao tạm dừng thì không nhắc chưa nhận, sắp hạn, quá hạn', async () => {
    const { repo, service } = createSvcWithRules({ 999: { paused: true } });
    await createFixtureTask(service); // due 17:30 — ngoài cửa sổ due soon nhưng vào luồng overdue khi seed

    assert.equal(await service.processNotAcceptedReminders(), 0);
    assert.equal(await service.processDueSoonReminders(), 0);
    const overdue = await service.processOverdueReminders();
    assert.equal(overdue.employeeCount, 0);
    assert.equal(overdue.managerCount, 0);
    assert.equal(repo.state.outbox.filter(o => !o.deduplicationKey.startsWith('taskmsg:')).length, 0);

    // taskmsg chào việc khi createTask vẫn gửi — tạm dừng chỉ tắt automation nhắc
    assert.equal(repo.state.outbox.filter(o => o.deduplicationKey.startsWith('taskmsg:')).length, 2);
});

test('ruleConfig: due soon dùng ngưỡng riêng — 40 phút tới, mặc định 30 không nhắc, config 60 nhắc', async () => {
    const dueSoon = new Date('2026-10-19T10:40:00+07:00'); // 40 phút sau FIXED_NOW

    const def = createSvcWithRules({});
    await def.service.createTask({ createdBy: '999', title: 'Gọi khách', dueAt: dueSoon, assignees: assigneesFixture(), idempotencyKey: 'k1' });
    assert.equal(await def.service.processDueSoonReminders(), 0);
    assert.equal(def.repo.state.outbox.filter(o => o.deduplicationKey.startsWith('bd:')).length, 0);

    const custom = createSvcWithRules({ 999: { due_soon_minutes: 60 } });
    await custom.service.createTask({ createdBy: '999', title: 'Gọi khách', dueAt: dueSoon, assignees: assigneesFixture(), idempotencyKey: 'k1' });
    assert.equal(await custom.service.processDueSoonReminders(), 2);
    assert.equal(custom.repo.state.outbox.filter(o => o.deduplicationKey.startsWith('bd:')).length, 2);
});

test('ruleConfig: chưa nhận việc — mới giao 10 phút, mặc định 15 không nhắc, config 5 nhắc', async () => {
    const { repo, service } = createSvcWithRules({ 999: { not_accepted_minutes: 5 } });
    await createFixtureTask(service); // assigned_at = FIXED_NOW... mock trả assigned_at FIXED_NOW => 0 phút

    // Mock trả assigned_at = FIXED_NOW nên 0 phút trôi qua — chưa đủ cả 2 ngưỡng.
    // Giả lập trôi 10 phút: đẩy assigned_at lùi 10 phút.
    for (const a of repo.state.assignees) a.assigned_at = new Date(FIXED_NOW.getTime() - 10 * 60 * 1000);
    assert.equal(await service.processNotAcceptedReminders(), 2);
    assert.equal(repo.state.outbox.filter(o => o.deduplicationKey.startsWith('na:')).length, 2);

    const def = createSvcWithRules({});
    const defService = def.service;
    await defService.createTask({ createdBy: '999', title: 'Gọi khách', dueAt: new Date('2026-10-19T17:30:00+07:00'), assignees: assigneesFixture(), idempotencyKey: 'k1' });
    for (const a of def.repo.state.assignees) a.assigned_at = new Date(FIXED_NOW.getTime() - 10 * 60 * 1000);
    assert.equal(await defService.processNotAcceptedReminders(), 0);
});

test('ruleConfig: quá hạn báo người giao sau số giờ cấu hình (5 giờ thay vì 2)', async () => {
    const { repo, service } = createSvcWithRules({ 999: { overdue_manager_hours: 5 } });
    repo.seed({ dueAt: new Date('2026-10-19T07:00:00+07:00') }); // quá hạn 3 tiếng

    const result = await service.processOverdueReminders();
    assert.equal(result.employeeCount, 2); // nhân viên vẫn được nhắc
    assert.equal(result.managerCount, 0);  // mới trễ 3 tiếng < 5 tiếng cấu hình
    assert.equal(repo.state.outbox.filter(o => o.deduplicationKey.startsWith('odm:')).length, 0);
});

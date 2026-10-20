import { FETCH_WINDOW } from './rule-config-service.js';

const VN_TZ = 'Asia/Ho_Chi_Minh';

function fail(code, message) {
    throw Object.assign(new Error(message), { code });
}

export function vietnamToday(now = new Date()) {
    return now.toLocaleDateString('en-CA', { timeZone: VN_TZ });
}

export function formatVnTime(date) {
    if (!date) return '';
    return new Date(date).toLocaleString('vi-VN', {
        timeZone: VN_TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric'
    });
}

const VN_OFFSET_MS = 7 * 3600 * 1000;

// Việt Nam không có DST: giờ tường mục -> epoch bằng offset cố định +07:00
export function vnWallToUtc(year, month, day, hour, minute) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute) - VN_OFFSET_MS);
}

// Chấp nhận "HH:MM", "HH:MM DD/MM", "HH:MM DD/MM/YYYY". HH:MM trễ hơn hiện tại
// được hiểu là ngày mai (xem trước trong preview nên người giao vẫn kiểm soát được).
export function parseDeadlineVi(input, now = new Date()) {
    const text = String(input).trim();
    const legacy = /^(\d{1,2}):(\d{2})(?:\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?)?$/.exec(text);
    const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd').toLowerCase();
    const natural = /^(?:luc|vao|truoc|han|deadline\s+)?(\d{1,2})(?::(\d{2})|h\s*(\d{1,2})?)\s*(sang|trua|chieu|toi)?\s*(hom nay|nay|mai|ngay mai)?$/.exec(normalized);
    const m = legacy || natural;
    if (!m) return null;
    const hourPart = Number(m[1]);
    const minute = legacy ? Number(m[2]) : Number(m[2] || m[3] || 0);
    let hour = hourPart;
    if (!legacy && m[4] && ['chieu', 'toi'].includes(m[4]) && hour < 12) hour += 12;
    if (!legacy && m[4] === 'trua' && hour < 11) hour += 12;
    if (hour > 23 || minute > 59) return null;
    const [ty, tm, td] = now.toLocaleDateString('en-CA', { timeZone: VN_TZ }).split('-').map(Number);
    if (legacy && m[3] === undefined || !legacy) {
        let due = vnWallToUtc(ty, tm, td, hour, minute);
        if (!legacy && /\bmai\b|ngay mai/.test(normalized)) {
            return vnWallToUtc(ty, tm, td + 1, hour, minute);
        }
        if (due <= now) due = vnWallToUtc(ty, tm, td + 1, hour, minute);
        return due;
    }
    const day = Number(m[3]);
    const month = Number(m[4]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    if (m[5]) return vnWallToUtc(Number(m[5]), month, day, hour, minute);
    let due = vnWallToUtc(ty, month, day, hour, minute);
    if (due <= now) due = vnWallToUtc(ty + 1, month, day, hour, minute);
    return due;
}

// Ô ngày trong Excel: ExcelJS trả Date với các thành phần UTC chính là giờ
// tường mục người dùng gõ — đọc bằng getUTC* rồi đổi sang epoch VN.
export function parseDeadlineCellValue(value, now = new Date()) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return vnWallToUtc(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate(), value.getUTCHours(), value.getUTCMinutes());
    }
    return parseDeadlineVi(value, now);
}

export const STATUS_LABEL = {
    ASSIGNED: '⚠️ Chưa nhận việc',
    ACCEPTED: '❌ Chưa xong',
    DECLINED: '🚫 Từ chối',
    DONE_PENDING_REVIEW: '🕒 Chờ duyệt',
    DONE: '✅ Xong'
};

export function buildTaskMessage({ task, assignee, reminderModeLabel }) {
    const lines = [
        `📋 NHIỆM VỤ #T-${task.display_code}`,
        `👤 Người giao: ${task.manager_name || 'Quản lý'}`,
        `📝 ${task.title}`
    ];
    if (task.description) lines.push(`Chi tiết: ${task.description}`);
    if (task.priority && task.priority !== 'NORMAL') lines.push(`🔥 Ưu tiên: ${task.priority}`);
    lines.push(`⏰ Deadline: ${formatVnTime(task.due_at)}`);
    lines.push(`🔔 Nhắc: ${reminderModeLabel}`);
    lines.push('', 'Chọn ✅ Nhận việc hoặc ❌ Không nhận. Khi đang làm, bạn có thể 💬 Phản hồi hoặc bấm ✔ Hoàn thành.');
    return lines.join('\n');
}

export function buildEmployeeReminderText({ openTasks }) {
    if (!openTasks.length) return null;
    const lines = openTasks.map(t =>
        `• #T-${t.display_code} (hạn ${formatVnTime(t.due_at)}) — ${t.title}`);
    return `⏰ Bạn còn ${openTasks.length} việc chưa xong:\n${lines.join('\n')}`;
}

export function buildReviewMessage({ task, assignee, note }) {
    const lines = [
        `✅ #T-${task.display_code} — ${assignee.employee_name_snapshot || assignee.telegram_user_id_snapshot} đã bấm hoàn thành`,
        `Deadline: ${formatVnTime(task.due_at)} | Hoàn thành lúc: ${formatVnTime(assignee.completed_at)}`
    ];
    if (note) lines.push(`💬 Phản hồi: ${note}`);
    if (new Date(assignee.completed_at) > new Date(task.due_at)) lines.push('⚠️ Hoàn thành TRỄ hạn');
    lines.push('Duyệt hoặc trả lại (trả lại bắt buộc kèm feedback):');
    return lines.join('\n');
}

export function buildEodText({ rows, now = new Date() }) {
    if (!rows.length) return null;
    const today = vietnamToday(now);
    const lines = ['📋 TỔNG HỢP CUỐI NGÀY'];
    let lastTaskId = null;
    for (const row of rows) {
        if (row.id !== lastTaskId) {
            lines.push(`\n#T-${row.display_code} — ${row.title} (hạn ${formatVnTime(row.due_at)})`);
            lastTaskId = row.id;
        }
        let label = STATUS_LABEL[row.assignment_status] || row.assignment_status;
        if (row.assignment_status === 'DONE' && row.reviewed_at &&
            vietnamToday(new Date(row.reviewed_at)) !== today) {
            continue; // đã duyệt từ hôm trước, không nhắc lại
        }
        if ((row.assignment_status === 'ACCEPTED' || row.assignment_status === 'ASSIGNED') &&
            new Date(row.due_at) < now) {
            label += ' — quá hạn';
        }
        lines.push(`- ${row.employee_name_snapshot || row.employee_code_snapshot || row.telegram_user_id_snapshot}: ${label}`);
    }
    return lines.join('\n').trim();
}

export function createTaskService({ taskRepository, ruleConfigService = null, taskExtendUrl = null, now = () => new Date() }) {
    const DAILY_REMINDER_MINUTES_AFTER_CHECKIN = 15;
    const BEFORE_DUE_MINUTES = 30;
    const NOT_ACCEPTED_MINUTES = 15;
    const OVERDUE_MANAGER_HOURS = 2;
    const FETCH_WINDOW_MINUTES_MIN = FETCH_WINDOW.minutesMin;
    const FETCH_WINDOW_MINUTES_MAX = FETCH_WINDOW.minutesMax;

    function getTaskExtendUrl(displayCode) {
        return typeof taskExtendUrl === 'function' ? taskExtendUrl(String(displayCode)) : null;
    }

    async function managerNameFor(telegramUserId) {
        if (!taskRepository.findNameByTelegramId) return null;
        return taskRepository.findNameByTelegramId(telegramUserId);
    }

    async function enqueueTaskMessageToEmployee(task, assignee) {
        const managerName = await managerNameFor(task.created_by);
        const chatId = assignee.telegram_group_id || assignee.telegram_user_id_snapshot;
        const text = buildTaskMessage({
            task: { ...task, manager_name: managerName },
            assignee,
            reminderModeLabel: task.reminder_mode === 'DAILY_AFTER_CHECKIN'
                ? 'hàng ngày sau khi bạn check-in 15 phút'
                : 'trước hạn 30 phút'
        });
        const extendUrl = getTaskExtendUrl(task.display_code);
        return taskRepository.enqueueOutbox({
            deduplicationKey: `taskmsg:${assignee.id}`,
            chatId,
            text,
            replyMarkup: { inline_keyboard: [[
                { text: '✅ Nhận việc', callback_data: `task:accept:${task.display_code}` },
                { text: '❌ Không nhận', callback_data: `task:decline:${task.display_code}` }
            ], [extendUrl
                ? { text: '⏰ Xin gia hạn', url: extendUrl }
                : { text: '⏰ Xin gia hạn', callback_data: `task:extend:${task.display_code}` }
            ]] },
            linkMeta: {
                taskId: task.id, assigneeId: assignee.id,
                direction: 'EMPLOYEE_TASK', chatId
            }
        });
    }

    async function createTask({ createdBy, title, description = null, priority = 'NORMAL', reminderMode = 'ONCE_BEFORE_DUE', dueAt, assignees, idempotencyKey }) {
        if (!title || !String(title).trim()) fail('TITLE_REQUIRED', 'Thiếu nội dung nhiệm vụ.');
        if (!(dueAt instanceof Date) || Number.isNaN(dueAt.getTime())) fail('DUE_INVALID', 'Deadline không hợp lệ.');
        if (dueAt.getTime() <= now().getTime()) fail('DUE_IN_PAST', 'Deadline đã qua, hãy chọn thời gian tương lai.');
        if (!assignees.length) fail('NO_ASSIGNEE', 'Không có người nhận hợp lệ nào.');

        const { duplicated, task, assignees: created } = await taskRepository.createTaskWithAssignees({
            task: { title: String(title).trim(), description, priority, reminderMode, dueAt, createdBy: String(createdBy) },
            assignees,
            idempotencyKey
        });
        if (duplicated) return { duplicated: true, task };

        const notificationTargets = new Set();
        for (const assignee of created) {
            const source = assignees.find(item => String(item.employeeId) === String(assignee.employee_id));
            const notificationTarget = source?.telegramGroupId
                ? `group:${source.telegramGroupId}`
                : `employee:${assignee.id}`;
            if (notificationTargets.has(notificationTarget)) continue;
            notificationTargets.add(notificationTarget);
            await enqueueTaskMessageToEmployee(task, {
                ...assignee,
                telegram_group_id: source?.telegramGroupId || null
            });
        }
        return { duplicated: false, task, assignees: created };
    }

    async function loadOpenTask(displayCode) {
        const task = await taskRepository.findTaskByDisplayCode(displayCode);
        if (!task) fail('TASK_NOT_FOUND', `Không tìm thấy nhiệm vụ #T-${displayCode}.`);
        if (task.status !== 'ACTIVE') fail('TASK_CANCELLED', `Nhiệm vụ #T-${displayCode} đã bị hủy.`);
        return task;
    }

    async function assertAssignee({ displayCode, telegramUserId }) {
        const task = await loadOpenTask(displayCode);
        const assignee = await taskRepository.findAssigneeByTaskAndTelegram(task.id, telegramUserId);
        if (!assignee) fail('NOT_ASSIGNEE', 'Bạn không phải người nhận nhiệm vụ này.');
        return { task, assignee };
    }

    async function acceptTask({ displayCode, telegramUserId }) {
        const { task, assignee } = await assertAssignee({ displayCode, telegramUserId });
        if (assignee.assignment_status !== 'ASSIGNED') {
            fail('WRONG_STATE', 'Nhiệm vụ này không ở trạng thái chờ nhận.');
        }
        const updated = await taskRepository.updateAssigneeStatus(assignee.id, {
            status: 'ACCEPTED', acceptedAt: now()
        });
        await taskRepository.appendTaskEvent({
            taskId: task.id, assigneeId: assignee.id, eventType: 'ACCEPTED',
            actorType: 'EMPLOYEE', actorId: String(telegramUserId)
        });
        await taskRepository.enqueueOutbox({
            deduplicationKey: `accepted:${assignee.id}`,
            chatId: task.created_by,
            text: `📥 #T-${task.display_code} — ${assignee.employee_name_snapshot || assignee.telegram_user_id_snapshot} đã nhận việc.`
        });
        return updated;
    }

    async function declineTask({ displayCode, telegramUserId, reason }) {
        if (!reason || !String(reason).trim()) fail('DECLINE_REASON_REQUIRED', 'Từ chối nhận việc bắt buộc phải có lý do.');
        const task = await loadOpenTask(displayCode);
        const assignee = await taskRepository.findAssigneeByTaskAndTelegram(task.id, telegramUserId);
        if (!assignee) fail('NOT_ASSIGNEE', 'Bạn không phải người nhận nhiệm vụ này.');
        if (assignee.assignment_status !== 'ASSIGNED') {
            fail('WRONG_STATE', 'Nhiệm vụ này không còn ở trạng thái chờ nhận.');
        }
        const updated = await taskRepository.updateAssigneeStatus(assignee.id, {
            status: 'DECLINED'
        });
        await taskRepository.appendTaskEvent({
            taskId: task.id, assigneeId: assignee.id, eventType: 'DECLINED',
            actorType: 'EMPLOYEE', actorId: String(telegramUserId), reason: String(reason).trim()
        });
        await taskRepository.enqueueOutbox({
            deduplicationKey: `declined:${assignee.id}:${Date.now()}`,
            chatId: task.created_by,
            text: `🚫 #T-${task.display_code} — ${assignee.employee_name_snapshot || assignee.telegram_user_id_snapshot} không nhận việc.\nLý do: ${String(reason).trim()}`
        });
        return updated;
    }

    async function completeTask({ displayCode, telegramUserId }) {
        const task = await loadOpenTask(displayCode);
        const assignee = await taskRepository.findAssigneeByTaskAndTelegram(task.id, telegramUserId);
        if (!assignee) fail('NOT_ASSIGNEE', 'Bạn không phải người nhận nhiệm vụ này.');
        if (assignee.assignment_status === 'ASSIGNED') {
            fail('NOT_ACCEPTED_YET', 'Bạn cần bấm ✅ Nhận việc trước khi hoàn thành.');
        }
        if (assignee.assignment_status !== 'ACCEPTED') {
            fail('WRONG_STATE', 'Nhiệm vụ này không ở trạng thái đang làm.');
        }
        const updated = await taskRepository.updateAssigneeStatus(assignee.id, {
            status: 'DONE_PENDING_REVIEW', completedAt: now()
        });
        await taskRepository.appendTaskEvent({
            taskId: task.id, assigneeId: assignee.id, eventType: 'COMPLETED',
            actorType: 'EMPLOYEE', actorId: String(telegramUserId)
        });
        await enqueueReviewRequest(task, updated);
        return updated;
    }

    async function enqueueReviewRequest(task, assignee) {
        const note = await taskRepository.getLastComment(task.id, assignee.id);
        return taskRepository.enqueueOutbox({
            deduplicationKey: `review:${assignee.id}:${assignee.completed_at ? new Date(assignee.completed_at).getTime() : 'x'}`,
            chatId: task.created_by,
            text: buildReviewMessage({ task, assignee, note }),
            replyMarkup: { inline_keyboard: [[
                { text: '✅ Duyệt', callback_data: `task:review_ok:${task.display_code}:${assignee.id}` },
                { text: '❌ Chưa đạt', callback_data: `task:review_no:${task.display_code}:${assignee.id}` }
            ]] },
            linkMeta: {
                taskId: task.id, assigneeId: assignee.id,
                direction: 'MANAGER_REVIEW', chatId: task.created_by
            }
        });
    }

    async function reviewApprove({ displayCode, assigneeId, managerId }) {
        const task = await loadOpenTask(displayCode);
        if (String(task.created_by) !== String(managerId)) fail('FORBIDDEN', 'Chỉ người giao việc mới duyệt được nhiệm vụ này.');
        const assignee = await taskRepository.findAssigneeById(assigneeId);
        if (!assignee || String(assignee.task_id) !== String(task.id)) fail('ASSIGNEE_NOT_FOUND', 'Không tìm thấy người nhận tương ứng.');
        if (assignee.assignment_status !== 'DONE_PENDING_REVIEW') fail('WRONG_STATE', 'Nhiệm vụ không ở trạng thái chờ duyệt.');

        const updated = await taskRepository.updateAssigneeStatus(assigneeId, {
            status: 'DONE', reviewedAt: now(), reviewedBy: String(managerId)
        });
        await taskRepository.appendTaskEvent({
            taskId: task.id, assigneeId, eventType: 'REVIEW_APPROVED',
            actorType: 'MANAGER', actorId: String(managerId)
        });
        await taskRepository.enqueueOutbox({
            deduplicationKey: `approved:${assigneeId}:${Date.now()}`,
            chatId: assignee.telegram_user_id_snapshot,
            text: `✅ #T-${task.display_code} đã được duyệt. Cảm ơn bạn!`
        });
        return updated;
    }

    async function reviewReject({ displayCode, assigneeId, managerId, feedback }) {
        if (!feedback || !String(feedback).trim()) {
            fail('FEEDBACK_REQUIRED', 'Chưa đạt bắt buộc phải có feedback cho nhân viên.');
        }
        const task = await loadOpenTask(displayCode);
        if (String(task.created_by) !== String(managerId)) fail('FORBIDDEN', 'Chỉ người giao việc mới duyệt được nhiệm vụ này.');
        const assignee = await taskRepository.findAssigneeById(assigneeId);
        if (!assignee || String(assignee.task_id) !== String(task.id)) fail('ASSIGNEE_NOT_FOUND', 'Không tìm thấy người nhận tương ứng.');
        if (assignee.assignment_status !== 'DONE_PENDING_REVIEW') fail('WRONG_STATE', 'Nhiệm vụ không ở trạng thái chờ duyệt.');

        const updated = await taskRepository.reopenAssignee(assigneeId, {
            reviewedBy: String(managerId), reviewNote: String(feedback).trim()
        });
        await taskRepository.appendTaskEvent({
            taskId: task.id, assigneeId, eventType: 'REVIEW_REJECTED',
            actorType: 'MANAGER', actorId: String(managerId), reason: String(feedback).trim()
        });
        await taskRepository.appendTaskEvent({
            taskId: task.id, assigneeId, eventType: 'REOPENED',
            actorType: 'MANAGER', actorId: String(managerId)
        });
        await taskRepository.enqueueOutbox({
            deduplicationKey: `rejected:${assigneeId}:${Date.now()}`,
            chatId: assignee.telegram_user_id_snapshot,
            text: `🔁 #T-${task.display_code} chưa đạt, được mở lại để làm tiếp.\n💬 Feedback: ${String(feedback).trim()}\n⏰ Deadline hiện tại: ${formatVnTime(task.due_at)}`
        });
        return updated;
    }

    async function requestExtend({ displayCode, telegramUserId, proposedDueAt, reason }) {
        if (!reason || !String(reason).trim()) fail('REASON_REQUIRED', 'Xin gia hạn phải có lý do.');
        if (!(proposedDueAt instanceof Date) || Number.isNaN(proposedDueAt.getTime())) {
            fail('DUE_INVALID', 'Thời gian gia hạn không hợp lệ.');
        }
        if (proposedDueAt.getTime() <= now().getTime()) fail('DUE_IN_PAST', 'Thời gian gia hạn đã qua.');
        const task = await loadOpenTask(displayCode);
        const assignee = await taskRepository.findAssigneeByTaskAndTelegram(task.id, telegramUserId);
        if (!assignee) fail('NOT_ASSIGNEE', 'Bạn không phải người nhận nhiệm vụ này.');
        if (!['ASSIGNED', 'ACCEPTED'].includes(assignee.assignment_status)) {
            fail('WRONG_STATE', 'Nhiệm vụ này không thể xin gia hạn.');
        }
        const request = await taskRepository.createExtendRequest({
            taskId: task.id, assigneeId: assignee.id,
            proposedDueAt, reason: String(reason).trim(), requestedBy: String(telegramUserId)
        });
        await taskRepository.appendTaskEvent({
            taskId: task.id, assigneeId: assignee.id, eventType: 'EXTEND_REQUESTED',
            actorType: 'EMPLOYEE', actorId: String(telegramUserId),
            newValues: { proposed_due_at: proposedDueAt.toISOString() },
            reason: String(reason).trim()
        });
        await taskRepository.enqueueOutbox({
            deduplicationKey: `extreq:${request.id}`,
            chatId: task.created_by,
            text: `⏰ #T-${task.display_code} — ${assignee.employee_name_snapshot || assignee.telegram_user_id_snapshot} xin gia hạn:\nTừ ${formatVnTime(task.due_at)} → ${formatVnTime(proposedDueAt)}\nLý do: ${String(reason).trim()}`,
            replyMarkup: { inline_keyboard: [[
                { text: '✅ Duyệt gia hạn', callback_data: `task:ext_ok:${request.id}` },
                { text: '❌ Từ chối', callback_data: `task:ext_no:${request.id}` }
            ]] }
        });
        return request;
    }

    async function decideExtend({ requestId, managerId, approve }) {
        const request = await taskRepository.findExtendRequestById(requestId);
        if (!request) fail('REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu gia hạn.');
        if (String(request.created_by) !== String(managerId)) fail('FORBIDDEN', 'Chỉ người giao việc mới duyệt gia hạn được.');
        const decided = await taskRepository.decideExtendRequest(requestId, {
            status: approve ? 'APPROVED' : 'REJECTED', decidedBy: String(managerId)
        });
        if (!decided) fail('WRONG_STATE', 'Yêu cầu gia hạn này đã được xử lý.');

        if (approve) {
            const oldDue = request.due_at;
            const task = await taskRepository.updateTaskDueAt(request.task_id, request.proposed_due_at);
            await taskRepository.resetReminderFlags(request.assignee_id);
            await taskRepository.appendTaskEvent({
                taskId: request.task_id, assigneeId: request.assignee_id, eventType: 'EXTENDED',
                actorType: 'MANAGER', actorId: String(managerId),
                oldValues: { due_at: oldDue }, newValues: { due_at: request.proposed_due_at },
                reason: request.reason
            });
            await taskRepository.enqueueOutbox({
                deduplicationKey: `extok:${requestId}:${Date.now()}`,
                chatId: request.telegram_user_id_snapshot,
                text: `✅ Yêu cầu gia hạn #T-${request.display_code} đã được duyệt. Deadline mới: ${formatVnTime(request.proposed_due_at)}`
            });
            return { request: decided, task };
        }

        await taskRepository.appendTaskEvent({
            taskId: request.task_id, assigneeId: request.assignee_id, eventType: 'EXTEND_REJECTED',
            actorType: 'MANAGER', actorId: String(managerId), reason: request.reason
        });
        await taskRepository.enqueueOutbox({
            deduplicationKey: `extno:${requestId}:${Date.now()}`,
            chatId: request.telegram_user_id_snapshot,
            text: `❌ Yêu cầu gia hạn #T-${request.display_code} bị từ chối. Deadline giữ nguyên: ${formatVnTime(request.due_at)}`
        });
        return { request: decided };
    }

    async function cancelTask({ displayCode, managerId, reason }) {
        if (!reason || !String(reason).trim()) fail('REASON_REQUIRED', 'Hủy nhiệm vụ phải có lý do.');
        const task = await loadOpenTask(displayCode);
        if (String(task.created_by) !== String(managerId)) fail('FORBIDDEN', 'Chỉ người giao việc mới hủy được nhiệm vụ này.');
        const cancelled = await taskRepository.cancelTask(task.id, {
            cancelledBy: String(managerId), reason: String(reason).trim()
        });
        if (!cancelled) fail('WRONG_STATE', 'Nhiệm vụ đã bị hủy trước đó.');
        await taskRepository.appendTaskEvent({
            taskId: task.id, eventType: 'CANCELLED', actorType: 'MANAGER',
            actorId: String(managerId), reason: String(reason).trim()
        });
        const { assignees } = await taskRepository.getTaskWithAssignees(task.id);
        for (const assignee of assignees) {
            if (['DONE', 'DECLINED'].includes(assignee.assignment_status)) continue;
            await taskRepository.enqueueOutbox({
                deduplicationKey: `cancelled:${assignee.id}:${Date.now()}`,
                chatId: assignee.telegram_user_id_snapshot,
                text: `🚫 #T-${task.display_code} đã bị hủy.\nLý do: ${String(reason).trim()}`
            });
        }
        return cancelled;
    }

    async function saveEmployeeComment({ displayCode, telegramUserId, text }) {
        if (!text || !String(text).trim()) fail('EMPTY_COMMENT', 'Nội dung phản hồi trống.');
        const task = await loadOpenTask(displayCode);
        const assignee = await taskRepository.findAssigneeByTaskAndTelegram(task.id, telegramUserId);
        if (!assignee) fail('NOT_ASSIGNEE', 'Bạn không phải người nhận nhiệm vụ này.');
        await taskRepository.appendTaskEvent({
            taskId: task.id, assigneeId: assignee.id, eventType: 'COMMENT',
            actorType: 'EMPLOYEE', actorId: String(telegramUserId), reason: String(text).trim()
        });
        await taskRepository.enqueueOutbox({
            deduplicationKey: `cmt:${task.id}:${assignee.id}:${Date.now()}`,
            chatId: task.created_by,
            text: `💬 #T-${task.display_code} — ${assignee.employee_name_snapshot || assignee.telegram_user_id_snapshot} phản hồi:\n${String(text).trim()}`,
            replyMarkup: { inline_keyboard: [[
                { text: '✅ Duyệt', callback_data: `task:review_ok:${task.display_code}:${assignee.id}` },
                { text: '❌ Chưa đạt', callback_data: `task:review_no:${task.display_code}:${assignee.id}` }
            ]] },
            linkMeta: {
                taskId: task.id, assigneeId: assignee.id,
                direction: 'MANAGER_COMMENT', chatId: task.created_by
            }
        });
        return { task, assignee };
    }

    async function saveManagerComment({ taskId, assigneeId, managerId, text }) {
        if (!text || !String(text).trim()) fail('EMPTY_COMMENT', 'Nội dung phản hồi trống.');
        const task = await loadTaskByIdInternal(taskId);
        if (!task) fail('TASK_NOT_FOUND', 'Không tìm thấy nhiệm vụ.');
        if (String(task.created_by) !== String(managerId)) fail('FORBIDDEN', 'Chỉ người giao việc mới trả lời được.');
        const assignee = await taskRepository.findAssigneeById(assigneeId);
        if (!assignee || String(assignee.task_id) !== String(task.id)) fail('ASSIGNEE_NOT_FOUND', 'Không tìm thấy người nhận.');
        await taskRepository.appendTaskEvent({
            taskId: task.id, assigneeId, eventType: 'COMMENT',
            actorType: 'MANAGER', actorId: String(managerId), reason: String(text).trim()
        });
        await taskRepository.enqueueOutbox({
            deduplicationKey: `cmtr:${task.id}:${assigneeId}:${Date.now()}`,
            chatId: assignee.telegram_user_id_snapshot,
            text: `💬 #T-${task.display_code} — Người giao việc trả lời:\n${String(text).trim()}`,
            linkMeta: {
                taskId: task.id, assigneeId,
                direction: 'EMPLOYEE_COMMENT', chatId: assignee.telegram_user_id_snapshot
            }
        });
        return { task, assignee };
    }

    async function loadTaskByIdInternal(taskId) {
        const { task } = await taskRepository.getTaskWithAssignees(taskId);
        return task;
    }

    // ----- Dữ liệu cho cron -----

    async function processNotAcceptedReminders() {
        // Có ruleConfigService: lấy tối đa cửa sổ lớn nhất rồi lọc theo ngưỡng từng người giao
        const rows = await taskRepository.findAssigneesNotAccepted(
            ruleConfigService ? FETCH_WINDOW_MINUTES_MIN : NOT_ACCEPTED_MINUTES);
        const nowMs = now().getTime();
        const configs = ruleConfigService
            ? await ruleConfigService.loadConfigsForTick(rows.map(r => r.created_by))
            : null;
        let sent = 0;
        for (const row of rows) {
            const config = configs?.get(String(row.created_by));
            if (configs && ruleConfigService.shouldSkip(config)) continue;
            if (configs && !ruleConfigService.isNotAcceptedLateEnough(config, row.assigned_at, nowMs)) continue;
            await taskRepository.enqueueOutbox({
                deduplicationKey: `na:${row.id}`,
                chatId: row.telegram_user_id_snapshot,
                text: `⏰ Nhắc: bạn chưa bấm ✅ Nhận việc cho #T-${row.display_code} — ${row.title}.`,
                replyMarkup: { inline_keyboard: [[
                    { text: '✅ Nhận việc', callback_data: `task:accept:${row.display_code}` }
                ]] }
            });
            await taskRepository.markNotAcceptedReminded(row.id);
            sent += 1;
        }
        return sent;
    }

    async function processDueSoonReminders() {
        const rows = await taskRepository.findAssigneesDueSoon(
            ruleConfigService ? FETCH_WINDOW_MINUTES_MAX : BEFORE_DUE_MINUTES);
        const nowMs = now().getTime();
        const configs = ruleConfigService
            ? await ruleConfigService.loadConfigsForTick(rows.map(r => r.created_by))
            : null;
        let sent = 0;
        for (const row of rows) {
            const config = configs?.get(String(row.created_by));
            if (configs && ruleConfigService.shouldSkip(config)) continue;
            if (configs && !ruleConfigService.isDueSoonWithin(config, row.due_at, nowMs)) continue;
            await taskRepository.enqueueOutbox({
                deduplicationKey: `bd:${row.id}:${new Date(row.due_at).getTime()}`,
                chatId: row.telegram_user_id_snapshot,
                text: `⏰ #T-${row.display_code} sắp đến hạn (${formatVnTime(row.due_at)}): ${row.title}`,
                replyMarkup: { inline_keyboard: [[
                    { text: '✔ Hoàn thành', callback_data: `task:complete:${row.display_code}` },
                    getTaskExtendUrl(row.display_code)
                        ? { text: '⏰ Xin gia hạn', url: getTaskExtendUrl(row.display_code) }
                        : { text: '⏰ Xin gia hạn', callback_data: `task:extend:${row.display_code}` }
                ]] }
            });
            await taskRepository.markBeforeDueReminded(row.id, row.due_at);
            sent += 1;
        }
        return sent;
    }

    async function processOverdueReminders() {
        const rows = await taskRepository.findAssigneesOverdue();
        const nowMs = now().getTime();
        const configs = ruleConfigService
            ? await ruleConfigService.loadConfigsForTick(rows.map(r => r.created_by))
            : null;
        let employeeCount = 0;
        let managerCount = 0;
        for (const row of rows) {
            const config = configs?.get(String(row.created_by));
            if (configs && ruleConfigService.shouldSkip(config)) continue;
            const dueMs = new Date(row.due_at).getTime();
            const managerHours = config ? config.overdue_manager_hours : OVERDUE_MANAGER_HOURS;
            if (!row.overdue_reminded_at) {
                await taskRepository.enqueueOutbox({
                    deduplicationKey: `od:${row.id}:${dueMs}`,
                    chatId: row.telegram_user_id_snapshot,
                    text: `🔴 #T-${row.display_code} đã quá hạn (${formatVnTime(row.due_at)}): ${row.title}. Xong hãy bấm ✔ Hoàn thành.`,
                    replyMarkup: { inline_keyboard: [[
                        { text: '✔ Hoàn thành', callback_data: `task:complete:${row.display_code}` },
                        getTaskExtendUrl(row.display_code)
                            ? { text: '⏰ Xin gia hạn', url: getTaskExtendUrl(row.display_code) }
                            : { text: '⏰ Xin gia hạn', callback_data: `task:extend:${row.display_code}` }
                    ]] }
                });
                await taskRepository.markOverdueReminded(row.id);
                employeeCount += 1;
            }
            if (!row.overdue_manager_notified_at && nowMs - dueMs >= managerHours * 3600 * 1000) {
                await taskRepository.enqueueOutbox({
                    deduplicationKey: `odm:${row.id}:${dueMs}`,
                    chatId: row.created_by,
                    text: `🔴 #T-${row.display_code} — ${row.employee_name_snapshot || row.employee_code_snapshot || row.telegram_user_id_snapshot} đã quá hạn ${managerHours} giờ: ${row.title}`
                });
                await taskRepository.markOverdueManagerNotified(row.id);
                managerCount += 1;
            }
        }
        return { employeeCount, managerCount };
    }

    async function processDailyReminders() {
        const today = vietnamToday(now());
        const candidates = await taskRepository.findDailyReminderCandidates(today);
        if (!candidates.length) return 0;
        const configs = ruleConfigService
            ? await ruleConfigService.loadConfigsForTick(candidates.map(c => c.created_by))
            : null;
        const telegramIds = [...new Set(candidates.map(c => c.telegram_user_id_snapshot))];
        const checkins = await taskRepository.findFirstCheckinsToday(today, telegramIds);
        const checkinByTg = new Map(checkins.map(r => [r.telegram_id, r.first_checkin]));

        const reminderMinutes = DAILY_REMINDER_MINUTES_AFTER_CHECKIN * 60 * 1000;
        const nowMs = now().getTime();
        let sent = 0;
        for (const candidate of candidates) {
            const config = configs?.get(String(candidate.created_by));
            if (configs && ruleConfigService.shouldSkip(config)) continue;
            const checkin = checkinByTg.get(candidate.telegram_user_id_snapshot);
            if (!checkin) continue; // chưa check-in thì không nhắc hàng ngày
            if (nowMs - new Date(checkin).getTime() < reminderMinutes) continue;
            const open = candidates.filter(c => c.telegram_user_id_snapshot === candidate.telegram_user_id_snapshot);
            const text = buildEmployeeReminderText({
                openTasks: open.map(c => ({ display_code: c.display_code, title: c.title, due_at: c.due_at }))
            });
            if (text) {
                await taskRepository.enqueueOutbox({
                    deduplicationKey: `dr:${candidate.id}:${today}`,
                    chatId: candidate.telegram_user_id_snapshot,
                    text
                });
            }
            for (const c of open) {
                await taskRepository.markDailyReminded(c.id, today);
            }
            sent += 1;
        }
        return sent;
    }

    async function buildEodSummaries() {
        const creators = new Map();
        const all = await taskRepository.listAllActiveTasksForEod();
        for (const row of all) {
            if (!creators.has(row.created_by)) creators.set(row.created_by, []);
            creators.get(row.created_by).push(row);
        }
        const summaries = [];
        for (const [creatorId, rows] of creators) {
            const text = buildEodText({ rows, now: now() });
            if (text) summaries.push({ managerTelegramId: creatorId, text });
        }
        return summaries;
    }

    async function sendEodSummaries() {
        const summaries = await buildEodSummaries();
        for (const summary of summaries) {
            await taskRepository.enqueueOutbox({
                deduplicationKey: `eod:${summary.managerTelegramId}:${vietnamToday(now())}`,
                chatId: summary.managerTelegramId,
                text: summary.text
            });
        }
        return summaries.length;
    }

    async function listOpenForManager(managerId) {
        return taskRepository.listOpenTasksByCreator(managerId);
    }

    async function listOpenForEmployee(telegramUserId) {
        return taskRepository.findOpenAssigneesByTelegramIds([String(telegramUserId)]);
    }

    async function listDueSoonForManager(managerId) {
        const rows = await taskRepository.listOpenTasksByCreator(managerId);
        const config = ruleConfigService
            ? (await ruleConfigService.loadConfigsForTick([managerId])).get(String(managerId))
            : null;
        if (config && ruleConfigService.shouldSkip(config)) return [];
        const nowMs = now().getTime();
        const windowMs = (config?.due_soon_minutes || BEFORE_DUE_MINUTES) * 60 * 1000;
        return rows.filter(row => ['ASSIGNED', 'ACCEPTED'].includes(row.assignment_status) &&
            new Date(row.due_at).getTime() > nowMs && new Date(row.due_at).getTime() <= nowMs + windowMs);
    }

    async function listOverdueForManager(managerId) {
        const rows = await taskRepository.findAssigneesOverdue();
        return rows.filter(row => String(row.created_by) === String(managerId));
    }

    async function remindNotAcceptedForManager(managerId) {
        const rows = await taskRepository.findAssigneesNotAccepted(
            ruleConfigService ? FETCH_WINDOW_MINUTES_MIN : NOT_ACCEPTED_MINUTES);
        const config = ruleConfigService
            ? (await ruleConfigService.loadConfigsForTick([managerId])).get(String(managerId))
            : null;
        const nowMs = now().getTime();
        let sent = 0;
        for (const row of rows.filter(item => String(item.created_by) === String(managerId))) {
            if (config && (ruleConfigService.shouldSkip(config) ||
                !ruleConfigService.isNotAcceptedLateEnough(config, row.assigned_at, nowMs))) continue;
            await taskRepository.enqueueOutbox({
                deduplicationKey: `na:${row.id}`,
                chatId: row.telegram_user_id_snapshot,
                text: `⏰ Nhắc: bạn chưa bấm ✅ Nhận việc cho #T-${row.display_code} — ${row.title}.`,
                replyMarkup: { inline_keyboard: [[
                    { text: '✅ Nhận việc', callback_data: `task:accept:${row.display_code}` }
                ]] }
            });
            await taskRepository.markNotAcceptedReminded(row.id);
            sent += 1;
        }
        return sent;
    }

    async function remindDueSoonForManager(managerId) {
        const rows = await taskRepository.findAssigneesDueSoon(
            ruleConfigService ? FETCH_WINDOW_MINUTES_MAX : BEFORE_DUE_MINUTES);
        const config = ruleConfigService
            ? (await ruleConfigService.loadConfigsForTick([managerId])).get(String(managerId))
            : null;
        const nowMs = now().getTime();
        let sent = 0;
        for (const row of rows.filter(item => String(item.created_by) === String(managerId))) {
            if (config && (ruleConfigService.shouldSkip(config) ||
                !ruleConfigService.isDueSoonWithin(config, row.due_at, nowMs))) continue;
            await taskRepository.enqueueOutbox({
                deduplicationKey: `bd:${row.id}:${new Date(row.due_at).getTime()}`,
                chatId: row.telegram_user_id_snapshot,
                text: `⏰ #T-${row.display_code} sắp đến hạn (${formatVnTime(row.due_at)}): ${row.title}`,
                replyMarkup: { inline_keyboard: [[
                    { text: '✔ Hoàn thành', callback_data: `task:complete:${row.display_code}` },
                    getTaskExtendUrl(row.display_code)
                        ? { text: '⏰ Xin gia hạn', url: getTaskExtendUrl(row.display_code) }
                        : { text: '⏰ Xin gia hạn', callback_data: `task:extend:${row.display_code}` }
                ]] }
            });
            await taskRepository.markBeforeDueReminded(row.id, row.due_at);
            sent += 1;
        }
        return sent;
    }

    return {
        createTask,
        assertAssignee,
        acceptTask,
        declineTask,
        completeTask,
        reviewApprove,
        reviewReject,
        requestExtend,
        decideExtend,
        cancelTask,
        saveEmployeeComment,
        saveManagerComment,
        processNotAcceptedReminders,
        processDueSoonReminders,
        processOverdueReminders,
        processDailyReminders,
        buildEodSummaries,
        sendEodSummaries,
        listOpenForManager,
        listOpenForEmployee,
        listDueSoonForManager,
        listOverdueForManager,
        remindNotAcceptedForManager,
        remindDueSoonForManager,
        enqueueTaskMessageToEmployee,
        getTaskExtendUrl
    };
}

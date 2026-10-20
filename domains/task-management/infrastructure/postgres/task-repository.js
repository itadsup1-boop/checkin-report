export function createTaskRepository({ pool }) {
    return {
        async findEmployeesByCodes(codes) {
            const result = await pool.query(
                `SELECT id, employee_code, full_name, telegram_id, telegram_group_id, is_active
                 FROM employees
                 WHERE employee_code = ANY($1::text[]) AND is_active = true`,
                [codes]
            );
            return result.rows;
        },

        async findEmployeesByNames(names) {
            const result = await pool.query(
                `SELECT id, employee_code, full_name, telegram_id, telegram_group_id, is_active
                 FROM employees
                 WHERE is_active = true
                   AND EXISTS (
                       SELECT 1 FROM unnest($1::text[]) AS query_name
                       WHERE lower(employees.full_name) LIKE '%' || lower(query_name) || '%'
                   )`,
                [names]
            );
            return result.rows;
        },

        async findAllActiveEmployees() {
            const result = await pool.query(
                `SELECT id, employee_code, full_name, telegram_id, telegram_group_id, is_active
                 FROM employees
                 WHERE is_active = true
                 ORDER BY employee_code`
            );
            return result.rows;
        },

        async findAllActiveEmployeesWithGroups() {
            const result = await pool.query(
                `SELECT DISTINCT e.id, e.employee_code, e.full_name, e.telegram_id,
                        e.telegram_group_id AS primary_telegram_group_id,
                        g.telegram_group_id, g.group_name
                 FROM employees e
                 JOIN telegram_groups g ON (
                     g.telegram_group_id = e.telegram_group_id
                     OR EXISTS (
                         SELECT 1 FROM employee_group_memberships membership
                         WHERE membership.employee_id = e.id
                           AND membership.telegram_group_id = g.telegram_group_id
                     )
                 )
                 LEFT JOIN employee_group_memberships m
                   ON m.employee_id = e.id AND m.telegram_group_id = g.telegram_group_id
                 WHERE e.is_active = true
                   AND g.is_active = true
                   AND COALESCE(m.status, 'ACTIVE') = 'ACTIVE'
                 ORDER BY g.group_name, e.full_name, e.employee_code`
            );
            return result.rows;
        },

        async createTaskWithAssignees({ task, assignees, idempotencyKey }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const taskResult = await client.query(
                    `INSERT INTO ai_management.tasks
                        (title, description, priority, reminder_mode, starts_at, due_at, created_by, idempotency_key)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (idempotency_key) DO NOTHING
                     RETURNING *`,
                    [task.title, task.description, task.priority, task.reminderMode,
                        task.startsAt, task.dueAt, task.createdBy, idempotencyKey]
                );
                if (!taskResult.rows.length) {
                    await client.query('ROLLBACK');
                    const existing = await pool.query(
                        'SELECT * FROM ai_management.tasks WHERE idempotency_key = $1',
                        [idempotencyKey]
                    );
                    return { duplicated: true, task: existing.rows[0] };
                }
                const createdTask = taskResult.rows[0];

                const createdAssignees = [];
                for (const assignee of assignees) {
                    const assigneeResult = await client.query(
                        `INSERT INTO ai_management.task_assignees
                            (task_id, employee_id, employee_code_snapshot, employee_name_snapshot, telegram_user_id_snapshot)
                         VALUES ($1, $2, $3, $4, $5)
                         RETURNING *`,
                        [createdTask.id, assignee.employeeId, assignee.employeeCode,
                            assignee.employeeName, assignee.telegramUserId]
                    );
                    createdAssignees.push(assigneeResult.rows[0]);
                }

                await client.query(
                    `INSERT INTO ai_management.task_events
                        (task_id, event_type, actor_type, actor_id, new_values)
                     VALUES ($1, 'CREATED', 'MANAGER', $2, $3::jsonb)`,
                    [createdTask.id, task.createdBy, JSON.stringify({
                        title: task.title, due_at: task.dueAt,
                        priority: task.priority, reminder_mode: task.reminderMode
                    })]
                );
                for (const assignee of createdAssignees) {
                    await client.query(
                        `INSERT INTO ai_management.task_events
                            (task_id, assignee_id, event_type, actor_type, actor_id, new_values)
                         VALUES ($1, $2, 'ASSIGNED', 'MANAGER', $3, $4::jsonb)`,
                        [createdTask.id, assignee.id, task.createdBy, JSON.stringify({
                            telegram_user_id: assignee.telegram_user_id_snapshot
                        })]
                    );
                }

                await client.query('COMMIT');
                return { duplicated: false, task: createdTask, assignees: createdAssignees };
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        },

        async findTaskByDisplayCode(displayCode) {
            const result = await pool.query(
                'SELECT * FROM ai_management.tasks WHERE display_code = $1',
                [displayCode]
            );
            return result.rows[0] || null;
        },

        async getTaskWithAssignees(taskId) {
            const taskResult = await pool.query(
                'SELECT * FROM ai_management.tasks WHERE id = $1',
                [taskId]
            );
            if (!taskResult.rows.length) return null;
            const assigneesResult = await pool.query(
                `SELECT * FROM ai_management.task_assignees
                 WHERE task_id = $1 ORDER BY id`,
                [taskId]
            );
            return { task: taskResult.rows[0], assignees: assigneesResult.rows };
        },

        async findAssigneeByTaskAndTelegram(taskId, telegramUserId) {
            const result = await pool.query(
                `SELECT * FROM ai_management.task_assignees
                 WHERE task_id = $1 AND telegram_user_id_snapshot = $2`,
                [taskId, String(telegramUserId)]
            );
            return result.rows[0] || null;
        },

        async findAssigneeById(assigneeId) {
            const result = await pool.query(
                `SELECT a.*, t.title, t.due_at, t.created_by, t.status AS task_status, t.display_code
                 FROM ai_management.task_assignees a
                 JOIN ai_management.tasks t ON t.id = a.task_id
                 WHERE a.id = $1`,
                [assigneeId]
            );
            return result.rows[0] || null;
        },

        async updateAssigneeStatus(assigneeId, { status, acceptedAt = null, completedAt = null, reviewedAt = null, reviewedBy = null, reviewNote = null }) {
            const result = await pool.query(
                `UPDATE ai_management.task_assignees
                 SET assignment_status = $2,
                     accepted_at = COALESCE($3, accepted_at),
                     completed_at = COALESCE($4, completed_at),
                     reviewed_at = COALESCE($5, reviewed_at),
                     reviewed_by = COALESCE($6, reviewed_by),
                     review_note = COALESCE($7, review_note),
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [assigneeId, status, acceptedAt, completedAt, reviewedAt, reviewedBy, reviewNote]
            );
            return result.rows[0];
        },

        async appendTaskEvent({ taskId, assigneeId = null, eventType, actorType, actorId, oldValues = null, newValues = null, reason = null }) {
            await pool.query(
                `INSERT INTO ai_management.task_events
                    (task_id, assignee_id, event_type, actor_type, actor_id, old_values, new_values, reason)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
                [taskId, assigneeId, eventType, actorType, actorId,
                    oldValues ? JSON.stringify(oldValues) : null,
                    newValues ? JSON.stringify(newValues) : null,
                    reason]
            );
        },

        async getLastComment(taskId, assigneeId) {
            const result = await pool.query(
                `SELECT reason FROM ai_management.task_events
                 WHERE task_id = $1 AND assignee_id = $2 AND event_type = 'COMMENT'
                 ORDER BY created_at DESC LIMIT 1`,
                [taskId, assigneeId]
            );
            return result.rows[0]?.reason || null;
        },

        async cancelTask(taskId, { cancelledBy, reason }) {
            const result = await pool.query(
                `UPDATE ai_management.tasks
                 SET status = 'CANCELLED', cancelled_by = $2, cancelled_reason = $3,
                     cancelled_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND status = 'ACTIVE'
                 RETURNING *`,
                [taskId, cancelledBy, reason]
            );
            return result.rows[0] || null;
        },

        async updateTaskDueAt(taskId, newDueAt) {
            const result = await pool.query(
                `UPDATE ai_management.tasks
                 SET due_at = $2, updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [taskId, newDueAt]
            );
            return result.rows[0];
        },

        async createExtendRequest({ taskId, assigneeId, proposedDueAt, reason, requestedBy }) {
            const result = await pool.query(
                `INSERT INTO ai_management.extend_requests
                    (task_id, assignee_id, proposed_due_at, reason, requested_by)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [taskId, assigneeId, proposedDueAt, reason, requestedBy]
            );
            return result.rows[0];
        },

        async findExtendRequestById(requestId) {
            const result = await pool.query(
                `SELECT r.*, a.telegram_user_id_snapshot, a.employee_name_snapshot, t.display_code, t.due_at
                 FROM ai_management.extend_requests r
                 JOIN ai_management.task_assignees a ON a.id = r.assignee_id
                 JOIN ai_management.tasks t ON t.id = r.task_id
                 WHERE r.id = $1`,
                [requestId]
            );
            return result.rows[0] || null;
        },

        async decideExtendRequest(requestId, { status, decidedBy }) {
            const result = await pool.query(
                `UPDATE ai_management.extend_requests
                 SET status = $2, decided_by = $3, decided_at = NOW()
                 WHERE id = $1 AND status = 'PENDING'
                 RETURNING *`,
                [requestId, status, decidedBy]
            );
            return result.rows[0] || null;
        },

        // ----- Nhắc việc: các truy vấn quét cho cron -----

        async findAssigneesNotAccepted(minutesThreshold) {
            const result = await pool.query(
                `SELECT a.id, a.task_id, a.telegram_user_id_snapshot, a.employee_name_snapshot,
                        a.assigned_at, t.display_code, t.title, t.created_by
                 FROM ai_management.task_assignees a
                 JOIN ai_management.tasks t ON t.id = a.task_id
                 WHERE t.status = 'ACTIVE'
                   AND a.assignment_status = 'ASSIGNED'
                   AND a.not_accepted_reminded_at IS NULL
                   AND a.assigned_at <= NOW() - ($1 || ' minutes')::interval`,
                [String(minutesThreshold)]
            );
            return result.rows;
        },

        async markNotAcceptedReminded(assigneeId) {
            await pool.query(
                'UPDATE ai_management.task_assignees SET not_accepted_reminded_at = NOW(), updated_at = NOW() WHERE id = $1',
                [assigneeId]
            );
        },

        async findAssigneesDueSoon(windowMinutes) {
            const result = await pool.query(
                `SELECT a.id, a.task_id, a.telegram_user_id_snapshot, a.employee_name_snapshot,
                        a.before_due_reminded_due_at, t.display_code, t.title, t.due_at, t.reminder_mode, t.created_by
                 FROM ai_management.task_assignees a
                 JOIN ai_management.tasks t ON t.id = a.task_id
                 WHERE t.status = 'ACTIVE'
                   AND t.reminder_mode = 'ONCE_BEFORE_DUE'
                   AND a.assignment_status IN ('ASSIGNED', 'ACCEPTED')
                   AND a.before_due_reminded_due_at IS DISTINCT FROM t.due_at
                   AND t.due_at <= NOW() + ($1 || ' minutes')::interval
                   AND t.due_at > NOW()`,
                [String(windowMinutes)]
            );
            return result.rows;
        },

        async markBeforeDueReminded(assigneeId, dueAt) {
            await pool.query(
                `UPDATE ai_management.task_assignees
                 SET before_due_reminded_due_at = $2, updated_at = NOW()
                 WHERE id = $1`,
                [assigneeId, dueAt]
            );
        },

        async findAssigneesOverdue() {
            const result = await pool.query(
                `SELECT a.id, a.task_id, a.telegram_user_id_snapshot, a.employee_name_snapshot,
                        a.employee_code_snapshot, a.overdue_reminded_at, a.overdue_manager_notified_at,
                        t.display_code, t.title, t.due_at, t.created_by
                 FROM ai_management.task_assignees a
                 JOIN ai_management.tasks t ON t.id = a.task_id
                 WHERE t.status = 'ACTIVE'
                   AND a.assignment_status IN ('ASSIGNED', 'ACCEPTED')
                   AND t.due_at < NOW()`,
                [ ]
            );
            return result.rows;
        },

        async markOverdueReminded(assigneeId) {
            await pool.query(
                'UPDATE ai_management.task_assignees SET overdue_reminded_at = NOW(), updated_at = NOW() WHERE id = $1',
                [assigneeId]
            );
        },

        async markOverdueManagerNotified(assigneeId) {
            await pool.query(
                'UPDATE ai_management.task_assignees SET overdue_manager_notified_at = NOW(), updated_at = NOW() WHERE id = $1',
                [assigneeId]
            );
        },

        async findDailyReminderCandidates(vietnamToday) {
            const result = await pool.query(
                `SELECT a.id, a.task_id, a.telegram_user_id_snapshot, a.employee_name_snapshot,
                        a.last_daily_reminded_on, t.display_code, t.title, t.due_at, t.created_by
                 FROM ai_management.task_assignees a
                 JOIN ai_management.tasks t ON t.id = a.task_id
                 WHERE t.status = 'ACTIVE'
                   AND t.reminder_mode = 'DAILY_AFTER_CHECKIN'
                   AND a.assignment_status IN ('ASSIGNED', 'ACCEPTED')
                   AND (a.last_daily_reminded_on IS NULL OR a.last_daily_reminded_on < $1)`,
                [vietnamToday]
            );
            return result.rows;
        },

        async markDailyReminded(assigneeId, vietnamToday) {
            await pool.query(
                `UPDATE ai_management.task_assignees
                 SET last_daily_reminded_on = $2, updated_at = NOW()
                 WHERE id = $1`,
                [assigneeId, vietnamToday]
            );
        },

        async findOpenAssigneesByTelegramIds(telegramIds) {
            const result = await pool.query(
                `SELECT a.id, a.task_id, a.telegram_user_id_snapshot,
                        t.display_code, t.title, t.due_at, a.assignment_status
                 FROM ai_management.task_assignees a
                 JOIN ai_management.tasks t ON t.id = a.task_id
                 WHERE t.status = 'ACTIVE'
                   AND a.assignment_status IN ('ASSIGNED', 'ACCEPTED')
                   AND a.telegram_user_id_snapshot = ANY($1::text[])`,
                [telegramIds]
            );
            return result.rows;
        },

        // Chỉ ĐỌC sự kiện check-in của module chấm công, không ghi gì vào đó
        async findFirstCheckinsToday(vietnamToday, telegramIds) {
            const result = await pool.query(
                `SELECT tu.telegram_id, MIN(tc.check_in_time) AS first_checkin
                 FROM tk_check_ins tc
                 JOIN tk_users tu ON tu.id = tc.user_id
                 WHERE tc.date = $1 AND tu.telegram_id = ANY($2::text[])
                 GROUP BY tu.telegram_id`,
                [vietnamToday, telegramIds]
            );
            return result.rows;
        },

        async listOpenTasksByCreator(creatorId) {
            const result = await pool.query(
                `SELECT t.id, t.display_code, t.title, t.due_at, t.reminder_mode,
                        a.id AS assignee_id, a.employee_name_snapshot, a.employee_code_snapshot,
                        a.telegram_user_id_snapshot, a.assignment_status,
                        a.completed_at, a.accepted_at, a.reviewed_at
                 FROM ai_management.tasks t
                 JOIN ai_management.task_assignees a ON a.task_id = t.id
                 WHERE t.status = 'ACTIVE' AND t.created_by = $1
                 ORDER BY t.due_at, t.display_code, a.id`,
                [String(creatorId)]
            );
            return result.rows;
        },

        async listOpenTasksByEmployeeIds(employeeIds) {
            if (!employeeIds.length) return [];
            const result = await pool.query(
                `SELECT t.id, t.title, a.employee_id
                 FROM ai_management.tasks t
                 JOIN ai_management.task_assignees a ON a.task_id = t.id
                 WHERE t.status = 'ACTIVE' AND a.employee_id = ANY($1::bigint[])`,
                [employeeIds]
            );
            return result.rows;
        },

        async listTasksForExport({ createdBy, fromDate, toDate }) {
            const result = await pool.query(
                `SELECT t.id, t.display_code, t.title, t.priority, t.reminder_mode,
                        t.due_at, t.created_at, t.status,
                        a.employee_code_snapshot, a.employee_name_snapshot,
                        a.assignment_status, a.accepted_at, a.completed_at,
                        a.reviewed_at, a.reviewed_by, a.review_note
                 FROM ai_management.tasks t
                 JOIN ai_management.task_assignees a ON a.task_id = t.id
                 WHERE t.created_by = $1 AND t.due_at >= $2 AND t.due_at < $3
                 ORDER BY t.due_at, t.display_code, a.id`,
                [String(createdBy), fromDate, toDate]
            );
            return result.rows;
        },

        async findNameByTelegramId(telegramUserId) {
            const result = await pool.query(
                `SELECT full_name FROM employees
                 WHERE split_part(telegram_id, ',', 1) = $1 OR telegram_id = $1
                 LIMIT 1`,
                [String(telegramUserId)]
            );
            return result.rows[0]?.full_name || null;
        },

        async reopenAssignee(assigneeId, { reviewedBy, reviewNote }) {
            const result = await pool.query(
                `UPDATE ai_management.task_assignees
                 SET assignment_status = 'ACCEPTED',
                     completed_at = NULL,
                     reviewed_at = NOW(),
                     reviewed_by = $2,
                     review_note = $3,
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [assigneeId, reviewedBy, reviewNote]
            );
            return result.rows[0];
        },

        async resetReminderFlags(assigneeId) {
            await pool.query(
                `UPDATE ai_management.task_assignees
                 SET before_due_reminded_due_at = NULL,
                     overdue_reminded_at = NULL,
                     overdue_manager_notified_at = NULL,
                     updated_at = NOW()
                 WHERE id = $1`,
                [assigneeId]
            );
        },

        async listAllActiveTasksForEod() {
            const result = await pool.query(
                `SELECT t.id, t.display_code, t.title, t.due_at, t.created_by,
                        a.employee_name_snapshot, a.employee_code_snapshot,
                        a.telegram_user_id_snapshot, a.assignment_status,
                        a.completed_at, a.reviewed_at
                 FROM ai_management.tasks t
                 JOIN ai_management.task_assignees a ON a.task_id = t.id
                 WHERE t.status = 'ACTIVE'
                 ORDER BY t.created_by, t.due_at, t.display_code, a.id`
            );
            return result.rows;
        },

        // ----- Outbox -----

        async enqueueOutbox({ deduplicationKey, chatId, text, replyMarkup = null, linkMeta = null, availableAt = null }) {
            const result = await pool.query(
                `INSERT INTO ai_management.notification_outbox
                    (deduplication_key, chat_id, text, reply_markup, link_meta, available_at)
                 VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, COALESCE($6, NOW()))
                 ON CONFLICT (deduplication_key) DO NOTHING
                 RETURNING *`,
                [deduplicationKey, String(chatId), text,
                    replyMarkup ? JSON.stringify(replyMarkup) : null,
                    linkMeta ? JSON.stringify(linkMeta) : null,
                    availableAt]
            );
            return result.rows[0] || null;
        },

        async claimOutboxBatch(limit = 10) {
            const result = await pool.query(
                `UPDATE ai_management.notification_outbox
                 SET status = 'SENDING', attempt_count = attempt_count + 1
                 WHERE id IN (
                     SELECT id FROM ai_management.notification_outbox
                     WHERE status = 'PENDING' AND available_at <= NOW()
                     ORDER BY id
                     LIMIT $1
                     FOR UPDATE SKIP LOCKED
                 )
                 RETURNING *`,
                [limit]
            );
            return result.rows;
        },

        async markOutboxSent(rowId) {
            await pool.query(
                `UPDATE ai_management.notification_outbox
                 SET status = 'SENT', sent_at = NOW(), last_error = NULL
                 WHERE id = $1`,
                [rowId]
            );
        },

        async markOutboxFailed(rowId, { error, retry, backoffMinutes }) {
            await pool.query(
                `UPDATE ai_management.notification_outbox
                 SET status = $2, available_at = NOW() + ($3 || ' minutes')::interval, last_error = $4
                 WHERE id = $1`,
                [rowId, retry ? 'PENDING' : 'FAILED', String(backoffMinutes), String(error).slice(0, 500)]
            );
        },

        // ----- Định tuyến reply -----

        async saveMessageLink({ chatId, messageId, taskId, assigneeId = null, direction }) {
            await pool.query(
                `INSERT INTO ai_management.task_message_links
                    (chat_id, message_id, task_id, assignee_id, direction)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (chat_id, message_id) DO NOTHING`,
                [String(chatId), messageId, taskId, assigneeId, direction]
            );
        },

        async findMessageLink(chatId, messageId) {
            const result = await pool.query(
                `SELECT l.*, t.display_code, t.created_by
                 FROM ai_management.task_message_links l
                 JOIN ai_management.tasks t ON t.id = l.task_id
                 WHERE l.chat_id = $1 AND l.message_id = $2`,
                [String(chatId), messageId]
            );
            return result.rows[0] || null;
        }
    };
}

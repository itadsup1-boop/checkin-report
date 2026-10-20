// Chạm DB duy nhất của luồng rule (mục 29): đọc/ghi cấu hình ngưỡng nhắc của
// từng quản lý + các truy vấn đếm phục vụ mô phỏng "sẽ nhắc bao nhiêu".

export function createRuleConfigRepository({ pool }) {
    return {
        async getRuleConfig(managerId) {
            const result = await pool.query(
                'SELECT * FROM ai_management.manager_rule_configs WHERE manager_id = $1',
                [String(managerId)]
            );
            return result.rows[0] || null;
        },

        async getRuleConfigsForManagers(managerIds) {
            if (!managerIds.length) return [];
            const result = await pool.query(
                'SELECT * FROM ai_management.manager_rule_configs WHERE manager_id = ANY($1::text[])',
                [managerIds.map(String)]
            );
            return result.rows;
        },

        async upsertRuleConfig(managerId, fields) {
            const result = await pool.query(
                `INSERT INTO ai_management.manager_rule_configs
                    (manager_id, due_soon_minutes, not_accepted_minutes, overdue_manager_hours,
                     form_due_soon_hours, form_overdue_manager_hours)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (manager_id) DO UPDATE SET
                    due_soon_minutes = COALESCE($2, manager_rule_configs.due_soon_minutes),
                    not_accepted_minutes = COALESCE($3, manager_rule_configs.not_accepted_minutes),
                    overdue_manager_hours = COALESCE($4, manager_rule_configs.overdue_manager_hours),
                    form_due_soon_hours = COALESCE($5, manager_rule_configs.form_due_soon_hours),
                    form_overdue_manager_hours = COALESCE($6, manager_rule_configs.form_overdue_manager_hours),
                    updated_at = NOW()
                 RETURNING *`,
                [String(managerId),
                    fields.dueSoonMinutes ?? null, fields.notAcceptedMinutes ?? null,
                    fields.overdueManagerHours ?? null, fields.formDueSoonHours ?? null,
                    fields.formOverdueManagerHours ?? null]
            );
            return result.rows[0];
        },

        async setRuleConfigPaused(managerId, paused) {
            const result = await pool.query(
                `INSERT INTO ai_management.manager_rule_configs (manager_id, paused)
                 VALUES ($1, $2)
                 ON CONFLICT (manager_id) DO UPDATE SET paused = $2, updated_at = NOW()
                 RETURNING *`,
                [String(managerId), paused]
            );
            return result.rows[0];
        },

        async countAssigneesNotAcceptedPending(minutes) {
            const result = await pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM ai_management.task_assignees a
                 JOIN ai_management.tasks t ON t.id = a.task_id
                 WHERE t.status = 'ACTIVE'
                   AND a.assignment_status = 'ASSIGNED'
                   AND a.not_accepted_reminded_at IS NULL
                   AND a.assigned_at <= NOW() - ($1 || ' minutes')::interval`,
                [String(minutes)]
            );
            return result.rows[0].count;
        },

        async countAssigneesDueWithin(minutes) {
            const result = await pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM ai_management.task_assignees a
                 JOIN ai_management.tasks t ON t.id = a.task_id
                 WHERE t.status = 'ACTIVE'
                   AND t.reminder_mode = 'ONCE_BEFORE_DUE'
                   AND a.assignment_status IN ('ASSIGNED', 'ACCEPTED')
                   AND a.before_due_reminded_due_at IS DISTINCT FROM t.due_at
                   AND t.due_at > NOW()
                   AND t.due_at <= NOW() + ($1 || ' minutes')::interval`,
                [String(minutes)]
            );
            return result.rows[0].count;
        },

        async countFormsDueWithin(hours) {
            const result = await pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM ai_management.report_form_assignments a
                 JOIN ai_management.report_form_templates t ON t.id = a.template_id
                 WHERE a.status = 'OPEN'
                   AND t.status = 'PUBLISHED'
                   AND a.due_at > NOW()
                   AND a.due_at <= NOW() + ($1 || ' hours')::interval`,
                [String(hours)]
            );
            return result.rows[0].count;
        }
    };
}

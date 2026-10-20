export function createFormRepository({ pool }) {
    return {
        // ----- Mẫu form và phiên bản -----

        async createFormTemplate({ title, description, rubric, fields, createdBy }) {
            const result = await pool.query(
                `INSERT INTO ai_management.report_form_templates
                    (title, description, rubric, draft_fields, created_by)
                 VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
                 RETURNING *`,
                [title, description, JSON.stringify(rubric || []),
                    JSON.stringify(fields || []), String(createdBy)]
            );
            return result.rows[0];
        },

        async findFormTemplateByDisplayCode(displayCode) {
            const result = await pool.query(
                'SELECT * FROM ai_management.report_form_templates WHERE display_code = $1',
                [displayCode]
            );
            return result.rows[0] || null;
        },

        async updateFormTemplateDraft(templateId, { title, description, rubric, fields }) {
            const result = await pool.query(
                `UPDATE ai_management.report_form_templates
                 SET title = COALESCE($2, title),
                     description = COALESCE($3, description),
                     rubric = COALESCE($4::jsonb, rubric),
                     draft_fields = COALESCE($5::jsonb, draft_fields),
                     updated_at = NOW()
                 WHERE id = $1 AND status = 'DRAFT'
                 RETURNING *`,
                [templateId, title, description,
                    rubric ? JSON.stringify(rubric) : null,
                    fields ? JSON.stringify(fields) : null]
            );
            return result.rows[0] || null;
        },

        // Phát hành: thêm phiên bản bất biến + chuyển template sang PUBLISHED
        async addFormVersion({ templateId, fields, publishedBy }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const versionResult = await client.query(
                    `INSERT INTO ai_management.report_form_versions
                        (template_id, version_no, fields, published_by)
                     SELECT $1, COALESCE(MAX(version_no), 0) + 1, $2::jsonb, $3
                     FROM ai_management.report_form_versions
                     WHERE template_id = $1
                     RETURNING *`,
                    [templateId, JSON.stringify(fields), String(publishedBy)]
                );
                const templateResult = await client.query(
                    `UPDATE ai_management.report_form_templates
                     SET status = 'PUBLISHED', updated_at = NOW()
                     WHERE id = $1
                     RETURNING *`,
                    [templateId]
                );
                await client.query('COMMIT');
                return { version: versionResult.rows[0], template: templateResult.rows[0] };
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        },

        async findFormVersionById(versionId) {
            const result = await pool.query(
                'SELECT * FROM ai_management.report_form_versions WHERE id = $1',
                [versionId]
            );
            return result.rows[0] || null;
        },

        async findLatestFormVersion(templateId) {
            const result = await pool.query(
                `SELECT * FROM ai_management.report_form_versions
                 WHERE template_id = $1
                 ORDER BY version_no DESC LIMIT 1`,
                [templateId]
            );
            return result.rows[0] || null;
        },

        async listFormTemplatesByCreator(creatorId) {
            const result = await pool.query(
                `SELECT t.*, v.version_no, v.published_at,
                        (SELECT COUNT(*) FROM ai_management.report_form_assignments a
                         WHERE a.template_id = t.id) AS assignment_count
                 FROM ai_management.report_form_templates t
                 LEFT JOIN LATERAL (
                     SELECT version_no, published_at
                     FROM ai_management.report_form_versions
                     WHERE template_id = t.id
                     ORDER BY version_no DESC LIMIT 1
                 ) v ON true
                 WHERE t.created_by = $1
                 ORDER BY t.display_code`,
                [String(creatorId)]
            );
            return result.rows;
        },

        // ----- Gán form -----

        async createFormAssignments({ templateId, versionId, employees, dueAt, createdBy }) {
            const client = await pool.connect();
            const created = [];
            const skipped = [];
            try {
                await client.query('BEGIN');
                for (const employee of employees) {
                    const result = await client.query(
                        `INSERT INTO ai_management.report_form_assignments
                            (template_id, version_id, employee_id, employee_code_snapshot,
                             employee_name_snapshot, telegram_user_id_snapshot, due_at, created_by)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                         ON CONFLICT (template_id, telegram_user_id_snapshot) DO NOTHING
                         RETURNING *`,
                        [templateId, versionId, employee.employeeId, employee.employeeCode,
                            employee.employeeName, employee.telegramUserId, dueAt, String(createdBy)]
                    );
                    if (result.rows.length) created.push(result.rows[0]);
                    else skipped.push(employee.employeeCode);
                }
                await client.query('COMMIT');
                return { created, skipped };
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        },

        async findFormAssignmentById(assignmentId) {
            const result = await pool.query(
                `SELECT a.*, t.display_code, t.title, t.description, t.rubric,
                        t.created_by, t.status AS template_status,
                        v.fields, v.version_no
                 FROM ai_management.report_form_assignments a
                 JOIN ai_management.report_form_templates t ON t.id = a.template_id
                 JOIN ai_management.report_form_versions v ON v.id = a.version_id
                 WHERE a.id = $1`,
                [assignmentId]
            );
            return result.rows[0] || null;
        },

        async listFormAssignmentsByTemplate(templateId) {
            const result = await pool.query(
                `SELECT a.*, s.id AS submission_id, s.submitted_at, s.is_late,
                        s.evaluation_status
                 FROM ai_management.report_form_assignments a
                 LEFT JOIN ai_management.report_submissions s ON s.assignment_id = a.id
                 WHERE a.template_id = $1
                 ORDER BY a.id`,
                [templateId]
            );
            return result.rows;
        },

        async cancelOpenFormAssignments(templateId) {
            const result = await pool.query(
                `UPDATE ai_management.report_form_assignments
                 SET status = 'CANCELLED'
                 WHERE template_id = $1 AND status = 'OPEN'
                 RETURNING *`,
                [templateId]
            );
            return result.rows;
        },

        // ----- Quét cho cron nhắc form -----

        async findFormAssignmentsDueSoon(hoursWindow) {
            const result = await pool.query(
                `SELECT a.id, a.template_id, a.telegram_user_id_snapshot,
                        a.employee_name_snapshot, a.employee_code_snapshot,
                        a.last_reminded_on, a.created_by, t.display_code, t.title, a.due_at
                 FROM ai_management.report_form_assignments a
                 JOIN ai_management.report_form_templates t ON t.id = a.template_id
                 WHERE a.status = 'OPEN'
                   AND t.status = 'PUBLISHED'
                   AND a.due_at > NOW()
                   AND a.due_at <= NOW() + ($1 || ' hours')::interval
                   AND (a.last_reminded_on IS NULL OR a.last_reminded_on < CURRENT_DATE)`,
                [String(hoursWindow)]
            );
            return result.rows;
        },

        async findFormAssignmentsOverdue() {
            const result = await pool.query(
                `SELECT a.id, a.template_id, a.telegram_user_id_snapshot,
                        a.employee_name_snapshot, a.employee_code_snapshot,
                        a.last_reminded_on, a.overdue_manager_notified_at,
                        a.created_by, t.display_code, t.title, a.due_at
                 FROM ai_management.report_form_assignments a
                 JOIN ai_management.report_form_templates t ON t.id = a.template_id
                 WHERE a.status = 'OPEN'
                   AND t.status = 'PUBLISHED'
                   AND a.due_at < NOW()`,
                []
            );
            return result.rows;
        },

        async markFormReminded(assignmentId, today) {
            await pool.query(
                `UPDATE ai_management.report_form_assignments
                 SET last_reminded_on = $2
                 WHERE id = $1`,
                [assignmentId, today]
            );
        },

        async markFormOverdueManagerNotified(assignmentId) {
            await pool.query(
                `UPDATE ai_management.report_form_assignments
                 SET overdue_manager_notified_at = NOW()
                 WHERE id = $1`,
                [assignmentId]
            );
        },

        // ----- Bài nộp -----

        async createFormSubmission({ assignmentId, versionId, answers, isLate }) {
            const result = await pool.query(
                `INSERT INTO ai_management.report_submissions
                    (assignment_id, version_id, answers, is_late)
                 VALUES ($1, $2, $3::jsonb, $4)
                 RETURNING *`,
                [assignmentId, versionId, JSON.stringify(answers), isLate]
            );
            return result.rows[0];
        },

        async findFormSubmissionByAssignment(assignmentId) {
            const result = await pool.query(
                'SELECT * FROM ai_management.report_submissions WHERE assignment_id = $1',
                [assignmentId]
            );
            return result.rows[0] || null;
        },

        async markFormAssignmentSubmitted(assignmentId) {
            const result = await pool.query(
                `UPDATE ai_management.report_form_assignments
                 SET status = 'SUBMITTED'
                 WHERE id = $1 AND status = 'OPEN'
                 RETURNING *`,
                [assignmentId]
            );
            return result.rows[0] || null;
        },

        // Bài nộp kèm snapshot người nộp — nguồn cho tổng hợp
        async listFormSubmissionsByTemplate(templateId) {
            const result = await pool.query(
                `SELECT s.*, a.employee_code_snapshot, a.employee_name_snapshot,
                        a.telegram_user_id_snapshot, a.due_at
                 FROM ai_management.report_submissions s
                 JOIN ai_management.report_form_assignments a ON a.id = s.assignment_id
                 WHERE a.template_id = $1
                 ORDER BY s.id`,
                [templateId]
            );
            return result.rows;
        },

        async saveFormEvaluation(assignmentId, { evaluation, evaluatedBy }) {
            const result = await pool.query(
                `UPDATE ai_management.report_submissions
                 SET evaluation = $2::jsonb,
                     evaluation_status = 'EVALUATED',
                     evaluated_at = NOW(),
                     evaluated_by = $3
                 WHERE assignment_id = $1
                 RETURNING *`,
                [assignmentId, JSON.stringify(evaluation), String(evaluatedBy)]
            );
            return result.rows[0] || null;
        }
    };
}

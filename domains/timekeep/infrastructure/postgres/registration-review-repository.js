/** SQL phục vụ vòng đời và lịch sử đăng ký Telegram. */
export function createRegistrationReviewRepository({ pool }) {
    async function listRequests({ isSuperAdmin, allowedGroupIds, groupId, status = 'ALL' }) {
        const params = [];
        const filters = [];

        if (status !== 'ALL') {
            params.push(status);
            filters.push(`request.status = $${params.length}`);
        }
        if (groupId && groupId !== 'ALL') {
            params.push(String(groupId));
            filters.push(`request.telegram_group_id = $${params.length}`);
        }
        if (!isSuperAdmin) {
            params.push((allowedGroupIds || []).map(String));
            filters.push(`request.telegram_group_id = ANY($${params.length}::varchar[])`);
        }

        const result = await pool.query(
            `SELECT request.*,
                    suggested.full_name AS suggested_full_name,
                    suggested.role AS suggested_role,
                    suggested.group_id,
                    tg.group_name,
                    tg.bot_role,
                    target.full_name AS target_full_name,
                    target.role AS target_role,
                    COALESCE((
                        SELECT json_agg(json_build_object(
                            'id', candidate.id,
                            'full_name', candidate.full_name,
                            'role', candidate.role,
                            'employee_code', candidate.employee_code,
                            'is_suggested', candidate.id = request.suggested_employee_id
                        ) ORDER BY (candidate.id = request.suggested_employee_id) DESC, candidate.full_name ASC)
                        FROM employees candidate
                        WHERE request.status = 'PENDING'
                          AND candidate.group_id = suggested.group_id
                          AND (candidate.telegram_id IS NULL OR candidate.telegram_id = '')
                          AND (candidate.pending_telegram_id IS NULL
                               OR candidate.id = request.suggested_employee_id)
                    ), '[]'::json) AS candidates
             FROM employee_registration_requests request
             LEFT JOIN employees suggested ON suggested.id = request.suggested_employee_id
             LEFT JOIN employees target ON target.id = request.target_employee_id
             LEFT JOIN telegram_groups tg ON tg.telegram_group_id = request.telegram_group_id
             ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
             ORDER BY (request.status = 'PENDING') DESC, request.requested_at DESC
             LIMIT 100`,
            params
        );
        return result.rows;
    }

    async function lockPending(client, requestId) {
        const result = await client.query(
            `SELECT request.*,
                    suggested.group_id,
                    suggested.telegram_group_id AS suggested_telegram_group_id,
                    tg.bot_role,
                    tg.group_name
             FROM employee_registration_requests request
             LEFT JOIN employees suggested ON suggested.id = request.suggested_employee_id
             LEFT JOIN telegram_groups tg ON tg.telegram_group_id = request.telegram_group_id
             WHERE request.id = $1 AND request.status = 'PENDING'
             FOR UPDATE OF request`,
            [requestId]
        );
        return result.rows[0] || null;
    }

    async function lockTarget(client, employeeId) {
        const result = await client.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [employeeId]);
        return result.rows[0] || null;
    }

    async function findTelegramConflict(client, { telegramId, groupId, isKpiGroup, excludedIds }) {
        const excluded = excludedIds.filter(Boolean);
        const result = await client.query(
            isKpiGroup
                ? `SELECT id FROM employees
                   WHERE telegram_id = $1 AND NOT (id = ANY($2::uuid[]))
                   LIMIT 1`
                : `SELECT id FROM employees
                   WHERE group_id = $3 AND telegram_id = $1 AND NOT (id = ANY($2::uuid[]))
                   LIMIT 1`,
            isKpiGroup
                ? [String(telegramId), excluded]
                : [String(telegramId), excluded, groupId]
        );
        return result.rows[0] || null;
    }

    async function approveTarget(client, targetId, request, { isKpiGroup }) {
        const result = await client.query(
            `UPDATE employees
             SET telegram_id = $1,
                 telegram_username = $2,
                 role = COALESCE(NULLIF(role, ''), $3),
                 telegram_group_id = CASE WHEN $4 THEN NULL ELSE $5 END,
                 is_active = TRUE,
                 pending_telegram_id = NULL,
                 pending_telegram_username = NULL,
                 pending_role = NULL,
                 pending_telegram_group_id = NULL,
                 pending_requested_at = NULL,
                 pending_is_new_profile = FALSE
             WHERE id = $6
             RETURNING *`,
            [
                String(request.telegram_id),
                request.telegram_username || '',
                request.requested_role,
                isKpiGroup,
                request.telegram_group_id,
                targetId
            ]
        );
        return result.rows[0] || null;
    }

    async function clearOrDeleteSource(client, request, approvedTargetId = null) {
        if (String(request.suggested_employee_id) === String(approvedTargetId)) return;
        if (!request.suggested_employee_id) return;

        if (request.is_new_profile) {
            await client.query(
                'DELETE FROM employees WHERE id = $1 AND (telegram_id IS NULL OR telegram_id = \'\')',
                [request.suggested_employee_id]
            );
            return;
        }

        await client.query(
            `UPDATE employees
             SET pending_telegram_id = NULL,
                 pending_telegram_username = NULL,
                 pending_role = NULL,
                 pending_telegram_group_id = NULL,
                 pending_requested_at = NULL,
                 pending_is_new_profile = FALSE
             WHERE id = $1`,
            [request.suggested_employee_id]
        );
    }

    async function markActive(client, requestId, targetEmployeeId, reviewedBy) {
        await client.query(
            `UPDATE employee_registration_requests
             SET status = 'ACTIVE', target_employee_id = $1,
                 reviewed_at = NOW(), reviewed_by = $2,
                 rejection_reason = NULL, updated_at = NOW()
             WHERE id = $3 AND status = 'PENDING'`,
            [targetEmployeeId, reviewedBy, requestId]
        );
    }

    async function markRejected(client, requestId, reviewedBy, reason) {
        await client.query(
            `UPDATE employee_registration_requests
             SET status = 'REJECTED', reviewed_at = NOW(), reviewed_by = $1,
                 rejection_reason = $2, updated_at = NOW()
             WHERE id = $3 AND status = 'PENDING'`,
            [reviewedBy, reason, requestId]
        );
    }

    return {
        listRequests,
        lockPending,
        lockTarget,
        findTelegramConflict,
        approveTarget,
        clearOrDeleteSource,
        markActive,
        markRejected
    };
}

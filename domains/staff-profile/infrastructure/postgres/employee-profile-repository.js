export function createEmployeeProfileRepository({ pool }) {
    async function findEmployeeWithGroups({ employeeId, allowedGroupIds, selectedGroupId }) {
        const employeeResult = await pool.query(
            `SELECT id, full_name, employee_code, telegram_id, telegram_username, role,
                    department, position, is_active, is_exempt_checkin, created_at
             FROM employees WHERE id = $1`,
            [employeeId]
        );
        if (!employeeResult.rows[0]) return null;
        const primaryEmployee = employeeResult.rows[0];
        const linkedResult = primaryEmployee.telegram_id
            ? await pool.query(
                `SELECT id FROM employees WHERE telegram_id = $1 ORDER BY created_at, id`,
                [primaryEmployee.telegram_id]
            )
            : { rows: [{ id: employeeId }] };
        const employeeIds = linkedResult.rows.map(row => row.id);

        const groupsResult = await pool.query(
            `SELECT DISTINCT e.id AS employee_id,
                    CASE WHEN lower(trim(COALESCE(m.role, e.role))) = 'admin' THEN 'Admin' ELSE COALESCE(m.role, e.role) END AS role,
                    COALESCE(m.is_exempt_checkin, e.is_exempt_checkin, FALSE) AS is_exempt_checkin,
                    g.id AS group_uuid,
                    g.telegram_group_id, g.group_name, g.bot_role,
                    COALESCE(m.updated_at, e.created_at) AS effective_updated_at,
                    e.created_at AS employee_created_at,
                    COALESCE(m.status, 'ACTIVE') AS membership_status,
                    COALESCE(m.need_report, e.need_report, TRUE) AS need_report,
                    COALESCE(m.current_kpi_target, e.current_kpi_target, 0) AS current_kpi_target
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
             WHERE e.id = ANY($1::uuid[])
               AND ($2::text[] IS NULL OR g.telegram_group_id = ANY($2::text[]))
               AND ($3::text IS NULL OR g.telegram_group_id = $3)
               AND COALESCE(g.is_deleted, FALSE) = FALSE
             ORDER BY g.group_name, COALESCE(m.updated_at, e.created_at), e.created_at`,
            [employeeIds, allowedGroupIds, selectedGroupId]
        );
        if (groupsResult.rows.length === 0) return null;
        const groupsByTelegramId = new Map();
        for (const group of groupsResult.rows) groupsByTelegramId.set(group.telegram_group_id, group);
        const effectiveGroups = [...groupsByTelegramId.values()];
        return {
            ...primaryEmployee,
            employee_ids: employeeIds,
            roles: [...new Set(effectiveGroups.map(row => row.role).filter(Boolean))],
            groups: effectiveGroups
        };
    }

    async function findAttendanceRows({ employeeIds, groupUuids, fromDate, toDate }) {
        const common = [employeeIds, groupUuids, fromDate, toDate];
        const [schedules, checkins, leaves, penalties] = await Promise.all([
            pool.query(
                `SELECT s.id, s.date::text AS date, s.shift_type, s.is_locked,
                        g.telegram_group_id, g.group_name
                 FROM tk_schedules s JOIN telegram_groups g ON g.id = s.group_id
                 WHERE s.user_id = ANY($1::uuid[]) AND s.group_id = ANY($2::uuid[])
                   AND s.date BETWEEN $3::date AND $4::date
                 ORDER BY s.date, g.group_name`, common
            ),
            pool.query(
                `SELECT c.id, c.date::text AS date, c.check_in_time, c.status,
                        c.admin_note, c.video_file_id, g.telegram_group_id, g.group_name
                 FROM tk_check_ins c JOIN telegram_groups g ON g.id = c.group_id
                 WHERE c.user_id = ANY($1::uuid[]) AND c.group_id = ANY($2::uuid[])
                   AND c.date BETWEEN $3::date AND $4::date
                 ORDER BY c.date, c.check_in_time`, common
            ),
            pool.query(
                `SELECT r.id, r.date::text AS date, r.request_type, r.status, r.reason,
                        r.approved_by, g.telegram_group_id, g.group_name
                 FROM tk_leave_requests r JOIN telegram_groups g ON g.id = r.group_id
                 WHERE r.user_id = ANY($1::uuid[]) AND r.group_id = ANY($2::uuid[])
                   AND r.date BETWEEN $3::date AND $4::date
                 ORDER BY r.date`, common
            ),
            pool.query(
                `SELECT p.id, p.date::text AS date, p.violation_type, p.late_minutes,
                        p.amount, p.reason, p.is_paid, g.telegram_group_id, g.group_name
                 FROM tk_penalties p JOIN telegram_groups g ON g.id = p.group_id
                 WHERE p.user_id = ANY($1::uuid[]) AND p.group_id = ANY($2::uuid[])
                   AND p.date BETWEEN $3::date AND $4::date
                 ORDER BY p.date`, common
            )
        ]);
        return {
            schedules: schedules.rows,
            checkins: checkins.rows,
            leaves: leaves.rows,
            penalties: penalties.rows
        };
    }

    async function findLatestKpiReports({ employeeIds, telegramGroupIds, fromDate, toDate }) {
        if (telegramGroupIds.length === 0) return [];
        const result = await pool.query(
            `SELECT DISTINCT ON (report_date, telegram_group_id)
                    id, report_date::text, telegram_group_id, raw_text, kpi_required,
                    kpi_actual, kpi_missing, completion_rate, status, submitted_at, metadata
             FROM daily_reports
             WHERE employee_id = ANY($1::uuid[])
               AND telegram_group_id = ANY($2::text[])
               AND report_date BETWEEN $3::date AND $4::date
             ORDER BY report_date, telegram_group_id, submitted_at DESC NULLS LAST, id DESC`,
            [employeeIds, telegramGroupIds, fromDate, toDate]
        );
        return result.rows;
    }

    return { findEmployeeWithGroups, findAttendanceRows, findLatestKpiReports };
}

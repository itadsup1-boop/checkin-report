export const KPI_GROUP_ROLES = ['report', 'report_tour'];

export function applyMembershipToEmployee(row) {
    if (!row) return null;
    return {
        ...row,
        need_report: row.membership_need_report ?? row.need_report ?? true,
        current_kpi_target: row.membership_kpi_target ?? row.current_kpi_target ?? 0,
        membership_status: row.membership_status || null
    };
}

export async function getEmployeeMembership(db, telegramId, telegramGroupId, options = {}) {
    const { activeOnly = false } = options;
    const result = await db.query(
        `SELECT e.*,
                m.status AS membership_status,
                m.need_report AS membership_need_report,
                m.current_kpi_target AS membership_kpi_target,
                m.pause_reason AS membership_pause_reason,
                m.paused_at AS membership_paused_at
         FROM public.employees e
         JOIN public.employee_group_memberships m ON m.employee_id = e.id
         WHERE e.telegram_id = $1
           AND m.telegram_group_id = $2
           AND COALESCE(e.is_active, TRUE) = TRUE
           ${activeOnly ? "AND m.status = 'ACTIVE'" : ''}
         LIMIT 1`,
        [String(telegramId), String(telegramGroupId)]
    );
    return applyMembershipToEmployee(result.rows[0] || null);
}

export async function getEmployeeMembershipById(db, employeeId, telegramGroupId) {
    const result = await db.query(
        `SELECT e.*,
                m.status AS membership_status,
                m.need_report AS membership_need_report,
                m.current_kpi_target AS membership_kpi_target,
                m.pause_reason AS membership_pause_reason,
                m.paused_at AS membership_paused_at
         FROM public.employees e
         LEFT JOIN public.employee_group_memberships m
           ON m.employee_id = e.id AND m.telegram_group_id = $2
         WHERE e.id = $1
         LIMIT 1`,
        [employeeId, String(telegramGroupId)]
    );
    return applyMembershipToEmployee(result.rows[0] || null);
}

export async function pauseEmployeeMembershipsInAllGroups(
    db,
    employee,
    actor = 'admin:global_disable',
    reason = 'Vô hiệu hóa tài khoản toàn hệ thống'
) {
    await db.query(
        `UPDATE public.employees
            SET is_active = FALSE
          WHERE id = $1
             OR ($2::varchar IS NOT NULL AND telegram_id = $2)`,
        [employee.id, employee.telegram_id ? String(employee.telegram_id) : null]
    );

    const paused = await db.query(
        `WITH identity_employees AS (
             SELECT id
               FROM public.employees
              WHERE id = $1
                 OR ($4::varchar IS NOT NULL AND telegram_id = $4)
         ), changed AS (
             UPDATE public.employee_group_memberships AS membership
                SET status = 'PAUSED',
                    pause_reason = $2,
                    paused_at = NOW(),
                    updated_by = $3,
                    updated_at = NOW()
               FROM identity_employees
              WHERE membership.employee_id = identity_employees.id
                AND membership.status <> 'PAUSED'
              RETURNING membership.employee_id, membership.telegram_group_id
         )
         INSERT INTO public.employee_group_membership_events
             (employee_id, telegram_group_id, old_status, new_status, reason, actor)
         SELECT employee_id, telegram_group_id, 'ACTIVE', 'PAUSED', $2, $3
           FROM changed
         RETURNING telegram_group_id`,
        [employee.id, reason, actor, employee.telegram_id ? String(employee.telegram_id) : null]
    );

    if (employee.telegram_id) {
        await db.query(
            'DELETE FROM public.pending_reports WHERE telegram_id = $1',
            [String(employee.telegram_id)]
        );
    }
    return paused.rows.map(row => String(row.telegram_group_id));
}

export async function registerEmployeeInKpiGroup(db, employee, telegramGroupId, actor = 'telegram_setup') {
    const groupResult = await db.query(
        `SELECT g.telegram_group_id,
                g.bot_role,
                COALESCE((
                    SELECT gs.default_kpi
                    FROM public.group_settings gs
                    WHERE gs.telegram_group_id = g.telegram_group_id
                    LIMIT 1
                ), 40) AS default_kpi
         FROM public.telegram_groups g
         WHERE g.telegram_group_id = $1
           AND g.is_active = TRUE
           AND COALESCE(g.is_deleted, FALSE) = FALSE
         LIMIT 1`,
        [String(telegramGroupId)]
    );
    const group = groupResult.rows[0];
    if (!group || !KPI_GROUP_ROLES.includes(group.bot_role)) {
        return { ok: false, reason: 'NOT_KPI_GROUP' };
    }

    const existing = await db.query(
        `SELECT status, need_report, current_kpi_target
         FROM public.employee_group_memberships
         WHERE employee_id = $1 AND telegram_group_id = $2
         FOR UPDATE`,
        [employee.id, String(telegramGroupId)]
    );

    // Nếu tài khoản từng bị vô hiệu hóa toàn cục, giữ tất cả nhóm cũ ở PAUSED.
    // Chỉ membership của nhóm đang đăng ký bên dưới mới được bật lại.
    if (employee.is_active === false) {
        await pauseEmployeeMembershipsInAllGroups(
            db,
            employee,
            actor,
            'Chờ nhân sự đăng ký lại từng nhóm'
        );
    }

    if (existing.rows.length > 0) {
        await db.query(
            `UPDATE public.employee_group_memberships
             SET status = 'ACTIVE', pause_reason = NULL, resumed_at = NOW(),
                 last_registered_at = NOW(), updated_at = NOW(), updated_by = $3
             WHERE employee_id = $1 AND telegram_group_id = $2`,
            [employee.id, String(telegramGroupId), actor]
        );
        if (existing.rows[0].status === 'PAUSED' || employee.is_active === false) {
            await db.query(
                `INSERT INTO public.employee_group_membership_events
                    (employee_id, telegram_group_id, old_status, new_status, reason, actor)
                 VALUES ($1, $2, 'PAUSED', 'ACTIVE', 'Nhân sự đăng ký lại trong nhóm', $3)`,
                [employee.id, String(telegramGroupId), actor]
            );
        }
    } else {
        await db.query(
            `INSERT INTO public.employee_group_memberships
                (employee_id, telegram_group_id, status, need_report,
                 current_kpi_target, last_registered_at, updated_by)
             VALUES ($1, $2, 'ACTIVE', TRUE, $3, NOW(), $4)`,
            [
                employee.id,
                String(telegramGroupId),
                Number(group.default_kpi) > 0 ? Number(group.default_kpi) : 40,
                actor
            ]
        );
    }

    // Trường legacy chỉ là nhóm được dùng gần nhất. Trạng thái từng nhóm luôn
    // lấy từ employee_group_memberships, nên cập nhật này không kích hoạt nhóm cũ.
    await db.query(
        `UPDATE public.employees
            SET telegram_group_id = $2, is_active = TRUE
          WHERE id = $1`,
        [employee.id, String(telegramGroupId)]
    );

    const membership = await getEmployeeMembershipById(db, employee.id, telegramGroupId);
    return { ok: true, membership };
}

export async function ensureLegacyKpiMembership(db, employee, telegramGroupId) {
    if (!employee || !telegramGroupId) return null;
    await db.query(
        `INSERT INTO public.employee_group_memberships
            (employee_id, telegram_group_id, status, need_report, current_kpi_target, updated_by)
         SELECT $1, $2, 'ACTIVE', COALESCE($3, TRUE), COALESCE($4, 0), 'legacy_fallback'
         WHERE EXISTS (
             SELECT 1 FROM public.telegram_groups
             WHERE telegram_group_id = $2 AND bot_role IN ('report', 'report_tour')
         )
         ON CONFLICT (employee_id, telegram_group_id) DO NOTHING`,
        [employee.id, String(telegramGroupId), employee.need_report, employee.current_kpi_target]
    );
    return getEmployeeMembershipById(db, employee.id, telegramGroupId);
}

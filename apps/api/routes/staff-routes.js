export function registerStaffRoutes({
    app,
    pool,
    getAdminAuthContext,
    pausableGroupRoles,
    normalizeStaffRole,
    pauseEmployeeMembershipsInAllGroups,
    registerEmployeeInKpiGroup
}) {
    app.get('/api/admin/tk-users', async (req, res) => {
        try {
            const { isSuperAdmin, allowedGroupIds } = await getAdminAuthContext(req);
            const { group_id, bot_role } = req.query;
            const params = [];
            const hasSelectedGroup = group_id && group_id !== 'ALL';
            let query;
            let groupAlias;
    
            if (hasSelectedGroup) {
                if (!isSuperAdmin && !allowedGroupIds.includes(group_id)) {
                    return res.status(403).json({ error: 'Bạn không có quyền xem nhân sự nhóm này' });
                }
                params.push(group_id);
                groupAlias = 'selected_group';
                query = `
                    SELECT u.*,
                           selected_group.group_name,
                           selected_group.telegram_group_id AS selected_telegram_group_id,
                           selected_group.bot_role AS selected_group_role,
                           m.status AS membership_status,
                           m.pause_reason AS membership_pause_reason,
                           m.paused_at AS membership_paused_at,
                           COALESCE(m.role, u.role) AS group_role,
                           COALESCE(m.is_exempt_checkin, u.is_exempt_checkin, FALSE) AS group_is_exempt_checkin,
                           COALESCE(m.need_report, u.need_report, TRUE) AS group_need_report,
                           COALESCE(m.current_kpi_target, u.current_kpi_target, 0) AS group_kpi_target
                    FROM employees u
                    JOIN telegram_groups selected_group
                      ON selected_group.telegram_group_id = $1
                    LEFT JOIN employee_group_memberships m
                      ON m.employee_id = u.id
                     AND m.telegram_group_id = selected_group.telegram_group_id
                    WHERE (u.telegram_group_id = selected_group.telegram_group_id OR m.employee_id IS NOT NULL)
                `;
            } else if (!isSuperAdmin) {
                params.push(allowedGroupIds);
                groupAlias = 'g';
                query = `
                    SELECT u.*, g.group_name,
                           g.telegram_group_id AS selected_telegram_group_id,
                           g.bot_role AS selected_group_role,
                           m.status AS membership_status,
                           m.pause_reason AS membership_pause_reason,
                           m.paused_at AS membership_paused_at,
                           COALESCE(m.role, u.role) AS group_role,
                           COALESCE(m.is_exempt_checkin, u.is_exempt_checkin, FALSE) AS group_is_exempt_checkin,
                           COALESCE(m.need_report, u.need_report, TRUE) AS group_need_report,
                           COALESCE(m.current_kpi_target, u.current_kpi_target, 0) AS group_kpi_target
                    FROM employees u
                    JOIN telegram_groups g ON (
                        g.telegram_group_id = u.telegram_group_id OR EXISTS (
                            SELECT 1 FROM employee_group_memberships linked_membership
                            WHERE linked_membership.employee_id = u.id
                              AND linked_membership.telegram_group_id = g.telegram_group_id
                        )
                    )
                    LEFT JOIN employee_group_memberships m
                      ON m.employee_id = u.id AND m.telegram_group_id = g.telegram_group_id
                    WHERE g.telegram_group_id = ANY($1)
                `;
            } else {
                groupAlias = 'g';
                query = `
                    SELECT u.*, g.group_name,
                           g.telegram_group_id AS selected_telegram_group_id,
                           g.bot_role AS selected_group_role,
                           m.status AS membership_status,
                           m.pause_reason AS membership_pause_reason,
                           m.paused_at AS membership_paused_at,
                           COALESCE(m.role, u.role) AS group_role,
                           COALESCE(m.is_exempt_checkin, u.is_exempt_checkin, FALSE) AS group_is_exempt_checkin,
                           COALESCE(m.need_report, u.need_report, TRUE) AS group_need_report,
                           COALESCE(m.current_kpi_target, u.current_kpi_target, 0) AS group_kpi_target
                    FROM employees u
                    LEFT JOIN telegram_groups g ON (
                        g.telegram_group_id = u.telegram_group_id OR EXISTS (
                            SELECT 1 FROM employee_group_memberships linked_membership
                            WHERE linked_membership.employee_id = u.id
                              AND linked_membership.telegram_group_id = g.telegram_group_id
                        )
                    )
                    LEFT JOIN employee_group_memberships m
                      ON m.employee_id = u.id AND m.telegram_group_id = g.telegram_group_id
                    WHERE 1 = 1
                `;
            }
    
            if (bot_role) {
                params.push(bot_role);
                query += ` AND ${groupAlias}.bot_role = $${params.length}`;
            }
    
            query += ` ORDER BY u.created_at DESC`;
    
            const result = await pool.query(query, params);
            res.json(result.rows);
        } catch (error) {
            console.error('[API ERROR tk-users]:', error);
            res.status(500).json({ error: error.message });
        }
    });
    
    app.put('/api/admin/tk-users/:id', async (req, res) => {
        try {
            const { isSuperAdmin, allowedGroupIds } = await getAdminAuthContext(req);
    
            // 1. Kiểm tra tồn tại nhân viên
            const empRes = await pool.query(`SELECT * FROM employees WHERE id = $1`, [req.params.id]);
            if (empRes.rows.length === 0) {
                return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
            }
            const currentEmp = empRes.rows[0];
    
            const { full_name, role, leave_quota, is_exempt_checkin, is_active, need_report, telegram_group_id } = req.body;
            const targetGroupId = telegram_group_id || currentEmp.telegram_group_id;
    
            // 2. Kiểm tra quyền quản lý đúng nhóm đang chỉnh sửa membership
            if (!isSuperAdmin && (!targetGroupId || !allowedGroupIds.includes(targetGroupId))) {
                return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa nhân sự nhóm này' });
            }
    
            const groupResult = targetGroupId
                ? await pool.query('SELECT bot_role FROM telegram_groups WHERE telegram_group_id = $1 LIMIT 1', [targetGroupId])
                : { rows: [] };
            const isKpiGroup = KPI_GROUP_ROLES.includes(groupResult.rows[0]?.bot_role);
    
            const membershipResult = isKpiGroup
                ? await pool.query(
                    `SELECT status, need_report, current_kpi_target
                     FROM employee_group_memberships
                     WHERE employee_id = $1 AND telegram_group_id = $2`,
                    [currentEmp.id, targetGroupId]
                )
                : { rows: [] };
            const membership = membershipResult.rows[0];
    
            // Giữ nguyên is_active hiện tại nếu body không truyền
            const newIsActive = is_active !== undefined ? !!is_active : (currentEmp.is_active !== false);
            const newNeedReport = need_report !== undefined
                ? !!need_report
                : (membership ? membership.need_report : currentEmp.need_report !== false);
    
            await pool.query(
                `UPDATE employees
                 SET full_name = $1, role = $2, leave_quota = $3,
                     is_exempt_checkin = $4, is_active = $5,
                     need_report = CASE WHEN $6 THEN need_report ELSE $7 END
                 WHERE id = $8`,
                [
                    full_name !== undefined ? full_name : currentEmp.full_name,
                    role !== undefined ? normalizeStaffRole(role) : currentEmp.role,
                    leave_quota !== undefined ? leave_quota : (currentEmp.leave_quota || 12),
                    is_exempt_checkin !== undefined ? !!is_exempt_checkin : !!currentEmp.is_exempt_checkin,
                    newIsActive,
                    isKpiGroup,
                    newNeedReport,
                    req.params.id
                ]
            );
    
            if (isKpiGroup) {
                await pool.query(
                    `INSERT INTO employee_group_memberships
                        (employee_id, telegram_group_id, status, need_report,
                         current_kpi_target, updated_by, updated_at)
                     VALUES ($1, $2, 'ACTIVE', $3, $4, $5, NOW())
                     ON CONFLICT (employee_id, telegram_group_id) DO UPDATE SET
                        need_report = EXCLUDED.need_report,
                        updated_by = EXCLUDED.updated_by,
                        updated_at = NOW()`,
                    [
                        currentEmp.id,
                        targetGroupId,
                        newNeedReport,
                        membership?.current_kpi_target ?? currentEmp.current_kpi_target ?? 0,
                        `admin:${req.admin.id}`
                    ]
                );
            }
    
            // Vô hiệu hóa tài khoản là toàn cục: dừng ở tất cả nhóm. Khi nhân sự
            // đăng ký lại, helper đăng ký chỉ bật đúng membership của nhóm mới.
            if (!newIsActive) {
                await pauseEmployeeMembershipsInAllGroups(
                    pool,
                    currentEmp,
                    `admin:${req.admin.id}`
                );
            } else if (isKpiGroup && !newNeedReport && currentEmp.telegram_id) {
                await pool.query(
                    `DELETE FROM pending_reports WHERE telegram_id = $1 AND group_id = $2`,
                    [currentEmp.telegram_id.toString(), targetGroupId]
                );
            }
    
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    app.put('/api/admin/tk-users/:id/group-settings', async (req, res) => {
        try {
            const { isSuperAdmin, allowedGroupIds } = await getAdminAuthContext(req);
            const groupId = String(req.body.telegram_group_id || '');
            if (!groupId) return res.status(400).json({ error: 'Thiếu nhóm cần cấu hình' });
            if (!isSuperAdmin && !allowedGroupIds.includes(groupId)) {
                return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa nhân sự nhóm này' });
            }
    
            const employeeResult = await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id]);
            const employee = employeeResult.rows[0];
            if (!employee) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    
            const groupResult = await pool.query(
                `SELECT bot_role FROM telegram_groups
                 WHERE telegram_group_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE`,
                [groupId]
            );
            if (!groupResult.rows[0]) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
    
            const belongsResult = await pool.query(
                `SELECT 1 FROM employee_group_memberships WHERE employee_id = $1 AND telegram_group_id = $2
                 UNION ALL
                 SELECT 1 FROM employees WHERE id = $1 AND telegram_group_id = $2
                 LIMIT 1`,
                [employee.id, groupId]
            );
            if (!belongsResult.rows[0]) return res.status(404).json({ error: 'Nhân viên chưa thuộc nhóm này' });
    
            const role = normalizeStaffRole(req.body.role ?? employee.role).slice(0, 100);
            const isExemptCheckin = req.body.is_exempt_checkin !== undefined
                ? Boolean(req.body.is_exempt_checkin)
                : Boolean(employee.is_exempt_checkin);
            const needReport = req.body.need_report !== undefined
                ? Boolean(req.body.need_report)
                : employee.need_report !== false;
            const kpiTarget = Math.max(0, Number(req.body.current_kpi_target ?? employee.current_kpi_target ?? 0));
    
            await pool.query(
                `INSERT INTO employee_group_memberships
                    (employee_id, telegram_group_id, status, role, is_exempt_checkin,
                     need_report, current_kpi_target, updated_by, updated_at)
                 VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6, $7, NOW())
                 ON CONFLICT (employee_id, telegram_group_id) DO UPDATE SET
                    role = EXCLUDED.role,
                    is_exempt_checkin = EXCLUDED.is_exempt_checkin,
                    need_report = EXCLUDED.need_report,
                    current_kpi_target = EXCLUDED.current_kpi_target,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = NOW()`,
                [employee.id, groupId, role, isExemptCheckin, needReport, kpiTarget, `admin:${req.admin.id}`]
            );
    
            if (String(employee.telegram_group_id || '') === groupId) {
                await pool.query(
                    `UPDATE employees SET role = $1, is_exempt_checkin = $2,
                        need_report = $3, current_kpi_target = $4 WHERE id = $5`,
                    [role, isExemptCheckin, needReport, kpiTarget, employee.id]
                );
            }
            if (!needReport && employee.telegram_id) {
                await pool.query('DELETE FROM pending_reports WHERE telegram_id = $1 AND group_id = $2', [String(employee.telegram_id), groupId]);
            }
            return res.json({ success: true });
        } catch (error) {
            console.error('[API Group Settings]', error);
            return res.status(500).json({ error: error.message });
        }
    });
    
    // Tạm dừng/kích hoạt hoạt động theo đúng một nhóm, không thay đổi tài khoản toàn cục.
    app.put('/api/admin/tk-users/:id/group-membership', async (req, res) => {
        const client = await pool.connect();
        try {
            const { isSuperAdmin, allowedGroupIds } = await getAdminAuthContext(req);
            const { telegram_group_id, status, pause_reason } = req.body;
            const normalizedStatus = String(status || '').toUpperCase();
    
            if (!telegram_group_id || !['ACTIVE', 'PAUSED'].includes(normalizedStatus)) {
                return res.status(400).json({ error: 'Thiếu nhóm hoặc trạng thái membership không hợp lệ' });
            }
            if (!isSuperAdmin && !allowedGroupIds.includes(String(telegram_group_id))) {
                return res.status(403).json({ error: 'Bạn không có quyền thay đổi nhân sự nhóm này' });
            }
    
            await client.query('BEGIN');
            const employeeResult = await client.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [req.params.id]);
            if (employeeResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
            }
            const employee = employeeResult.rows[0];
    
            const groupResult = await client.query(
                `SELECT bot_role FROM telegram_groups
                 WHERE telegram_group_id = $1 AND is_active = TRUE
                   AND COALESCE(is_deleted, FALSE) = FALSE
                 LIMIT 1`,
                [String(telegram_group_id)]
            );
            if (!pausableGroupRoles.includes(groupResult.rows[0]?.bot_role)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Nhóm này chưa hỗ trợ tạm dừng nhân sự theo nhóm' });
            }
    
            const existingResult = await client.query(
                `SELECT status, need_report, current_kpi_target
                 FROM employee_group_memberships
                 WHERE employee_id = $1 AND telegram_group_id = $2
                 FOR UPDATE`,
                [employee.id, String(telegram_group_id)]
            );
            const existing = existingResult.rows[0];
            if (!existing && String(employee.telegram_group_id || '') !== String(telegram_group_id)) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Nhân viên chưa đăng ký trong nhóm này' });
            }
    
            const actor = `admin:${req.admin.id}`;
            await client.query(
                `INSERT INTO employee_group_memberships
                    (employee_id, telegram_group_id, status, need_report,
                     current_kpi_target, pause_reason, paused_at, resumed_at,
                     updated_by, updated_at)
                 VALUES ($1, $2, $3::varchar(20), $4, $5,
                         CASE WHEN $3::varchar(20) = 'PAUSED' THEN $6 ELSE NULL END,
                         CASE WHEN $3::varchar(20) = 'PAUSED' THEN NOW() ELSE NULL END,
                         CASE WHEN $3::varchar(20) = 'ACTIVE' THEN NOW() ELSE NULL END,
                         $7, NOW())
                 ON CONFLICT (employee_id, telegram_group_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    pause_reason = EXCLUDED.pause_reason,
                    paused_at = CASE WHEN EXCLUDED.status = 'PAUSED' THEN NOW() ELSE employee_group_memberships.paused_at END,
                    resumed_at = CASE WHEN EXCLUDED.status = 'ACTIVE' THEN NOW() ELSE employee_group_memberships.resumed_at END,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = NOW()`,
                [
                    employee.id,
                    String(telegram_group_id),
                    normalizedStatus,
                    existing?.need_report ?? employee.need_report ?? true,
                    existing?.current_kpi_target ?? employee.current_kpi_target ?? 0,
                    normalizedStatus === 'PAUSED' ? (String(pause_reason || '').trim() || 'Tạm dừng bởi Admin') : null,
                    actor
                ]
            );
    
            if (existing?.status !== normalizedStatus) {
                await client.query(
                    `INSERT INTO employee_group_membership_events
                        (employee_id, telegram_group_id, old_status, new_status, reason, actor)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [employee.id, String(telegram_group_id), existing?.status || null, normalizedStatus, pause_reason || null, actor]
                );
            }
    
            if (normalizedStatus === 'PAUSED' && employee.telegram_id) {
                await client.query(
                    `DELETE FROM pending_reports WHERE telegram_id = $1 AND group_id = $2`,
                    [String(employee.telegram_id), String(telegram_group_id)]
                );
            }
    
            await client.query('COMMIT');
            res.json({
                success: true,
                membership_status: normalizedStatus,
                message: normalizedStatus === 'PAUSED'
                    ? 'Đã tạm dừng hoạt động của nhân viên trong nhóm này.'
                    : 'Đã kích hoạt lại hoạt động của nhân viên trong nhóm này.'
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            res.status(500).json({ error: error.message });
        } finally {
            client.release();
        }
    });
}

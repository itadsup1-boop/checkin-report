/**
 * Quyền kho theo từng nhóm và cờ bật đơn dịch vụ.
 *
 * Cắt nguyên văn từ apps/api/src/modules/warehouse-admin/index.js (777 dòng),
 * không đổi một dòng logic nào.
 */

import { sendError } from '../admin-context.js';
import { WarehouseError, WAREHOUSE_PERMISSIONS } from '../../../domain/constants.js';

export function registerPermissionRoutes({ app, pool, getContext, requireWarehouseGroup }) {
    app.get('/api/admin/warehouse/groups/:groupId/permissions', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const result = await pool.query(
                `SELECT e.id, e.full_name, e.telegram_id, e.role, e.is_active,
                        COALESCE(
                            ARRAY_AGG(wp.permission_code ORDER BY wp.permission_code)
                                FILTER (WHERE wp.is_active = TRUE),
                            '{}'
                        ) AS permissions
                 FROM employees e
                 LEFT JOIN tk_warehouse_permissions wp
                   ON wp.employee_id = e.id
                  AND wp.telegram_group_id = $1
                 LEFT JOIN employee_group_memberships gm
                   ON gm.employee_id = e.id
                  AND gm.telegram_group_id = $1
                  AND gm.status = 'ACTIVE'
                 WHERE e.telegram_group_id = $1
                    OR gm.employee_id IS NOT NULL
                    OR wp.employee_id IS NOT NULL
                 GROUP BY e.id
                 ORDER BY e.full_name`,
                [group.telegram_group_id]
            );
            res.json({
                success: true,
                warehouse_service_order_enabled: group.warehouse_service_order_enabled === true,
                permission_codes: WAREHOUSE_PERMISSIONS,
                employees: result.rows
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.put('/api/admin/warehouse/groups/:groupId/permissions/:employeeId', async (req, res) => {
        const client = await pool.connect();
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const permissions = [...new Set(
                (Array.isArray(req.body.permissions) ? req.body.permissions : []).map(String)
            )];
            if (permissions.some(code => !WAREHOUSE_PERMISSIONS.includes(code))) {
                throw new WarehouseError('Có mã quyền kho không hợp lệ.');
            }

            await client.query('BEGIN');
            const employee = await client.query(
                'SELECT id FROM employees WHERE id = $1 AND is_active = TRUE FOR UPDATE',
                [req.params.employeeId]
            );
            if (!employee.rows[0]) throw new WarehouseError('Không tìm thấy nhân viên.', { status: 404 });
            const existingResult = await client.query(
                `SELECT permission_code, is_active
                 FROM tk_warehouse_permissions
                 WHERE employee_id = $1 AND telegram_group_id = $2`,
                [req.params.employeeId, group.telegram_group_id]
            );
            const existing = new Map(existingResult.rows.map(row => [row.permission_code, row.is_active]));

            for (const code of WAREHOUSE_PERMISSIONS) {
                const nextActive = permissions.includes(code);
                const oldActive = existing.get(code) ?? null;
                if (oldActive === nextActive) continue;
                await client.query(
                    `INSERT INTO tk_warehouse_permissions
                        (employee_id, telegram_group_id, permission_code,
                         is_active, granted_by_admin_id, granted_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                     ON CONFLICT (employee_id, telegram_group_id, permission_code) DO UPDATE SET
                        is_active = EXCLUDED.is_active,
                        granted_by_admin_id = EXCLUDED.granted_by_admin_id,
                        granted_at = NOW(),
                        updated_at = NOW()`,
                    [req.params.employeeId, group.telegram_group_id, code, nextActive, context.adminId]
                );
                await client.query(
                    `INSERT INTO tk_warehouse_permission_audit
                        (employee_id, telegram_group_id, permission_code,
                         old_is_active, new_is_active, actor_admin_id)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        req.params.employeeId,
                        group.telegram_group_id,
                        code,
                        oldActive,
                        nextActive,
                        context.adminId
                    ]
                );
            }
            await client.query('COMMIT');
            res.json({ success: true, permissions });
        } catch (error) {
            await client.query('ROLLBACK');
            sendError(res, error);
        } finally {
            client.release();
        }
    });

    app.get('/api/admin/warehouse/groups/:groupId/permission-audit', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const result = await pool.query(
                `SELECT a.*, e.full_name
                 FROM tk_warehouse_permission_audit a
                 JOIN employees e ON e.id = a.employee_id
                 WHERE a.telegram_group_id = $1
                 ORDER BY a.created_at DESC
                 LIMIT 200`,
                [group.telegram_group_id]
            );
            res.json({ success: true, audit: result.rows });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.put('/api/admin/warehouse/groups/:groupId/feature-flag', async (req, res) => {
        try {
            const context = await getContext(req);
            const group = await requireWarehouseGroup(context, req.params.groupId);
            const enabled = req.body.enabled === true;
            await pool.query(
                `UPDATE telegram_groups
                 SET warehouse_service_order_enabled = $2
                 WHERE telegram_group_id = $1`,
                [group.telegram_group_id, enabled]
            );
            res.json({ success: true, enabled, group_id: group.telegram_group_id });
        } catch (error) {
            sendError(res, error);
        }
    });
}

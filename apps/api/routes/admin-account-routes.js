import { hashAdminPassword, validateAdminPassword } from '../../../packages/shared/admin-auth-crypto.js';
import { isValidAdminRole, validateAssignedGroupsForRole } from '../admin-account-policy.js';

export function registerAdminAccountRoutes({ app, pool, adminAuth }) {
    app.get('/api/admin/accounts', adminAuth.requireSuperAdmin, async (req, res) => {
        try {
            const adminsRes = await pool.query(`
                SELECT a.id, a.username, a.full_name, a.role, a.is_active, a.created_at,
                       COALESCE(ARRAY_AGG(m.telegram_group_id) FILTER (WHERE m.telegram_group_id IS NOT NULL), '{}') as assigned_groups
                FROM admin_accounts a
                LEFT JOIN admin_group_mappings m ON a.id = m.admin_id
                GROUP BY a.id
                ORDER BY a.created_at ASC
            `);
            res.json(adminsRes.rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    app.post('/api/admin/accounts', adminAuth.requireSuperAdmin, async (req, res) => {
        try {
            const { username, password, full_name, role, assigned_groups } = req.body;
            if (!username || !password) {
                return res.status(400).json({ success: false, message: 'Tên đăng nhập và mật khẩu là bắt buộc' });
            }
            if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
                return res.status(400).json({ success: false, message: 'Tên đăng nhập chỉ gồm chữ, số, dấu chấm, gạch ngang hoặc gạch dưới.' });
            }
            const normalizedRole = role || 'ADMIN';
            if (!isValidAdminRole(normalizedRole)) {
                return res.status(400).json({ success: false, message: 'Vai trò Admin không hợp lệ.' });
            }
            const passwordCheck = validateAdminPassword(password, username);
            if (!passwordCheck.ok) {
                return res.status(400).json({ success: false, message: passwordCheck.message });
            }
            const validatedGroups = await validateAssignedGroupsForRole({
                pool,
                role: normalizedRole,
                assignedGroups: assigned_groups
            });
    
            const existing = await pool.query('SELECT id FROM admin_accounts WHERE username = $1', [username]);
            if (existing.rows.length > 0) {
                return res.status(400).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
            }
    
            const newAdmin = await pool.query(
                `INSERT INTO admin_accounts (username, password_hash, full_name, role)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, username, full_name, role, is_active, created_at`,
                [username, await hashAdminPassword(password), full_name || username, normalizedRole]
            );
    
            const adminId = newAdmin.rows[0].id;
            if (validatedGroups.length > 0) {
                for (const gId of validatedGroups) {
                    await pool.query(
                        `INSERT INTO admin_group_mappings (admin_id, telegram_group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                        [adminId, gId]
                    );
                }
            }
    
            res.json({ success: true, data: newAdmin.rows[0] });
        } catch (error) {
            res.status(error.status || 500).json({ success: false, message: error.message });
        }
    });
    
    app.put('/api/admin/accounts/:id', adminAuth.requireSuperAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { password, full_name, role, is_active, assigned_groups } = req.body;
    
            if (!isValidAdminRole(role)) {
                return res.status(400).json({ success: false, message: 'Vai trò Admin không hợp lệ.' });
            }
            const currentResult = await pool.query('SELECT id, username, role, is_active FROM admin_accounts WHERE id = $1', [id]);
            const current = currentResult.rows[0];
            if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản Admin.' });
            const validatedGroups = await validateAssignedGroupsForRole({
                pool,
                role,
                assignedGroups: assigned_groups
            });
            if (current.role === 'SUPER_ADMIN' && (role !== 'SUPER_ADMIN' || is_active === false)) {
                const count = await pool.query(
                    `SELECT COUNT(*)::int AS total FROM admin_accounts
                     WHERE role = 'SUPER_ADMIN' AND is_active = TRUE AND id <> $1`,
                    [id]
                );
                if (count.rows[0].total === 0) {
                    return res.status(400).json({ success: false, message: 'Không thể vô hiệu hóa Super Admin cuối cùng.' });
                }
            }
    
            if (password && password.trim() !== '') {
                const passwordCheck = validateAdminPassword(password, current.username);
                if (!passwordCheck.ok) {
                    return res.status(400).json({ success: false, message: passwordCheck.message });
                }
                await pool.query(
                    `UPDATE admin_accounts
                     SET password_hash = $1, password_changed_at = NOW(),
                         full_name = $2, role = $3, is_active = $4
                     WHERE id = $5`,
                    [await hashAdminPassword(password), full_name, role, is_active ?? true, id]
                );
            } else {
                await pool.query(
                    `UPDATE admin_accounts SET full_name = $1, role = $2, is_active = $3 WHERE id = $4`,
                    [full_name, role, is_active ?? true, id]
                );
            }
    
            // Re-map assigned groups
            await pool.query(`DELETE FROM admin_group_mappings WHERE admin_id = $1`, [id]);
            if (validatedGroups.length > 0) {
                for (const gId of validatedGroups) {
                    await pool.query(
                        `INSERT INTO admin_group_mappings (admin_id, telegram_group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                        [id, gId]
                    );
                }
            }
    
            await adminAuth.repository.revokeAdminSessions(id);
    
            res.json({ success: true });
        } catch (error) {
            res.status(error.status || 500).json({ success: false, message: error.message });
        }
    });
    
    app.delete('/api/admin/accounts/:id', adminAuth.requireSuperAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            if (String(id) === String(req.admin.id)) {
                return res.status(400).json({ success: false, message: 'Không thể tự xóa tài khoản đang đăng nhập.' });
            }
            const adminCheck = await pool.query('SELECT username, role, is_active FROM admin_accounts WHERE id = $1', [id]);
            if (!adminCheck.rows[0]) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản Admin.' });
            if (adminCheck.rows[0].role === 'SUPER_ADMIN' && adminCheck.rows[0].is_active) {
                const count = await pool.query(
                    `SELECT COUNT(*)::int AS total FROM admin_accounts
                     WHERE role = 'SUPER_ADMIN' AND is_active = TRUE AND id <> $1`,
                    [id]
                );
                if (count.rows[0].total === 0) {
                    return res.status(400).json({ success: false, message: 'Không thể xóa Super Admin cuối cùng.' });
                }
            }
            await pool.query('DELETE FROM admin_accounts WHERE id = $1', [id]);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../../packages/database/index.js';
import { syncAllTimekeepSheets } from '../bot/syncTimekeepSheets.js';
import { initLogger, writeLog, loggerMiddleware, setupLogRotation, overrideGlobals } from '../../packages/shared/logger.js';

dotenv.config();

const isDocker = fs.existsSync('/.dockerenv');
const BOT_HOST = isDocker ? 'bot' : 'localhost';
const BOT_PORT = isDocker ? 3002 : 3009;
const BOT_URL = `http://${BOT_HOST}:${BOT_PORT}`;

// Khởi tạo file log và bắt đầu cron job rotate
initLogger(process.env.APIS_LOG_FILE || './logs/timekeep_api_logs.log');
overrideGlobals();
setupLogRotation();

const app = express();
app.disable('etag');
app.use(loggerMiddleware);
app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'API is running' });
});

// =====================================
// NEW WEB ADMIN API & AUTH
// =====================================

// Helper lấy danh sách group_id được gán cho Admin từ DB
async function getAssignedGroupIds(adminId, role) {
    if (role === 'SUPER_ADMIN') {
        const res = await pool.query(`SELECT telegram_group_id FROM telegram_groups WHERE is_deleted = false OR is_deleted IS NULL`);
        return res.rows.map(r => r.telegram_group_id);
    }
    const res = await pool.query(`SELECT telegram_group_id FROM admin_group_mappings WHERE admin_id = $1`, [adminId]);
    return res.rows.map(r => r.telegram_group_id);
}

// Middleware kiểm tra phân quyền dữ liệu từ Request Headers
async function getAdminAuthContext(req) {
    const adminId = req.headers['x-admin-id'];
    const adminRole = req.headers['x-admin-role'];

    if (!adminId || adminRole === 'SUPER_ADMIN') {
        return { isSuperAdmin: true, allowedGroupIds: [] };
    }

    const allowedGroupIds = await getAssignedGroupIds(adminId, adminRole);
    return { isSuperAdmin: false, allowedGroupIds };
}

app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Check in admin_accounts table
        const adminRes = await pool.query(
            `SELECT * FROM admin_accounts WHERE username = $1 AND is_active = true`,
            [username]
        );

        if (adminRes.rows.length === 0) {
            // Fallback for default super admin if DB table is empty or first login
            if (username === 'admin' && password === 'admin123') {
                const assigned_groups = await getAssignedGroupIds(null, 'SUPER_ADMIN');
                return res.json({
                    success: true,
                    token: 'admin-token-123',
                    user: {
                        id: 'super-admin-id',
                        username: 'admin',
                        full_name: 'Super Administrator',
                        role: 'SUPER_ADMIN',
                        assigned_groups
                    }
                });
            }
            return res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc tài khoản bị khóa' });
        }

        const admin = adminRes.rows[0];
        if (admin.password_hash !== password) {
            return res.status(401).json({ success: false, message: 'Mật khẩu không chính xác' });
        }

        const assigned_groups = await getAssignedGroupIds(admin.id, admin.role);

        res.json({
            success: true,
            token: `token-${admin.id}`,
            user: {
                id: admin.id,
                username: admin.username,
                full_name: admin.full_name || admin.username,
                role: admin.role,
                assigned_groups
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// APIs Quản lý Tài khoản Admin (Dành cho Super Admin)
app.get('/api/admin/accounts', async (req, res) => {
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

app.post('/api/admin/accounts', async (req, res) => {
    try {
        const { username, password, full_name, role, assigned_groups } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Tên đăng nhập và mật khẩu là bắt buộc' });
        }

        const existing = await pool.query('SELECT id FROM admin_accounts WHERE username = $1', [username]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
        }

        const newAdmin = await pool.query(
            `INSERT INTO admin_accounts (username, password_hash, full_name, role)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [username, password, full_name || username, role || 'ADMIN']
        );

        const adminId = newAdmin.rows[0].id;
        if (Array.isArray(assigned_groups) && assigned_groups.length > 0) {
            for (const gId of assigned_groups) {
                await pool.query(
                    `INSERT INTO admin_group_mappings (admin_id, telegram_group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [adminId, gId]
                );
            }
        }

        res.json({ success: true, data: newAdmin.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/accounts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { password, full_name, role, is_active, assigned_groups } = req.body;

        if (password && password.trim() !== '') {
            await pool.query(
                `UPDATE admin_accounts SET password_hash = $1, full_name = $2, role = $3, is_active = $4 WHERE id = $5`,
                [password, full_name, role, is_active ?? true, id]
            );
        } else {
            await pool.query(
                `UPDATE admin_accounts SET full_name = $1, role = $2, is_active = $3 WHERE id = $4`,
                [full_name, role, is_active ?? true, id]
            );
        }

        // Re-map assigned groups
        await pool.query(`DELETE FROM admin_group_mappings WHERE admin_id = $1`, [id]);
        if (Array.isArray(assigned_groups) && assigned_groups.length > 0) {
            for (const gId of assigned_groups) {
                await pool.query(
                    `INSERT INTO admin_group_mappings (admin_id, telegram_group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [id, gId]
                );
            }
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/accounts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const adminCheck = await pool.query('SELECT username FROM admin_accounts WHERE id = $1', [id]);
        if (adminCheck.rows.length > 0 && adminCheck.rows[0].username === 'admin') {
            return res.status(400).json({ success: false, message: 'Không thể xóa tài khoản Super Admin mặc định' });
        }
        await pool.query('DELETE FROM admin_accounts WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/tk-users', async (req, res) => {
    try {
        const { isSuperAdmin, allowedGroupIds } = await getAdminAuthContext(req);
        const { group_id } = req.query;
        let query = `
            SELECT u.*, g.group_name 
            FROM employees u
            LEFT JOIN telegram_groups g ON u.telegram_group_id = g.telegram_group_id
            WHERE 1 = 1
        `;
        const params = [];

        if (group_id && group_id !== 'ALL') {
            if (!isSuperAdmin && !allowedGroupIds.includes(group_id)) {
                return res.status(403).json({ error: 'Bạn không có quyền xem nhân sự nhóm này' });
            }
            params.push(group_id);
            query += ` AND u.telegram_group_id = $${params.length}`;
        } else if (!isSuperAdmin) {
            params.push(allowedGroupIds);
            query += ` AND u.telegram_group_id = ANY($${params.length})`;
        }

        query += ` ORDER BY u.created_at DESC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
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

        // 2. Kiểm tra quyền quản lý nhóm
        if (!isSuperAdmin && (!currentEmp.telegram_group_id || !allowedGroupIds.includes(currentEmp.telegram_group_id))) {
            return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa nhân sự nhóm này' });
        }

        const { full_name, role, leave_quota, is_exempt_checkin, is_active, need_report } = req.body;

        // Giữ nguyên is_active hiện tại nếu body không truyền
        const newIsActive = is_active !== undefined ? !!is_active : (currentEmp.is_active !== false);
        const newNeedReport = need_report !== undefined ? !!need_report : (currentEmp.need_report !== false);

        await pool.query(
            `UPDATE employees SET full_name = $1, role = $2, leave_quota = $3, is_exempt_checkin = $4, is_active = $5, need_report = $6 WHERE id = $7`,
            [
                full_name !== undefined ? full_name : currentEmp.full_name,
                role !== undefined ? role : currentEmp.role,
                leave_quota !== undefined ? leave_quota : (currentEmp.leave_quota || 12),
                is_exempt_checkin !== undefined ? !!is_exempt_checkin : !!currentEmp.is_exempt_checkin,
                newIsActive,
                newNeedReport,
                req.params.id
            ]
        );

        // 3. Nếu nhân viên bị vô hiệu hóa, tự động đóng/hủy tất cả pending_reports của nhân viên đó
        if (!newIsActive && currentEmp.telegram_id) {
            await pool.query(`DELETE FROM pending_reports WHERE telegram_id = $1`, [currentEmp.telegram_id.toString()]);
            console.log(`[Admin API] Đã dọn dẹp pending_reports của nhân viên bị vô hiệu hóa (telegram_id: ${currentEmp.telegram_id})`);
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// =====================================
// SPRINT 2: Check-in Management APIs
// =====================================

// Lấy danh sách check-in, filter theo ngày và user và group
app.get('/api/admin/checkins', async (req, res) => {
    try {
        const { isSuperAdmin, allowedGroupIds } = await getAdminAuthContext(req);
        const { date, user_id, group_id } = req.query;
        let query = `
            SELECT c.*, u.full_name, u.role, u.telegram_id, g.group_name, g.telegram_group_id
            FROM tk_check_ins c
            LEFT JOIN employees u ON c.user_id = u.id
            LEFT JOIN telegram_groups g ON c.group_id = g.id
            WHERE 1=1
        `;
        const params = [];

        if (group_id && group_id !== 'ALL') {
            if (!isSuperAdmin && !allowedGroupIds.includes(group_id)) {
                return res.status(403).json({ error: 'Bạn không có quyền xem điểm danh nhóm này' });
            }
            params.push(group_id);
            query += ` AND (g.telegram_group_id = $${params.length} OR g.id::text = $${params.length})`;
        } else if (!isSuperAdmin) {
            params.push(allowedGroupIds);
            query += ` AND (g.telegram_group_id = ANY($${params.length}) OR g.id::text = ANY($${params.length}))`;
        }

        if (date) {
            params.push(date);
            query += ` AND c.date = $${params.length}`;
        }
        if (user_id) {
            params.push(user_id);
            query += ` AND c.user_id = $${params.length}`;
        }

        query += ` ORDER BY c.check_in_time DESC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin sửa giờ check-in hoặc status
app.put('/api/admin/checkins/:id', async (req, res) => {
    try {
        const { check_in_time, status, admin_note } = req.body;
        await pool.query(
            `UPDATE tk_check_ins SET check_in_time = $1, status = $2, admin_note = $3 WHERE id = $4`,
            [check_in_time, status || 'APPROVED', admin_note || 'Admin chỉnh sửa', req.params.id]
        );
        syncAllTimekeepSheets().catch(e => console.error('Sheet sync error:', e));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin thêm check-in thủ công
app.post('/api/admin/checkins', async (req, res) => {
    try {
        const { user_id, group_id, date, check_in_time, admin_note } = req.body;
        const result = await pool.query(
            `INSERT INTO tk_check_ins (user_id, group_id, date, check_in_time, video_file_id, status, admin_note)
             VALUES ($1, $2, $3, $4, 'manual', 'APPROVED', $5) RETURNING *`,
            [user_id, group_id, date, check_in_time, admin_note || 'Admin nhập tay']
        );
        syncAllTimekeepSheets().catch(e => console.error('Sheet sync error:', e));
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =====================================
// SPRINT 3: Schedule Management APIs
// =====================================

// Lấy lịch làm việc theo tuần (from_date, to_date)
app.get('/api/admin/schedules', async (req, res) => {
    try {
        const { isSuperAdmin, allowedGroupIds } = await getAdminAuthContext(req);
        const { from_date, to_date, group_id } = req.query;
        let query = `
            SELECT
                s.id,
                s.group_id,
                s.user_id,
                s.date::text AS date,
                s.shift_type,
                s.is_locked,
                s.created_at,
                s.proof_url,
                s.updated_by,
                s.updated_at,
                u.full_name,
                u.role,
                u.telegram_id,
                g.group_name,
                g.telegram_group_id
            FROM tk_schedules s
            LEFT JOIN employees u ON s.user_id = u.id
            LEFT JOIN telegram_groups g ON s.group_id = g.id
            WHERE 1 = 1
        `;
        const params = [];

        if (group_id && group_id !== 'ALL') {
            if (!isSuperAdmin && !allowedGroupIds.includes(group_id)) {
                return res.status(403).json({ error: 'Bạn không có quyền xem lịch làm việc nhóm này' });
            }
            params.push(group_id);
            query += ` AND (g.telegram_group_id = $${params.length} OR g.id::text = $${params.length})`;
        } else if (!isSuperAdmin) {
            params.push(allowedGroupIds);
            query += ` AND (g.telegram_group_id = ANY($${params.length}) OR g.id::text = ANY($${params.length}))`;
        }

        if (from_date) {
            params.push(from_date);
            query += ` AND s.date >= $${params.length}`;
        }
        if (to_date) {
            params.push(to_date);
            query += ` AND s.date <= $${params.length}`;
        }

        query += ` ORDER BY s.date ASC, u.full_name ASC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Lấy thống kê lịch làm việc theo ngày và theo ca
app.get('/api/admin/schedules/stats', async (req, res) => {
    try {
        const { isSuperAdmin, allowedGroupIds } = await getAdminAuthContext(req);
        const { from_date, to_date, group_id } = req.query;
        let query = `
            SELECT s.date::text as date_str, s.shift_type, s.is_locked,
                   u.id as user_id, u.full_name, u.role, u.telegram_id,
                   g.id as group_id, g.group_name, g.telegram_group_id
            FROM tk_schedules s
            LEFT JOIN employees u ON s.user_id = u.id
            LEFT JOIN telegram_groups g ON s.group_id = g.id
            WHERE 1=1
        `;
        const params = [];

        if (group_id && group_id !== 'ALL') {
            if (!isSuperAdmin && !allowedGroupIds.includes(group_id)) {
                return res.status(403).json({ error: 'Bạn không có quyền xem thống kê lịch nhóm này' });
            }
            params.push(group_id);
            query += ` AND (g.telegram_group_id = $${params.length} OR g.id::text = $${params.length})`;
        } else if (!isSuperAdmin) {
            params.push(allowedGroupIds);
            query += ` AND (g.telegram_group_id = ANY($${params.length}) OR g.id::text = ANY($${params.length}))`;
        }

        if (from_date) {
            params.push(from_date);
            query += ` AND s.date >= $${params.length}`;
        }
        if (to_date) {
            params.push(to_date);
            query += ` AND s.date <= $${params.length}`;
        }

        query += ` ORDER BY s.date ASC, s.shift_type ASC, u.full_name ASC`;

        const result = await pool.query(query, params);

        // Nhóm dữ liệu theo ngày và ca làm việc
        const stats = {};
        result.rows.forEach(row => {
            const dateStr = row.date_str;
            if (!stats[dateStr]) {
                stats[dateStr] = {
                    date: dateStr,
                    shifts: {
                        CA_SANG: { count: 0, users: [] },
                        CA_CHIEU: { count: 0, users: [] },
                        OFF: { count: 0, users: [] }
                    }
                };
            }

            const shift = row.shift_type;
            if (!stats[dateStr].shifts[shift]) {
                stats[dateStr].shifts[shift] = { count: 0, users: [] };
            }

            stats[dateStr].shifts[shift].count += 1;
            stats[dateStr].shifts[shift].users.push({
                id: row.user_id,
                full_name: row.full_name,
                role: row.role,
                telegram_id: row.telegram_id,
                group_name: row.group_name
            });
        });

        res.json(Object.values(stats));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



// =====================================
// SPRINT 4: Leave Requests & Balance APIs
// =====================================

// Lấy danh sách đơn xin nghỉ phép
app.get('/api/admin/leave-requests', async (req, res) => {
    try {
        const { isSuperAdmin, allowedGroupIds } = await getAdminAuthContext(req);
        const { group_id } = req.query;

        let query = `
            SELECT r.*, u.full_name, u.role, u.telegram_id, g.group_name, g.telegram_group_id
            FROM tk_leave_requests r
            LEFT JOIN employees u ON r.user_id = u.id
            LEFT JOIN telegram_groups g ON r.group_id = g.id
            WHERE 1=1
        `;
        const params = [];

        if (group_id && group_id !== 'ALL') {
            if (!isSuperAdmin && !allowedGroupIds.includes(group_id)) {
                return res.status(403).json({ error: 'Bạn không có quyền xem đơn xin nghỉ nhóm này' });
            }
            params.push(group_id);
            query += ` AND (g.telegram_group_id = $${params.length} OR g.id::text = $${params.length})`;
        } else if (!isSuperAdmin) {
            params.push(allowedGroupIds);
            query += ` AND (g.telegram_group_id = ANY($${params.length}) OR g.id::text = ANY($${params.length}))`;
        }

        query += ` ORDER BY r.created_at DESC`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Phê duyệt hoặc từ chối đơn xin nghỉ phép từ Dashboard
app.put('/api/admin/leave-requests/:id', async (req, res) => {
    try {
        const { status, approved_by } = req.body; // status: 'APPROVED' or 'REJECTED'
        const { id } = req.params;

        // 1. Get current request details
        const reqRes = await pool.query('SELECT * FROM tk_leave_requests WHERE id = $1', [id]);
        if (reqRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Yêu cầu không tồn tại' });
        }
        const request = reqRes.rows[0];

        // 2. Update request status
        await pool.query(
            `UPDATE tk_leave_requests SET status = $1, approved_by = $2 WHERE id = $3`,
            [status, approved_by || 'Admin', id]
        );

        // 3. Special logic if APPROVED and FULL_DAY
        if (status === 'APPROVED' && request.request_type === 'FULL_DAY') {
            const formattedDate = new Date(request.date).toISOString().split('T')[0];
            await pool.query(
                `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked)
                 VALUES ($1, $2, $3, 'OFF', true)
                 ON CONFLICT (user_id, date) 
                 DO UPDATE SET shift_type = 'OFF', is_locked = true`,
                [request.group_id, request.user_id, formattedDate]
            );
        } else if (request.status === 'APPROVED' && status !== 'APPROVED' && request.request_type === 'FULL_DAY') {
            // Revert OFF schedule if the request was previously approved but now rejected/reset
            const formattedDate = new Date(request.date).toISOString().split('T')[0];
            await pool.query(
                `DELETE FROM tk_schedules 
                 WHERE user_id = $1 AND date = $2 AND shift_type = 'OFF'`,
                [request.user_id, formattedDate]
            );
        }

        // 4. Notify employee via Telegram Bot
        const userRes = await pool.query('SELECT telegram_id FROM employees WHERE id = $1', [request.user_id]);
        if (userRes.rows.length > 0 && userRes.rows[0].telegram_id) {
            const telegramId = userRes.rows[0].telegram_id;
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (botToken) {
                const displayDate = new Date(request.date).toLocaleDateString('vi-VN');
                const requestTypeName = request.request_type === 'FULL_DAY' ? 'Nghỉ cả ngày 🟥' :
                    (request.request_type === 'HALF_DAY_AM' ? 'Nghỉ nửa ngày (Sáng) 🌅' :
                        (request.request_type === 'HALF_DAY_PM' ? 'Nghỉ nửa ngày (Chiều) 🌇' :
                            `Xin đi muộn (${request.late_minutes} phút) 🟩`));

                const statusText = status === 'APPROVED' ? 'Đã được DUYỆT ✅' : (status === 'REJECTED' ? 'Bị TỪ CHỐI ❌' : 'Chuyển về CHỜ DUYỆT ⏳');
                const adminName = approved_by || 'Admin';

                const message = `🔔 <b>Cập nhật duyệt đơn xin nghỉ/đi muộn ngày ${displayDate}:</b>\n\n` +
                    `📝 <b>Loại:</b> ${requestTypeName}\n` +
                    `📊 <b>Kết quả mới:</b> ${statusText}\n` +
                    `👤 <b>Người duyệt:</b> Admin ${adminName} (từ Dashboard)`;

                try {
                    const fetch = (await import('node-fetch')).default || globalThis.fetch;
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: telegramId,
                            text: message,
                            parse_mode: 'HTML'
                        })
                    });
                } catch (e) {
                    writeLog('error', `Failed to notify user via Telegram API: ${e.message}`);
                }
            }
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Lấy danh sách quỹ phép / số phép đã dùng của từng nhân viên
app.get('/api/admin/leave-balances', async (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const result = await pool.query(`
            SELECT 
                u.id as user_id,
                u.full_name,
                u.role,
                u.leave_quota,
                u.telegram_id,
                g.group_name,
                COALESCE(SUM(
                    CASE 
                        WHEN r.request_type = 'FULL_DAY' THEN 1.0
                        WHEN r.request_type IN ('HALF_DAY_AM', 'HALF_DAY_PM') THEN 0.5
                        ELSE 0.0
                    END
                ), 0) as used_days
            FROM employees u
            LEFT JOIN telegram_groups g ON u.telegram_group_id = g.telegram_group_id
            LEFT JOIN tk_leave_requests r ON u.id = r.user_id 
                AND r.status = 'APPROVED' 
                AND EXTRACT(YEAR FROM r.date) = $1
            GROUP BY u.id, g.group_name, u.full_name, u.role, u.leave_quota, u.telegram_id
            ORDER BY u.full_name ASC
        `, [year]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.get('/api/employees', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT e.*, tg.group_name 
            FROM employees e
            LEFT JOIN telegram_groups tg ON e.telegram_group_id = tg.telegram_group_id
            ORDER BY e.created_at DESC
        `);
        // Fetch actual kpi completed today from daily_reports
        const todayStr = new Date().toISOString().split('T')[0];
        const reportsResult = await pool.query('SELECT employee_id, kpi_actual FROM daily_reports WHERE report_date = $1', [todayStr]);

        const reportsMap = {};
        reportsResult.rows.forEach(r => {
            reportsMap[r.employee_id] = r.kpi_actual;
        });

        const employees = result.rows.map(emp => ({
            ...emp,
            kpi_required: emp.current_kpi_target || 0,
            kpi_actual: reportsMap[emp.id] || 0,
            status: (reportsMap[emp.id] >= (emp.current_kpi_target || 0)) ? 'DAT_KPI' : 'CHUA_DAT'
        }));
        res.json(employees);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/employees', async (req, res) => {
    try {
        const { full_name, employee_code, department, position, current_kpi_target } = req.body;
        const result = await pool.query(
            `INSERT INTO employees (full_name, employee_code, department, position, current_kpi_target) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [full_name, employee_code, department, position, current_kpi_target || 0]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update employee KPI Target
app.put('/api/employees/:id/kpi', async (req, res) => {
    try {
        const { id } = req.params;
        const { kpi_target } = req.body;
        await pool.query('UPDATE employees SET current_kpi_target = $1 WHERE id = $2', [kpi_target, id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update employee report requirement
app.put('/api/employees/:id/report-status', async (req, res) => {
    try {
        const { id } = req.params;
        const { need_report } = req.body;
        await pool.query('UPDATE employees SET need_report = $1 WHERE id = $2', [need_report, id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/employees/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Thêm các endpoint khác theo tài liệu THIET_KE_HE_THONG.md ở đây

// Group & Settings Endpoints
function extractSheetId(input) {
    if (!input) return null;
    const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
    return input.trim();
}

app.get('/api/groups', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT tkg.telegram_group_id, tkg.group_name, tkg.bot_role, tkg.schedule_registration_open,
                   tkg.kpi_sheet_id, tkg.customer_sheet_id,
                   gs.remind_time_1, gs.auto_reminder_enabled, gs.photo_deadline_minutes,
                   gs.penalty_missing_kpi, gs.penalty_per_photo, gs.penalty_missing_report,
                   gs.shift_1_time, gs.shift_2_time
            FROM telegram_groups tkg
            LEFT JOIN group_settings gs ON tkg.telegram_group_id = gs.telegram_group_id
            WHERE tkg.is_deleted = false OR tkg.is_deleted IS NULL
            ORDER BY tkg.created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/groups/:telegram_group_id', async (req, res) => {
    try {
        await pool.query('UPDATE telegram_groups SET is_deleted = true WHERE telegram_group_id = $1', [req.params.telegram_group_id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/groups/:telegram_group_id/settings', async (req, res) => {
    try {
        const { telegram_group_id } = req.params;
        const {
            penalty_under_15,
            penalty_under_90,
            penalty_over_90,
            shift_1_time,
            shift_2_time,
            auto_reminder_enabled = true,
            bot_role,
            schedule_registration_open,
            remind_time_1,
            photo_deadline_minutes,
            penalty_missing_kpi,
            penalty_per_photo,
            penalty_missing_report,
            kpi_sheet_id,
            customer_sheet_id
        } = req.body;

        const cleanKpiSheetId = extractSheetId(kpi_sheet_id);
        const cleanCustomerSheetId = extractSheetId(customer_sheet_id);

        // Upsert into telegram_groups
        await pool.query(
            `INSERT INTO telegram_groups (telegram_group_id, group_name, bot_role, schedule_registration_open, kpi_sheet_id, customer_sheet_id) 
             VALUES ($1, $2, $3, COALESCE($4, true), $5, $6)
             ON CONFLICT (telegram_group_id) DO UPDATE SET 
                 bot_role = COALESCE(EXCLUDED.bot_role, telegram_groups.bot_role), 
                 schedule_registration_open = COALESCE(EXCLUDED.schedule_registration_open, telegram_groups.schedule_registration_open),
                 kpi_sheet_id = COALESCE(EXCLUDED.kpi_sheet_id, telegram_groups.kpi_sheet_id),
                 customer_sheet_id = COALESCE(EXCLUDED.customer_sheet_id, telegram_groups.customer_sheet_id)`,
            [telegram_group_id, `Group ${telegram_group_id}`, bot_role || null, schedule_registration_open, cleanKpiSheetId, cleanCustomerSheetId]
        );

        // Upsert into group_settings
        const checkRes = await pool.query('SELECT id FROM group_settings WHERE telegram_group_id = $1', [telegram_group_id]);

        if (checkRes.rows.length > 0) {
            await pool.query(
                `UPDATE group_settings 
                 SET penalty_under_15 = COALESCE($1, penalty_under_15),
                     penalty_under_90 = COALESCE($2, penalty_under_90),
                     penalty_over_90 = COALESCE($3, penalty_over_90),
                     shift_1_time = COALESCE($4, shift_1_time),
                     shift_2_time = COALESCE($5, shift_2_time),
                     auto_reminder_enabled = COALESCE($6, auto_reminder_enabled),
                     remind_time_1 = COALESCE($7, remind_time_1),
                     photo_deadline_minutes = COALESCE($8, photo_deadline_minutes),
                     penalty_missing_kpi = COALESCE($9, penalty_missing_kpi),
                     penalty_per_photo = COALESCE($10, penalty_per_photo),
                     penalty_missing_report = COALESCE($11, penalty_missing_report),
                     updated_at = NOW()
                 WHERE telegram_group_id = $12`,
                [
                    penalty_under_15, penalty_under_90, penalty_over_90,
                    shift_1_time, shift_2_time, auto_reminder_enabled,
                    remind_time_1, photo_deadline_minutes, penalty_missing_kpi,
                    penalty_per_photo, penalty_missing_report, telegram_group_id
                ]
            );
        } else {
            await pool.query(
                `INSERT INTO group_settings 
                 (telegram_group_id, penalty_under_15, penalty_under_90, penalty_over_90, shift_1_time, shift_2_time, auto_reminder_enabled, remind_time_1, photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo, penalty_missing_report) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    telegram_group_id, penalty_under_15 || 20000, penalty_under_90 || 2000, penalty_over_90 || 200000,
                    shift_1_time || '08:00:00', shift_2_time || '13:30:00', auto_reminder_enabled,
                    remind_time_1, photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo, penalty_missing_report
                ]
            );
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get('/isdocker', (req, res) => {
    res.json({ isDocker });
});

// Serve Web Admin frontend
const webAdminPath = path.join(__dirname, '../web-admin/dist');
app.use(express.static(webAdminPath));

// Proxy routes to KPI Bot on port 3002 for Mini-App
app.get('/api/bot/get-report-today', async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
        // Chuyển tiếp toàn bộ query string
        const urlObj = new URL(`${BOT_URL}/api/bot/get-report-today`);
        for (const [key, value] of Object.entries(req.query)) {
            urlObj.searchParams.append(key, value);
        }

        const headers = {};
        const initData = req.headers['x-telegram-init-data'] || req.headers['X-Telegram-Init-Data'];
        if (initData) headers['x-telegram-init-data'] = initData;
        if (req.headers['authorization']) headers['authorization'] = req.headers['authorization'];

        const response = await fetch(urlObj.toString(), { headers });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/bot/submit-report', async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
        const headers = { 'Content-Type': 'application/json' };
        const initData = req.headers['x-telegram-init-data'] || req.headers['X-Telegram-Init-Data'];
        if (initData) headers['x-telegram-init-data'] = initData;
        if (req.headers['authorization']) headers['authorization'] = req.headers['authorization'];

        const response = await fetch(`${BOT_URL}/api/bot/submit-report`, {
            method: 'POST',
            headers,
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Proxy schedule mutation routes to bot (POST, PUT, DELETE to /api/admin/schedules)
app.use('/api/admin/schedules', async (req, res, next) => {
    if (req.method === 'GET') {
        return next();
    }
    try {
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
        const urlObj = new URL(BOT_URL + req.originalUrl);

        const options = {
            method: req.method,
            headers: { ...req.headers }
        };

        delete options.headers.host;

        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
            options.body = JSON.stringify(req.body);
            options.headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(urlObj.toString(), options);
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Proxy schedule, photo, dashboard and export routes to bot
app.use(['/api/schedules', '/api/photo-debts', '/api/upload-proof', '/api/timekeep', '/api/tk_group_settings', '/api/admin/dashboard', '/api/export'], async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
        const urlObj = new URL(BOT_URL + req.originalUrl);

        const options = {
            method: req.method,
            headers: { ...req.headers }
        };

        // Remove host to avoid conflicts
        delete options.headers.host;

        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
            options.body = JSON.stringify(req.body);
            options.headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(urlObj.toString(), options);

        // Nếu là 304 Not Modified, trả về ngay lập tức để tránh parse JSON lỗi
        if (response.status === 304) {
            return res.sendStatus(304);
        }

        const contentType = response.headers.get('content-type') || '';
        if (
            contentType.includes('text/csv') ||
            contentType.includes('application/octet-stream') ||
            contentType.includes('text/plain') ||
            contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ||
            contentType.includes('spreadsheet') ||
            contentType.includes('excel')
        ) {
            const buffer = Buffer.from(await response.arrayBuffer());
            if (contentType) res.setHeader('Content-Type', contentType);
            const contentDisposition = response.headers.get('content-disposition');
            if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
            return res.status(response.status).send(buffer);
        }

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Serve Bot Mini App
const botAppPath = path.join(__dirname, '../bot/public');
app.use('/mini-app', express.static(botAppPath));

// Các route không match API sẽ trả về file index.html (cho React Router)
app.use((req, res) => {
    res.sendFile(path.join(webAdminPath, 'index.html'));
});

const PORT = process.env.API_PORT || 3000;
app.listen(PORT, () => {
    writeLog('info', `API & Web Server is running on port ${PORT}`);
});

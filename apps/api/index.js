import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../../packages/database/index.js';
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'API is running' });
});

// =====================================
// NEW WEB ADMIN API (Sprint 1)
// =====================================

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin123') {
        res.json({ success: true, token: 'admin-token-123' });
    } else {
        res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu' });
    }
});

app.get('/api/admin/tk-users', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.*, g.group_name 
            FROM employees u
            LEFT JOIN telegram_groups g ON u.telegram_group_id = g.telegram_group_id
            ORDER BY u.created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/tk-users/:id', async (req, res) => {
    try {
        const { full_name, role, leave_quota } = req.body;
        await pool.query(
            `UPDATE employees SET full_name = $1, role = $2, leave_quota = $3 WHERE id = $4`,
            [full_name, role, leave_quota || 12, req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =====================================
// SPRINT 2: Check-in Management APIs
// =====================================

// Lấy danh sách check-in, filter theo ngày và user
app.get('/api/admin/checkins', async (req, res) => {
    try {
        const { date, user_id } = req.query;
        let query = `
            SELECT c.*, u.full_name, u.role, u.telegram_id, g.group_name
            FROM tk_check_ins c
            LEFT JOIN employees u ON c.user_id = u.id
            LEFT JOIN telegram_groups g ON c.group_id = g.id
            WHERE 1=1
        `;
        const params = [];

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
        const { from_date, to_date } = req.query;
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
                g.group_name
            FROM tk_schedules s
            LEFT JOIN employees u ON s.user_id = u.id
            LEFT JOIN telegram_groups g ON s.group_id = g.id
            WHERE 1 = 1
        `;
        const params = [];

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
        const { from_date, to_date } = req.query;
        let query = `
            SELECT s.date::text as date_str, s.shift_type, s.is_locked,
                   u.id as user_id, u.full_name, u.role, u.telegram_id,
                   g.id as group_id, g.group_name
            FROM tk_schedules s
            LEFT JOIN employees u ON s.user_id = u.id
            LEFT JOIN telegram_groups g ON s.group_id = g.id
            WHERE 1=1
        `;
        const params = [];

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
        const result = await pool.query(`
            SELECT r.*, u.full_name, u.role, u.telegram_id, g.group_name
            FROM tk_leave_requests r
            LEFT JOIN employees u ON r.user_id = u.id
            LEFT JOIN telegram_groups g ON r.group_id = g.id
            ORDER BY r.created_at DESC
        `);
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
app.get('/api/groups', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT tkg.telegram_group_id, tkg.group_name, tkg.bot_role, tkg.schedule_registration_open,
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
            remind_time_1,
            auto_reminder_enabled,
            photo_deadline_minutes,
            penalty_missing_kpi,
            penalty_per_photo,
            penalty_missing_report,
            shift_1_time,
            shift_2_time
        } = req.body;

        // Ensure the group exists in telegram_groups (required for FK constraint)
        await pool.query(
            `INSERT INTO telegram_groups (telegram_group_id, group_name) VALUES ($1, $2)
             ON CONFLICT (telegram_group_id) DO NOTHING`,
            [telegram_group_id, `Group ${telegram_group_id}`]
        );

        // Upsert into group_settings
        const checkRes = await pool.query('SELECT id FROM group_settings WHERE telegram_group_id = $1', [telegram_group_id]);

        if (checkRes.rows.length > 0) {
            await pool.query(
                `UPDATE group_settings 
                 SET remind_time_1 = $1, auto_reminder_enabled = $2, photo_deadline_minutes = $3,
                     penalty_missing_kpi = $4, penalty_per_photo = $5, penalty_missing_report = $6,
                     shift_1_time = $7, shift_2_time = $8
                 WHERE telegram_group_id = $9`,
                [remind_time_1, auto_reminder_enabled, photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo, penalty_missing_report, shift_1_time, shift_2_time, telegram_group_id]
            );
        } else {
            await pool.query(
                `INSERT INTO group_settings 
                 (telegram_group_id, remind_time_1, auto_reminder_enabled, photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo, penalty_missing_report, shift_1_time, shift_2_time) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [telegram_group_id, remind_time_1, auto_reminder_enabled, photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo, penalty_missing_report, shift_1_time, shift_2_time]
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

        const response = await fetch(urlObj.toString());
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/bot/submit-report', async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
        const response = await fetch(`${BOT_URL}/api/bot/submit-report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

// Proxy schedule, photo and dashboard routes to bot
app.use(['/api/schedules', '/api/photo-debts', '/api/upload-proof', '/api/timekeep', '/api/tk_group_settings', '/api/admin/dashboard'], async (req, res) => {
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

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../../packages/database/index.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'API is running' });
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
            SELECT tg.*, gs.remind_time_1, gs.auto_reminder_enabled, gs.photo_deadline_minutes,
                   gs.penalty_missing_kpi, gs.penalty_per_photo, gs.penalty_missing_report
            FROM telegram_groups tg
            LEFT JOIN group_settings gs ON tg.telegram_group_id = gs.telegram_group_id
            ORDER BY tg.created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/groups/:telegram_group_id/settings', async (req, res) => {
    try {
        const { telegram_group_id } = req.params;
        const { remind_time_1, auto_reminder_enabled, photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo, penalty_missing_report, kpi_sheet_id, customer_sheet_id } = req.body;
        
        // Update telegram_groups for sheet IDs
        if (kpi_sheet_id !== undefined || customer_sheet_id !== undefined) {
            await pool.query(
                `UPDATE telegram_groups SET kpi_sheet_id = COALESCE($1, kpi_sheet_id), customer_sheet_id = COALESCE($2, customer_sheet_id) WHERE telegram_group_id = $3`,
                [kpi_sheet_id, customer_sheet_id, telegram_group_id]
            );
        }

        // Upsert into group_settings
        const checkRes = await pool.query('SELECT id FROM group_settings WHERE telegram_group_id = $1', [telegram_group_id]);
        
        if (checkRes.rows.length > 0) {
            await pool.query(
                `UPDATE group_settings 
                 SET remind_time_1 = $1, auto_reminder_enabled = $2, photo_deadline_minutes = $3,
                     penalty_missing_kpi = $4, penalty_per_photo = $5, penalty_missing_report = $6
                 WHERE telegram_group_id = $7`,
                [remind_time_1, auto_reminder_enabled, photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo, penalty_missing_report, telegram_group_id]
            );
        } else {
            await pool.query(
                `INSERT INTO group_settings 
                 (telegram_group_id, remind_time_1, auto_reminder_enabled, photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo, penalty_missing_report) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [telegram_group_id, remind_time_1, auto_reminder_enabled, photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo, penalty_missing_report]
            );
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve Web Admin frontend
const webAdminPath = path.join(__dirname, '../web-admin/dist');
app.use(express.static(webAdminPath));

// Proxy routes to KPI Bot on port 3002 for Mini-App
app.get('/api/bot/get-report-today', async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
        // Chuyển tiếp toàn bộ query string
        const urlObj = new URL('http://localhost:3002/api/bot/get-report-today');
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
        const response = await fetch('http://localhost:3002/api/bot/submit-report', {
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

// Proxy schedule and photo routes
app.use(['/api/schedules', '/api/photo-debts', '/api/upload-proof'], async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
        const urlObj = new URL('http://localhost:3002' + req.originalUrl);
        
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
    console.log(`API & Web Server is running on port ${PORT}`);
});

export function registerEmployeeRoutes({ app, pool }) {
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
            const { kpi_target, telegram_group_id } = req.body;
            const target = Number(kpi_target);
            if (!Number.isFinite(target) || target < 0) {
                return res.status(400).json({ error: 'KPI phải là số không âm' });
            }
            let updated;
            if (telegram_group_id && telegram_group_id !== 'ALL') {
                updated = await pool.query(
                    `UPDATE employee_group_memberships
                     SET current_kpi_target = $1, updated_at = NOW(), updated_by = $3
                     WHERE employee_id = $2 AND telegram_group_id = $4
                     RETURNING (SELECT telegram_id FROM employees WHERE id = $2) AS telegram_id`,
                    [target, id, `admin:${req.admin.id}`, telegram_group_id]
                );
            } else {
                updated = await pool.query('UPDATE employees SET current_kpi_target = $1 WHERE id = $2 RETURNING telegram_id', [target, id]);
            }
            if (target === 0 && updated.rows[0]?.telegram_id) {
                if (telegram_group_id && telegram_group_id !== 'ALL') {
                    await pool.query('DELETE FROM pending_reports WHERE telegram_id = $1 AND group_id = $2', [updated.rows[0].telegram_id, telegram_group_id]);
                } else {
                    await pool.query('DELETE FROM pending_reports WHERE telegram_id = $1', [updated.rows[0].telegram_id]);
                }
            }
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // Update employee report requirement
    app.put('/api/employees/:id/report-status', async (req, res) => {
        try {
            const { id } = req.params;
            const { need_report, telegram_group_id } = req.body;
            let updated;
            if (telegram_group_id && telegram_group_id !== 'ALL') {
                updated = await pool.query(
                    `UPDATE employee_group_memberships
                     SET need_report = $1, updated_at = NOW(), updated_by = $3
                     WHERE employee_id = $2 AND telegram_group_id = $4
                     RETURNING (SELECT telegram_id FROM employees WHERE id = $2) AS telegram_id`,
                    [!!need_report, id, `admin:${req.admin.id}`, telegram_group_id]
                );
            } else {
                updated = await pool.query('UPDATE employees SET need_report = $1 WHERE id = $2 RETURNING telegram_id', [!!need_report, id]);
            }
            if (!need_report && updated.rows[0]?.telegram_id) {
                if (telegram_group_id && telegram_group_id !== 'ALL') {
                    await pool.query('DELETE FROM pending_reports WHERE telegram_id = $1 AND group_id = $2', [updated.rows[0].telegram_id, telegram_group_id]);
                } else {
                    await pool.query('DELETE FROM pending_reports WHERE telegram_id = $1', [updated.rows[0].telegram_id]);
                }
            }
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
}

export function registerScheduleRoutes({ app, pool, getAdminAuthContext }) {
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
                WHERE g.bot_role = 'timekeep'
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
}

export function registerAttendanceRoutes({ app, pool, getAdminAuthContext, syncAllTimekeepSheets }) {
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
}

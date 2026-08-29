export function registerLeaveRoutes({
    app,
    pool,
    getAdminAuthContext,
    syncAllTimekeepSheets,
    applyApprovedLeavePenalties,
    rejectAutoAcceptedLeaveRequest,
    writeLog
}) {
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
    
            // 2. Đơn tự chấp nhận phải được thu hồi bằng service để khôi phục đúng
            // lịch cũ và tính lại phạt. Các đơn PENDING cũ vẫn dùng luồng tương thích.
            const isAutoReject = request.auto_accepted === true
                && request.status === 'APPROVED'
                && status === 'REJECTED';
    
            if (isAutoReject) {
                const outcome = await rejectAutoAcceptedLeaveRequest({
                    pool,
                    requestId: id,
                    rejectedBy: approved_by || 'Admin (Dashboard)'
                });
                if (outcome.result !== 'REJECTED') {
                    return res.status(409).json({ success: false, message: 'Đơn không còn ở trạng thái có thể từ chối' });
                }
            } else {
                await pool.query(
                    `UPDATE tk_leave_requests SET status = $1, approved_by = $2 WHERE id = $3`,
                    [status, approved_by || 'Admin', id]
                );
            }
    
            // 3. Special logic if APPROVED for FULL/HALF days
            if (!isAutoReject && status === 'APPROVED' && ['FULL_DAY', 'HALF_DAY_AM', 'HALF_DAY_PM'].includes(request.request_type)) {
                const formattedDate = new Date(request.date).toISOString().split('T')[0];
                let newShift = 'OFF';
                if (request.request_type === 'HALF_DAY_AM') newShift = 'HALF_DAY_PM_WORK';
                if (request.request_type === 'HALF_DAY_PM') newShift = 'CA_SANG';
    
                await pool.query(
                    `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked)
                     VALUES ($1, $2, $3, $4, true)
                     ON CONFLICT (user_id, date) 
                     DO UPDATE SET shift_type = $4, is_locked = true`,
                    [request.group_id, request.user_id, formattedDate, newShift]
                );
    
                await applyApprovedLeavePenalties({
                    pool,
                    request: { ...request, date: formattedDate }
                });
                syncAllTimekeepSheets().catch(e => console.error('Sheet sync error:', e));
            } else if (!isAutoReject && request.status === 'APPROVED' && status !== 'APPROVED' && ['FULL_DAY', 'HALF_DAY_AM', 'HALF_DAY_PM'].includes(request.request_type)) {
                // Revert schedule if the request was previously approved but now rejected/reset
                const formattedDate = new Date(request.date).toISOString().split('T')[0];
                await pool.query(
                    `DELETE FROM tk_schedules 
                     WHERE user_id = $1 AND date = $2 AND shift_type IN ('OFF', 'CA_CHIEU', 'CA_SANG', 'HALF_DAY_PM_WORK')`,
                    [request.user_id, formattedDate]
                );
            }
    
            if (isAutoReject) {
                syncAllTimekeepSheets().catch(e => console.error('Sheet sync error:', e));
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
}

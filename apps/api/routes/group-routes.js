export function registerGroupRoutes({ app, pool }) {
    // Group & Settings Endpoints
    function extractSheetId(input) {
        if (!input) return null;
        const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (match) return match[1];
        return input.trim();
    }
    
    function canManageAdminGroup(req, telegramGroupId) {
        return req.admin.isSuperAdmin || req.admin.allowedGroupIds.includes(String(telegramGroupId));
    }
    
    app.get('/api/groups', async (req, res) => {
        try {
            const params = [];
            let query = `
                SELECT tkg.telegram_group_id, tkg.group_name, tkg.bot_role, tkg.schedule_registration_open,
                       tkg.kpi_sheet_id, tkg.customer_sheet_id, tkg.pricing_sheet_id,
                       tkg.customer_drive_folder_id, tkg.warehouse_drive_folder_id,
                       COALESCE(tkg.warehouse_service_order_enabled, FALSE) AS warehouse_service_order_enabled,
                       COALESCE(tkg.approval_settings, '{"leave_late":"AUTO","leave_absence":"AUTO","staff_registration":"AUTO","warehouse_order":"AUTO","tour_report":"AUTO","schedule_change":"AUTO"}'::jsonb) AS approval_settings,
                       gs.remind_time_1, gs.auto_reminder_enabled, gs.photo_deadline_minutes,
                       gs.penalty_missing_kpi, gs.penalty_per_photo, gs.penalty_missing_report,
                       gs.shift_1_time, gs.shift_2_time,
                       COALESCE(gs.attendance_policy, 'CLINIC') AS attendance_policy,
                       COALESCE(gs.checkout_min_time::text, '18:30:00') AS checkout_min_time,
                       COALESCE(gs.checkout_deadline::text, '23:59:00') AS checkout_deadline,
                       COALESCE(gs.marketing_checkin_deadline::text, '08:30:00') AS marketing_checkin_deadline,
                       COALESCE(gs.marketing_late_cutoff::text, '09:30:00') AS marketing_late_cutoff,
                       COALESCE(gs.marketing_checkin_penalty, 50000) AS marketing_checkin_penalty,
                       COALESCE(gs.marketing_checkout_penalty, 20000) AS marketing_checkout_penalty,
                       rc.shift_start_time AS retail_shift_start,
                       rc.shift_end_time   AS retail_shift_end,
                       rc.daily_kpi_target AS retail_kpi_target,
                       gs.updated_at
                FROM telegram_groups tkg
                LEFT JOIN group_settings gs ON tkg.telegram_group_id = gs.telegram_group_id
                LEFT JOIN retail_checkin_config rc ON tkg.telegram_group_id = rc.telegram_group_id
                WHERE (tkg.is_deleted = false OR tkg.is_deleted IS NULL)
            `;
            if (!req.admin.isSuperAdmin) {
                params.push(req.admin.allowedGroupIds);
                query += ' AND tkg.telegram_group_id = ANY($1::varchar[])';
            }
            query += ' ORDER BY tkg.created_at DESC';
            const result = await pool.query(query, params);
            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.put('/api/groups/:telegram_group_id/approval-settings', async (req, res) => {
        try {
            const { telegram_group_id } = req.params;
            if (!canManageAdminGroup(req, telegram_group_id)) {
                return res.status(403).json({ error: 'Bạn không có quyền sửa cấu hình nhóm này.' });
            }
            const { approval_settings } = req.body;
            if (!approval_settings || typeof approval_settings !== 'object') {
                return res.status(400).json({ error: 'Cấu hình phê duyệt không hợp lệ.' });
            }
            const currentRes = await pool.query('SELECT approval_settings FROM telegram_groups WHERE telegram_group_id = $1', [telegram_group_id]);
            const current = currentRes.rows[0]?.approval_settings || {
                leave_late: 'AUTO',
                leave_absence: 'AUTO',
                staff_registration: 'AUTO',
                warehouse_order: 'AUTO',
                tour_report: 'AUTO',
                schedule_change: 'AUTO'
            };
            const merged = { ...current, ...approval_settings };
            await pool.query(
                'UPDATE telegram_groups SET approval_settings = $1 WHERE telegram_group_id = $2',
                [JSON.stringify(merged), telegram_group_id]
            );
            res.json({ success: true, approval_settings: merged });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    app.delete('/api/groups/:telegram_group_id', async (req, res) => {
        try {
            if (!canManageAdminGroup(req, req.params.telegram_group_id)) {
                return res.status(403).json({ error: 'Bạn không có quyền xóa nhóm này.' });
            }
            await pool.query('UPDATE telegram_groups SET is_deleted = true WHERE telegram_group_id = $1', [req.params.telegram_group_id]);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    app.put('/api/groups/:telegram_group_id/settings', async (req, res) => {
        try {
            const { telegram_group_id } = req.params;
            if (!canManageAdminGroup(req, telegram_group_id)) {
                return res.status(403).json({ error: 'Bạn không có quyền sửa cấu hình nhóm này.' });
            }
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
                customer_sheet_id,
                retail_shift_start,
                retail_shift_end,
                retail_kpi_target,
                attendance_policy,
                checkout_min_time,
                checkout_deadline,
                marketing_checkin_deadline,
                marketing_late_cutoff,
                marketing_checkin_penalty,
                marketing_checkout_penalty,
                approval_settings
            } = req.body;
    
            const cleanKpiSheetId = extractSheetId(kpi_sheet_id);
            const cleanCustomerSheetId = extractSheetId(customer_sheet_id);
            const approvalJson = approval_settings && typeof approval_settings === 'object' ? JSON.stringify(approval_settings) : null;
    
            // Upsert into telegram_groups
            await pool.query(
                `INSERT INTO telegram_groups (telegram_group_id, group_name, bot_role, schedule_registration_open, kpi_sheet_id, customer_sheet_id, approval_settings) 
                 VALUES ($1, $2, $3, COALESCE($4, true), $5, $6, COALESCE($7::jsonb, '{"leave_late":"AUTO","leave_absence":"AUTO","staff_registration":"AUTO","warehouse_order":"AUTO","tour_report":"AUTO","schedule_change":"AUTO"}'::jsonb))
                 ON CONFLICT (telegram_group_id) DO UPDATE SET 
                     bot_role = COALESCE(EXCLUDED.bot_role, telegram_groups.bot_role), 
                     schedule_registration_open = COALESCE(EXCLUDED.schedule_registration_open, telegram_groups.schedule_registration_open),
                     kpi_sheet_id = COALESCE(EXCLUDED.kpi_sheet_id, telegram_groups.kpi_sheet_id),
                     customer_sheet_id = COALESCE(EXCLUDED.customer_sheet_id, telegram_groups.customer_sheet_id),
                     approval_settings = COALESCE($7::jsonb, telegram_groups.approval_settings)`,
                [telegram_group_id, `Group ${telegram_group_id}`, bot_role || null, schedule_registration_open, cleanKpiSheetId, cleanCustomerSheetId, approvalJson]
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
                         attendance_policy = COALESCE($13, attendance_policy),
                         checkout_min_time = COALESCE($14, checkout_min_time),
                         checkout_deadline = COALESCE($15, checkout_deadline),
                         marketing_checkin_deadline = COALESCE($16, marketing_checkin_deadline),
                         marketing_late_cutoff = COALESCE($17, marketing_late_cutoff),
                         marketing_checkin_penalty = COALESCE($18, marketing_checkin_penalty),
                         marketing_checkout_penalty = COALESCE($19, marketing_checkout_penalty),
                         updated_at = NOW()
                     WHERE telegram_group_id = $12`,
                    [
                        penalty_under_15, penalty_under_90, penalty_over_90,
                        shift_1_time, shift_2_time, auto_reminder_enabled,
                        remind_time_1, photo_deadline_minutes, penalty_missing_kpi,
                        penalty_per_photo, penalty_missing_report, telegram_group_id,
                        attendance_policy || null,
                        checkout_min_time || null,
                        checkout_deadline || null,
                        marketing_checkin_deadline || null,
                        marketing_late_cutoff || null,
                        marketing_checkin_penalty || null,
                        marketing_checkout_penalty || null
                    ]
                );
            } else {
                await pool.query(
                    `INSERT INTO group_settings 
                     (telegram_group_id, penalty_under_15, penalty_under_90, penalty_over_90, shift_1_time, shift_2_time, auto_reminder_enabled, remind_time_1, photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo, penalty_missing_report, attendance_policy, checkout_min_time, checkout_deadline, marketing_checkin_deadline, marketing_late_cutoff, marketing_checkin_penalty, marketing_checkout_penalty) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
                    [
                        telegram_group_id, penalty_under_15 || 20000, penalty_under_90 || 2000, penalty_over_90 || 200000,
                        shift_1_time || '08:00:00', shift_2_time || '13:30:00', auto_reminder_enabled,
                        remind_time_1, photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo, penalty_missing_report,
                        attendance_policy || 'CLINIC',
                        checkout_min_time || '18:30:00',
                        checkout_deadline || '23:59:00',
                        marketing_checkin_deadline || '08:30:00',
                        marketing_late_cutoff || '09:30:00',
                        marketing_checkin_penalty || 50000,
                        marketing_checkout_penalty || 20000
                    ]
                );
            }
            // Upsert retail_checkin_config nếu nhóm có role retail_checkin
            if (bot_role === 'retail_checkin' && (retail_shift_start || retail_shift_end || retail_kpi_target)) {
                await pool.query(
                    `INSERT INTO retail_checkin_config (telegram_group_id, shift_start_time, shift_end_time, daily_kpi_target)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (telegram_group_id) DO UPDATE SET
                         shift_start_time = COALESCE(EXCLUDED.shift_start_time, retail_checkin_config.shift_start_time),
                         shift_end_time   = COALESCE(EXCLUDED.shift_end_time,   retail_checkin_config.shift_end_time),
                         daily_kpi_target = COALESCE(EXCLUDED.daily_kpi_target, retail_checkin_config.daily_kpi_target),
                         updated_at = NOW()`,
                    [
                        telegram_group_id,
                        retail_shift_start || null,
                        retail_shift_end   || null,
                        retail_kpi_target  ? Number(retail_kpi_target) : null
                    ]
                );
            }

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}

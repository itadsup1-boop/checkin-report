/**
 * SQL của báo cáo KPI hàng ngày: `pending_reports` (chờ đủ ảnh) và
 * `daily_reports` (đã chốt). Mọi truy vấn nằm ở đây, tầng application/interfaces
 * không viết SQL.
 */

export function createReportRepository({ pool }) {
    /** Lưu báo cáo chờ ảnh — nhánh từ tin nhắn Telegram, KHÔNG có customers_data. */
    async function upsertPendingReportFromText({ telegramId, groupId, rawText, kpiActual, requiredPhotos, deadlineAt }) {
        await pool.query(
            `INSERT INTO pending_reports
                (telegram_id, group_id, raw_text, kpi_actual, required_photos, received_photos, deadline_at, status, last_reminder_stage)
             VALUES ($1, $2, $3, $4, $5, 0, $6, 'WAITING_PHOTOS', 0)
             ON CONFLICT (telegram_id, group_id) DO UPDATE SET
                 raw_text = EXCLUDED.raw_text,
                 kpi_actual = EXCLUDED.kpi_actual,
                 required_photos = EXCLUDED.required_photos,
                 received_photos = 0,
                 deadline_at = EXCLUDED.deadline_at,
                 status = 'WAITING_PHOTOS',
                 last_reminder_stage = 0,
                 inactivity_reminded = false,
                 last_photo_received_at = NULL`,
            [telegramId, groupId, rawText, kpiActual, requiredPhotos, deadlineAt]
        );
    }

    /** Lưu báo cáo chờ ảnh — nhánh từ form Mini App, có thể đã nộp sẵn vài ảnh + lịch khách đính kèm. */
    async function upsertPendingReportFromForm({
        telegramId, groupId, rawText, kpiActual, requiredPhotos, receivedPhotos, deadlineAt, customersData
    }) {
        await pool.query(
            `INSERT INTO pending_reports
                (telegram_id, group_id, raw_text, kpi_actual, required_photos, received_photos, deadline_at, status, last_reminder_stage, customers_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'WAITING_PHOTOS', 0, $8)
             ON CONFLICT (telegram_id, group_id) DO UPDATE SET
                 raw_text = EXCLUDED.raw_text,
                 kpi_actual = EXCLUDED.kpi_actual,
                 required_photos = EXCLUDED.required_photos,
                 received_photos = $6,
                 deadline_at = EXCLUDED.deadline_at,
                 status = 'WAITING_PHOTOS',
                 last_reminder_stage = 0,
                 customers_data = EXCLUDED.customers_data`,
            [telegramId, groupId, rawText, kpiActual, requiredPhotos, receivedPhotos, deadlineAt, JSON.stringify(customersData || [])]
        );
    }

    /** Cộng 1 ảnh vừa nhận — atomic để tránh đếm sai khi nhân viên gửi dồn dập. */
    async function incrementReceivedPhotos(telegramId, groupId) {
        const result = await pool.query(
            `UPDATE pending_reports
             SET received_photos = received_photos + 1,
                 last_photo_received_at = NOW(),
                 inactivity_reminded = false
             WHERE telegram_id = $1 AND group_id = $2 AND status = 'WAITING_PHOTOS'
             RETURNING *`,
            [telegramId, groupId]
        );
        return result.rows[0] || null;
    }

    /** Chốt DONE có điều kiện — trả về false nếu đã có tiến trình khác chốt trước (chặn xử lý trùng). */
    async function markPendingDoneIfWaiting(telegramId, groupId) {
        const result = await pool.query(
            `UPDATE pending_reports SET status = 'DONE'
             WHERE telegram_id = $1 AND group_id = $2 AND status = 'WAITING_PHOTOS'
             RETURNING telegram_id`,
            [telegramId, groupId]
        );
        return result.rowCount > 0;
    }

    async function markPendingDoneWithDebt(telegramId, groupId) {
        await pool.query(
            `UPDATE pending_reports SET status = 'DONE_WITH_DEBT' WHERE telegram_id = $1 AND group_id = $2`,
            [telegramId, groupId]
        );
    }

    async function markReminderStage(telegramId, groupId, stage) {
        await pool.query(
            `UPDATE pending_reports SET last_reminder_stage = $1 WHERE telegram_id = $2 AND group_id = $3`,
            [stage, telegramId, groupId]
        );
    }

    async function markInactivityReminded(telegramId, groupId) {
        await pool.query(
            `UPDATE pending_reports SET inactivity_reminded = true WHERE telegram_id = $1 AND group_id = $2`,
            [telegramId, groupId]
        );
    }

    async function deletePendingReport(telegramId, groupId) {
        await pool.query(`DELETE FROM pending_reports WHERE telegram_id = $1 AND group_id = $2`, [telegramId, groupId]);
    }

    async function deletePendingReportsForGroup(groupId) {
        await pool.query(`DELETE FROM pending_reports WHERE group_id = $1`, [groupId]);
    }

    /** Dọn nháp của nhân viên vừa bị vô hiệu hóa — chạy đầu mỗi lượt quét cron. */
    async function deletePendingReportsForDeactivatedEmployees() {
        await pool.query(`
            DELETE FROM pending_reports
            WHERE telegram_id IN (
                SELECT telegram_id FROM employees WHERE is_active = false AND telegram_id IS NOT NULL
            )
        `);
    }

    /** Tên hiển thị khi nhắc nhở — tra cứu đơn giản, không xét thành viên/quyền của nhóm. */
    async function findEmployeeFullName(telegramId) {
        const result = await pool.query('SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1', [telegramId]);
        return result.rows[0]?.full_name || null;
    }

    /** Toàn bộ thông tin nhân viên theo telegram_id — dùng khi cần cả is_active/telegram_group_id lẫn xác nhận đã /setup hay chưa. */
    async function findEmployeeByTelegramId(telegramId) {
        const result = await pool.query('SELECT * FROM employees WHERE telegram_id = $1 LIMIT 1', [telegramId]);
        return result.rows[0] || null;
    }

    async function findPendingWaitingPhotos(telegramId, groupId) {
        const result = await pool.query(
            `SELECT telegram_id FROM pending_reports WHERE telegram_id = $1 AND group_id = $2 AND status = 'WAITING_PHOTOS' LIMIT 1`,
            [telegramId, groupId]
        );
        return result.rows[0] || null;
    }

    async function findPendingRawText(telegramId, groupId) {
        const result = await pool.query(
            `SELECT raw_text FROM pending_reports WHERE telegram_id = $1 AND group_id = $2 AND status = 'WAITING_PHOTOS' LIMIT 1`,
            [telegramId, groupId]
        );
        return result.rows[0] || null;
    }

    /** Các báo cáo đang chờ ảnh của nhân viên còn hoạt động, thuộc nhóm report/report_tour — quét bởi cron hạn chót. */
    async function findActivePendingForDeadlineScan() {
        const result = await pool.query(`
            SELECT pr.*
            FROM pending_reports pr
            JOIN telegram_groups tg ON tg.telegram_group_id = pr.group_id
            JOIN employees e ON e.telegram_id = pr.telegram_id
            JOIN employee_group_memberships m
              ON m.employee_id = e.id AND m.telegram_group_id = pr.group_id
            WHERE pr.status = 'WAITING_PHOTOS'
              AND tg.bot_role IN ('report', 'report_tour')
              AND tg.is_active = true
              AND COALESCE(tg.is_deleted, false) = false
              AND COALESCE(e.is_active, true) = true
              AND m.status = 'ACTIVE'
              AND m.need_report = true
              AND COALESCE(m.current_kpi_target, 0) > 0
        `);
        return result.rows;
    }

    async function insertDailyReport({ reportDate, reportMonth, employeeId, groupId, rawText, kpiActual, kpiRequired, status, metadata }) {
        await pool.query(
            `INSERT INTO daily_reports
                (report_date, report_month, employee_id, telegram_group_id, raw_text, kpi_actual, kpi_required, status, submitted_at, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)`,
            [reportDate, reportMonth, employeeId, groupId, rawText, kpiActual, kpiRequired, status, JSON.stringify(metadata)]
        );
    }

    /** Báo cáo mới nhất của nhân viên trong nhóm hôm nay, nếu có. */
    async function findTodayReport(groupId, employeeId, date) {
        const result = await pool.query(
            `SELECT * FROM daily_reports
             WHERE telegram_group_id = $1 AND employee_id = $2 AND report_date = $3
             ORDER BY id DESC LIMIT 1`,
            [groupId, employeeId, date]
        );
        return result.rows[0] || null;
    }

    /** Cập nhật chỉ tiêu KPI chung cho toàn bộ nhân viên đang hoạt động trong nhóm — lệnh /kpi. */
    async function setKpiTargetForGroup(groupId, newKpi, updatedBy) {
        const result = await pool.query(
            `UPDATE employee_group_memberships
             SET current_kpi_target = $1, updated_at = NOW(), updated_by = $3
             WHERE telegram_group_id = $2 AND status = 'ACTIVE'
             RETURNING employee_id`,
            [newKpi, groupId, updatedBy]
        );
        return result.rowCount;
    }

    /**
     * Lịch khách được nhân viên ghi kèm trong báo cáo (form Mini App) — chỉ để
     * nhắc nhở, KHÁC hoàn toàn với chức năng đặt lịch của role report_tour ở
     * domains/scheduling (không có kiểm trùng giờ, không theo mẫu dịch vụ).
     */
    async function upsertReportAppointment({ telegramId, employeeName, groupId, customerName, phone, service, sessions, appointmentTime }) {
        const existing = await pool.query(
            `SELECT id FROM customer_appointments
             WHERE telegram_id = $1 AND customer_name = $2 AND phone = $3
               AND DATE(appointment_time) = DATE($4) LIMIT 1`,
            [telegramId, customerName, phone, appointmentTime]
        );

        if (existing.rows.length > 0) {
            await pool.query(
                `UPDATE customer_appointments
                 SET appointment_time = $1, phone = $2, service = $3, sessions = $4, is_reminded = FALSE
                 WHERE id = $5`,
                [appointmentTime, phone, service, sessions, existing.rows[0].id]
            );
            return;
        }

        await pool.query(
            `INSERT INTO customer_appointments (telegram_id, employee_name, group_id, customer_name, phone, service, sessions, appointment_time, is_reminded)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)`,
            [telegramId, employeeName, groupId, customerName, phone, service, sessions, appointmentTime]
        );
    }

    return {
        upsertPendingReportFromText,
        upsertPendingReportFromForm,
        incrementReceivedPhotos,
        markPendingDoneIfWaiting,
        markPendingDoneWithDebt,
        markReminderStage,
        markInactivityReminded,
        deletePendingReport,
        deletePendingReportsForGroup,
        deletePendingReportsForDeactivatedEmployees,
        findEmployeeFullName,
        findEmployeeByTelegramId,
        findPendingWaitingPhotos,
        findPendingRawText,
        findActivePendingForDeadlineScan,
        insertDailyReport,
        findTodayReport,
        setKpiTargetForGroup,
        upsertReportAppointment
    };
}

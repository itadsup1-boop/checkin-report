/**
 * Repository tầng infrastructure cho module Báo Cáo Telesale.
 * Mọi câu lệnh SQL đối với PostgreSQL nằm ở đây.
 */

export function createTelesaleRepository({ pool }) {
    /**
     * Lưu hoặc cập nhật báo cáo trong ngày của một nhân sự.
     */
    async function upsertDailyReport({
        telegramGroupId,
        employeeId,
        telegramUserId,
        employeeName,
        reportDate,
        soNhan,
        soTrungKncVang,
        lichPvMoi,
        lichPvCu,
        lichNgayMai,
        tongToiHnay,
        tongBongHnay,
        tongDsHnay,
        tongLich,
        tongDsThang,
        tyLeKhachToiDs,
        tyLeLich,
        tyLeToi,
        rawPayload = {}
    }) {
        const query = `
            INSERT INTO telesale_daily_reports (
                telegram_group_id, employee_id, telegram_user_id, employee_name,
                report_date, so_nhan, so_trung_knc_vang, lich_pv_moi, lich_pv_cu,
                lich_ngay_mai, tong_toi_hnay, tong_bong_hnay, tong_ds_hnay,
                tong_lich, tong_ds_thang, ty_le_khach_toi_ds, ty_le_lich, ty_le_toi,
                raw_payload, submitted_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW()
            )
            ON CONFLICT (telegram_group_id, employee_id, report_date) DO UPDATE SET
                telegram_user_id = EXCLUDED.telegram_user_id,
                employee_name = EXCLUDED.employee_name,
                so_nhan = EXCLUDED.so_nhan,
                so_trung_knc_vang = EXCLUDED.so_trung_knc_vang,
                lich_pv_moi = EXCLUDED.lich_pv_moi,
                lich_pv_cu = EXCLUDED.lich_pv_cu,
                lich_ngay_mai = EXCLUDED.lich_ngay_mai,
                tong_toi_hnay = EXCLUDED.tong_toi_hnay,
                tong_bong_hnay = EXCLUDED.tong_bong_hnay,
                tong_ds_hnay = EXCLUDED.tong_ds_hnay,
                tong_lich = EXCLUDED.tong_lich,
                tong_ds_thang = EXCLUDED.tong_ds_thang,
                ty_le_khach_toi_ds = EXCLUDED.ty_le_khach_toi_ds,
                ty_le_lich = EXCLUDED.ty_le_lich,
                ty_le_toi = EXCLUDED.ty_le_toi,
                raw_payload = EXCLUDED.raw_payload,
                updated_at = NOW()
            RETURNING *;
        `;

        const values = [
            String(telegramGroupId),
            employeeId,
            telegramUserId || null,
            employeeName || null,
            reportDate,
            soNhan || 0,
            soTrungKncVang || 0,
            lichPvMoi || 0,
            lichPvCu || 0,
            lichNgayMai || 0,
            tongToiHnay || 0,
            tongBongHnay || 0,
            tongDsHnay || 0,
            tongLich || 0,
            tongDsThang || 0,
            tyLeKhachToiDs || 0,
            tyLeLich || 0,
            tyLeToi || 0,
            JSON.stringify(rawPayload)
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Lấy báo cáo trong ngày của một nhân sự (nếu có).
     */
    async function getDailyReport(telegramGroupId, employeeId, reportDate) {
        const result = await pool.query(
            `SELECT * FROM telesale_daily_reports
             WHERE telegram_group_id = $1 AND employee_id = $2 AND report_date = $3 LIMIT 1`,
            [String(telegramGroupId), employeeId, reportDate]
        );
        return result.rows[0] || null;
    }

    /**
     * Tính tổng doanh số của các ngày trước trong tháng (không tính ngày reportDate).
     */
    async function getMonthlyPreviousRevenue(telegramGroupId, employeeId, reportDate) {
        // Lấy ngày đầu tháng của reportDate
        const d = new Date(reportDate);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const startOfMonth = `${year}-${month}-01`;

        const result = await pool.query(
            `SELECT COALESCE(SUM(tong_ds_hnay), 0) AS prev_total
             FROM telesale_daily_reports
             WHERE telegram_group_id = $1
               AND employee_id = $2
               AND report_date >= $3
               AND report_date < $4`,
            [String(telegramGroupId), employeeId, startOfMonth, reportDate]
        );

        return Number(result.rows[0]?.prev_total || 0);
    }

    /**
     * Tìm nhân viên qua telegram_id.
     */
    async function findEmployeeByTelegramId(telegramId) {
        const result = await pool.query(
            `SELECT id, telegram_id, full_name, role, is_active, pending_telegram_id FROM employees
             WHERE telegram_id = $1 OR pending_telegram_id = $1
             ORDER BY (telegram_id = $1) DESC, (is_active = TRUE) DESC
             LIMIT 1`,
            [String(telegramId)]
        );
        return result.rows[0] || null;
    }

    /**
     * Tìm nhân viên qua họ tên (phục vụ báo cáo văn bản).
     * Hỗ trợ tìm kiếm theo tên gọi/tên rút gọn (ví dụ "Phương" -> "Trịnh Khánh Phương")
     * và ưu tiên thành viên trong nhóm Telesale (telegramGroupId).
     */
    async function findEmployeeByName(name, telegramGroupId = null) {
        if (!name || typeof name !== 'string') return null;
        const cleanName = name.trim();
        if (!cleanName) return null;
        const lowerName = cleanName.toLowerCase();

        // 1. Nếu có telegramGroupId, ưu tiên tìm trong danh sách thành viên của nhóm trước
        if (telegramGroupId) {
            try {
                const groupMembers = await pool.query(
                    `SELECT e.id, e.telegram_id, e.full_name, e.role, e.is_active, e.pending_telegram_id
                     FROM employee_group_memberships egm
                     JOIN employees e ON egm.employee_id = e.id
                     WHERE egm.telegram_group_id = $1
                       AND egm.status = 'ACTIVE'
                       AND e.is_active = TRUE`,
                    [String(telegramGroupId)]
                );

                if (groupMembers.rows.length > 0) {
                    let bestMatch = null;
                    let bestScore = -1;

                    for (const member of groupMembers.rows) {
                        const mName = (member.full_name || '').trim().toLowerCase();
                        let score = -1;

                        if (mName === lowerName) {
                            score = 100; // Khớp chính xác hoàn toàn
                        } else if (mName.endsWith(' ' + lowerName)) {
                            score = 80;  // Khớp tên gọi cuối (ví dụ "Trịnh Khánh Phương" kết thúc bằng " Phương")
                        } else if (lowerName.length >= 2 && mName.includes(lowerName)) {
                            score = 50;  // Chứa từ khóa
                        }

                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = member;
                        }
                    }

                    if (bestMatch && bestScore >= 50) {
                        return bestMatch;
                    }
                }
            } catch (err) {
                console.error('[Telesale] Lỗi tìm nhân sự theo nhóm:', err.message || err);
            }
        }

        // 2. Tìm kiếm trên toàn bộ bảng employees nếu không tìm thấy trong nhóm
        const result = await pool.query(
            `SELECT id, telegram_id, full_name, role, is_active, pending_telegram_id FROM employees
             WHERE is_active = TRUE
               AND (
                   LOWER(TRIM(full_name)) = LOWER(TRIM($1))
                   OR LOWER(TRIM(full_name)) LIKE '% ' || LOWER(TRIM($1))
                   OR (
                       LENGTH(TRIM($1)) >= 2 AND (
                           LOWER(TRIM(full_name)) LIKE '%' || LOWER(TRIM($1)) || '%'
                           OR LOWER(TRIM($1)) LIKE '%' || LOWER(TRIM(full_name)) || '%'
                       )
                   )
               )
             ORDER BY
                 (LOWER(TRIM(full_name)) = LOWER(TRIM($1))) DESC,
                 (LOWER(TRIM(full_name)) LIKE '% ' || LOWER(TRIM($1))) DESC,
                 (role = 'Telesale') DESC,
                 (is_active = TRUE) DESC
             LIMIT 1`,
            [cleanName]
        );
        return result.rows[0] || null;
    }

    /**
     * Tự động liên kết telegram_id vào hồ sơ nhân viên nếu đang để trống.
     */
    async function linkTelegramIdIfEmpty(employeeId, telegramId) {
        if (!employeeId || !telegramId) return;
        try {
            await pool.query(
                `UPDATE employees
                 SET telegram_id = $1, is_active = TRUE
                 WHERE id = $2 AND (telegram_id IS NULL OR telegram_id = '')`,
                [String(telegramId), employeeId]
            );
            // Cập nhật trạng thái yêu cầu đăng ký nếu có
            await pool.query(
                `UPDATE employee_registration_requests
                 SET status = 'ACTIVE', reviewed_at = NOW(), reviewed_by = 'system:auto_link'
                 WHERE (suggested_employee_id = $1 OR target_employee_id = $1 OR telegram_id = $2)
                   AND status = 'PENDING'`,
                [employeeId, String(telegramId)]
            );
        } catch (err) {
            console.error('[Telesale] Lỗi khi liên kết telegram_id vào hồ sơ:', err.message || err);
        }
    }

    /**
     * Tìm hoặc tự động tạo hồ sơ nhân viên Telesale nếu chưa có.
     * Ưu tiên Họ Tên nhân sự để phân biệt độc lập khi nhiều người dùng chung 1 tài khoản Telegram.
     */
    async function findOrCreateEmployee({ fullName, telegramId = null, telegramUsername = '', telegramGroupId = null }) {
        let emp = null;

        // 1. Nếu có họ tên: Tìm theo họ tên
        if (fullName && fullName.trim()) {
            emp = await findEmployeeByName(fullName, telegramGroupId);
            if (emp) {
                // Đảm bảo trạng thái active
                if (emp.is_active === false) {
                    try {
                        await pool.query('UPDATE employees SET is_active = TRUE WHERE id = $1', [emp.id]);
                        emp.is_active = true;
                    } catch (_) {}
                }
                // Đảm bảo membership trong nhóm Telesale
                if (telegramGroupId && emp.id) {
                    try {
                        await pool.query(
                            `INSERT INTO employee_group_memberships (employee_id, telegram_group_id, role, status)
                             VALUES ($1, $2, 'Telesale', 'ACTIVE')
                             ON CONFLICT (employee_id, telegram_group_id) DO NOTHING`,
                            [emp.id, String(telegramGroupId)]
                        );
                    } catch (_) {}
                }
                return emp;
            }
            // Nếu có fullName nhưng chưa có hồ sơ: KHÔNG fallback sang telegramId
            // để tránh nhận nhầm sang người khác khi nhiều nhân sự dùng chung 1 nick Telegram!
        } else if (telegramId) {
            // 2. Chỉ khi hoàn toàn KHÔNG có họ tên mới tìm theo telegramId
            emp = await findEmployeeByTelegramId(telegramId);
            if (emp) {
                if (emp.is_active === false) {
                    try {
                        await pool.query('UPDATE employees SET is_active = TRUE WHERE id = $1', [emp.id]);
                        emp.is_active = true;
                    } catch (_) {}
                }
                if (telegramGroupId && emp.id) {
                    try {
                        await pool.query(
                            `INSERT INTO employee_group_memberships (employee_id, telegram_group_id, role, status)
                             VALUES ($1, $2, 'Telesale', 'ACTIVE')
                             ON CONFLICT (employee_id, telegram_group_id) DO NOTHING`,
                            [emp.id, String(telegramGroupId)]
                        );
                    } catch (_) {}
                }
                return emp;
            }
        }

        // 3. Nếu chưa có trong hệ thống, tự động tạo hồ sơ active ngay theo Họ Tên
        const cleanName = (fullName && fullName.trim()) || `Telesale ${String(telegramId || '').slice(-4)}`;
        const empCode = `EMP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        let internalGroupId = null;
        if (telegramGroupId) {
            try {
                const groupRes = await pool.query(
                    'SELECT id FROM telegram_groups WHERE telegram_group_id = $1 LIMIT 1',
                    [String(telegramGroupId)]
                );
                internalGroupId = groupRes.rows[0]?.id || null;
            } catch (_) {}
        }

        // Kiểm tra xem telegramId này đã bị gắn cho một nhân sự khác trong nhóm chưa (dùng chung tài khoản)
        let insertTelegramId = telegramId ? String(telegramId) : null;
        if (insertTelegramId && internalGroupId) {
            try {
                const existingTg = await pool.query(
                    'SELECT id FROM employees WHERE group_id = $1 AND telegram_id = $2 LIMIT 1',
                    [internalGroupId, insertTelegramId]
                );
                if (existingTg.rows.length > 0) {
                    // Telegram ID này đã có nhân sự khác trong nhóm dùng (dùng chung Telegram)
                    // Đặt null để không vi phạm unique index idx_employees_group_telegram_unique
                    insertTelegramId = null;
                }
            } catch (_) {}
        }

        try {
            const insertRes = await pool.query(
                `INSERT INTO employees
                    (group_id, telegram_group_id, telegram_id, telegram_username,
                     full_name, role, employee_code, department, position, is_active)
                 VALUES ($1, $2, $3, $4, $5, 'Telesale', $6, 'Telesale', 'Nhân viên', TRUE)
                 RETURNING id, telegram_id, full_name, role, is_active`,
                [
                    internalGroupId,
                    telegramGroupId ? String(telegramGroupId) : null,
                    insertTelegramId,
                    telegramUsername || '',
                    cleanName,
                    empCode
                ]
            );
            const created = insertRes.rows[0];

            // Tự động thêm membership vào nhóm Telesale
            if (telegramGroupId && created?.id) {
                try {
                    await pool.query(
                        `INSERT INTO employee_group_memberships (employee_id, telegram_group_id, role, status)
                         VALUES ($1, $2, 'Telesale', 'ACTIVE')
                         ON CONFLICT (employee_id, telegram_group_id) DO NOTHING`,
                        [created.id, String(telegramGroupId)]
                    );
                } catch (_) {}
            }

            return created;
        } catch (insertErr) {
            console.error('[Telesale] Lỗi khi tạo nhanh hồ sơ nhân sự:', insertErr.message || insertErr);
            if (fullName) {
                const fallbackEmp = await findEmployeeByName(fullName, telegramGroupId);
                if (fallbackEmp) return fallbackEmp;
            }
            return {
                id: null,
                telegram_id: telegramId ? String(telegramId) : null,
                full_name: cleanName,
                role: 'Telesale',
                is_active: true
            };
        }
    }

    /**
     * Lấy danh sách dịch vụ đang hoạt động trong hệ thống.
     */
    async function getActiveServices() {
        try {
            const result = await pool.query(
                `SELECT service_code, service_name FROM tk_warehouse_services
                 WHERE is_active = true ORDER BY display_order ASC, service_name ASC`
            );
            return result.rows || [];
        } catch {
            return [];
        }
    }

    /**
     * Tìm tất cả các nhóm đang kích hoạt vai trò 'telesale'.
     */
    async function findActiveTelesaleGroups() {
        const result = await pool.query(
            `SELECT id, telegram_group_id, group_name, bot_role, customer_sheet_id, kpi_sheet_id
             FROM telegram_groups
             WHERE bot_role = 'telesale' AND is_active = TRUE AND COALESCE(is_deleted, FALSE) = FALSE`
        );
        return result.rows;
    }

    /**
     * Lấy danh sách nhân viên đang hoạt động trong nhóm Telesale.
     */
    async function findMembersInTelesaleGroup(telegramGroupId) {
        // Ưu tiên tra cứu qua employee_group_memberships
        const membershipRes = await pool.query(
            `SELECT e.id, e.telegram_id, e.full_name, m.status AS membership_status,
                    m.linked_employee_id, m.linked_telegram_id, m.linked_notes,
                    le.full_name AS linked_employee_name,
                    leg.group_name AS linked_group_name,
                    le.telegram_id AS linked_employee_tg_id
             FROM employee_group_memberships m
             JOIN employees e ON e.id = m.employee_id
             LEFT JOIN employees le ON le.id = m.linked_employee_id
             LEFT JOIN telegram_groups leg ON leg.id = le.group_id
             WHERE m.telegram_group_id = $1
               AND m.status = 'ACTIVE'
               AND COALESCE(m.need_report, TRUE) = TRUE
               AND COALESCE(e.is_active, TRUE) = TRUE
               AND COALESCE(e.need_report, TRUE) = TRUE
               AND e.full_name NOT IN ('Boss', 'Longg', 'test', 'Boss Hỗ Trợ')
             ORDER BY e.full_name ASC`,
            [String(telegramGroupId)]
        );

        if (membershipRes.rows.length > 0) {
            return membershipRes.rows;
        }

        // Dự phòng: nhân viên có telegram_group_id trùng với nhóm
        const fallbackRes = await pool.query(
            `SELECT e.id, e.telegram_id, e.full_name, 'ACTIVE' AS membership_status,
                    NULL::uuid AS linked_employee_id, NULL::varchar AS linked_telegram_id,
                    NULL::text AS linked_notes, NULL::varchar AS linked_employee_name,
                    NULL::varchar AS linked_group_name, NULL::varchar AS linked_employee_tg_id
             FROM employees e
             WHERE e.telegram_group_id = $1 
               AND COALESCE(e.is_active, TRUE) = TRUE
               AND COALESCE(e.need_report, TRUE) = TRUE
               AND e.full_name NOT IN ('Boss', 'Longg', 'test', 'Boss Hỗ Trợ')
             ORDER BY e.full_name ASC`,
            [String(telegramGroupId)]
        );
        return fallbackRes.rows;
    }

    /**
     * Lấy danh sách ID nhân viên đã nộp báo cáo trong ngày.
     */
    async function findReportedEmployeeIds(telegramGroupId, reportDate) {
        const result = await pool.query(
            `SELECT employee_id FROM telesale_daily_reports
             WHERE telegram_group_id = $1 AND report_date = $2`,
            [String(telegramGroupId), reportDate]
        );
        return result.rows.map(r => r.employee_id);
    }

    /**
     * Lấy danh sách telegram_id của nhân viên có lịch OFF trong ngày (từ tk_schedules).
     */
    async function findOffDutyEmployeeIds(dateStr) {
        const result = await pool.query(
            `SELECT user_id FROM tk_schedules
             WHERE date = $1 AND UPPER(shift_type) = 'OFF'`,
            [dateStr]
        );
        return result.rows.map(r => r.user_id);
    }

    /**
     * Lấy danh sách telegram_id của nhân viên có đơn nghỉ phép được duyệt trong ngày.
     */
    async function findOnLeaveEmployeeIds(dateStr) {
        const result = await pool.query(
            `SELECT user_id FROM tk_leave_requests
             WHERE date = $1 AND status IN ('approved', 'pending')`,
            [dateStr]
        );
        return result.rows.map(r => r.user_id);
    }

    /**
     * Kiểm tra xem một nhân sự (theo employeeId hoặc telegramId) hôm nay có đi làm không.
     * Quy tắc:
     * - Trả về false nếu có lịch OFF hoặc có đơn nghỉ phép (đã duyệt/chờ duyệt).
     * - Trả về true nếu có bản ghi điểm danh (tk_check_ins) trong ngày.
     * - Trả về false nếu không có lượt điểm danh nào.
     */
    async function hasEmployeeWorkedToday({ employeeId, telegramId = null, dateStr = null }) {
        if (!employeeId && !telegramId) return false;

        let targetDate = dateStr;
        if (!targetDate) {
            const now = new Date();
            const vnDateObj = new Date(now.getTime() + 7 * 3600 * 1000);
            targetDate = vnDateObj.toISOString().split('T')[0];
        }

        // 1. Kiểm tra lịch OFF
        const offRes = await pool.query(
            `SELECT 1 FROM tk_schedules s
             WHERE (s.user_id = $1 OR ($2::text IS NOT NULL AND EXISTS (
                 SELECT 1 FROM employees e WHERE e.id = s.user_id AND e.telegram_id = $2
             )))
             AND s.date = $3::date AND UPPER(s.shift_type) = 'OFF'
             LIMIT 1`,
            [employeeId || null, telegramId ? String(telegramId) : null, targetDate]
        );
        if (offRes.rows.length > 0) return false;

        // 2. Kiểm tra đơn xin nghỉ phép
        const leaveRes = await pool.query(
            `SELECT 1 FROM tk_leave_requests lr
             WHERE (lr.user_id = $1 OR ($2::text IS NOT NULL AND EXISTS (
                 SELECT 1 FROM employees e WHERE e.id = lr.user_id AND e.telegram_id = $2
             )))
             AND lr.date = $3::date AND lr.status IN ('approved', 'pending')
             LIMIT 1`,
            [employeeId || null, telegramId ? String(telegramId) : null, targetDate]
        );
        if (leaveRes.rows.length > 0) return false;

        // 3. Kiểm tra bản ghi điểm danh tk_check_ins
        const checkinRes = await pool.query(
            `SELECT 1 FROM tk_check_ins ci
             WHERE (ci.user_id = $1 OR ($2::text IS NOT NULL AND EXISTS (
                 SELECT 1 FROM employees e WHERE e.id = ci.user_id AND e.telegram_id = $2
             )))
             AND ci.date = $3::date
             LIMIT 1`,
            [employeeId || null, telegramId ? String(telegramId) : null, targetDate]
        );
        return checkinRes.rows.length > 0;
    }

    /**
     * Lấy chi tiết trạng thái điểm danh hôm nay của một nhân sự.
     */
    async function getEmployeeAttendanceStatus({ employeeId, telegramId = null, dateStr = null }) {
        if (!employeeId && !telegramId) {
            return {
                workedToday: false,
                checkInTime: null,
                shiftType: null,
                isOff: false,
                isOnLeave: false,
                statusBadge: 'NO_ACCOUNT',
                statusLabel: 'Chưa đấu nối tài khoản cá nhân'
            };
        }

        let targetDate = dateStr;
        if (!targetDate) {
            const now = new Date();
            const vnDateObj = new Date(now.getTime() + 7 * 3600 * 1000);
            targetDate = vnDateObj.toISOString().split('T')[0];
        }

        // Lịch làm việc
        const scheduleRes = await pool.query(
            `SELECT shift_type FROM tk_schedules s
             WHERE (s.user_id = $1 OR ($2::text IS NOT NULL AND EXISTS (
                 SELECT 1 FROM employees e WHERE e.id = s.user_id AND e.telegram_id = $2
             )))
             AND s.date = $3::date
             LIMIT 1`,
            [employeeId || null, telegramId ? String(telegramId) : null, targetDate]
        );
        const shiftType = scheduleRes.rows[0]?.shift_type || null;
        const isOff = Boolean(shiftType && shiftType.toUpperCase() === 'OFF');

        // Đơn nghỉ phép
        const leaveRes = await pool.query(
            `SELECT status, reason FROM tk_leave_requests lr
             WHERE (lr.user_id = $1 OR ($2::text IS NOT NULL AND EXISTS (
                 SELECT 1 FROM employees e WHERE e.id = lr.user_id AND e.telegram_id = $2
             )))
             AND lr.date = $3::date AND lr.status IN ('approved', 'pending')
             LIMIT 1`,
            [employeeId || null, telegramId ? String(telegramId) : null, targetDate]
        );
        const isOnLeave = leaveRes.rows.length > 0;

        // Điểm danh
        const checkinRes = await pool.query(
            `SELECT TO_CHAR(MIN(ci.check_in_time) AT TIME ZONE 'Asia/Bangkok', 'HH24:MI:SS') AS first_checkin,
                    COUNT(*)::int AS count
             FROM tk_check_ins ci
             WHERE (ci.user_id = $1 OR ($2::text IS NOT NULL AND EXISTS (
                 SELECT 1 FROM employees e WHERE e.id = ci.user_id AND e.telegram_id = $2
             )))
             AND ci.date = $3::date`,
            [employeeId || null, telegramId ? String(telegramId) : null, targetDate]
        );

        const checkInTime = checkinRes.rows[0]?.first_checkin || null;
        const workedToday = Boolean(checkInTime) && !isOff && !isOnLeave;

        let statusBadge = 'NOT_CHECKED_IN';
        let statusLabel = '⚪ Chưa check-in';

        if (isOnLeave) {
            statusBadge = 'ON_LEAVE';
            statusLabel = '🏖 Đang nghỉ phép';
        } else if (isOff) {
            statusBadge = 'OFF';
            statusLabel = '🏖 Lịch nghỉ ca OFF';
        } else if (workedToday) {
            statusBadge = 'CHECKED_IN';
            statusLabel = `🟢 Đã check-in (${checkInTime.slice(0, 5)})`;
        }

        return {
            workedToday,
            checkInTime,
            shiftType,
            isOff,
            isOnLeave,
            statusBadge,
            statusLabel
        };
    }

    /**
     * Lấy toàn bộ danh sách thành viên Telesale kèm trạng thái đấu nối và điểm danh hôm nay.
     */
    async function getTelesaleMappings(telegramGroupId, dateStr = null) {
        let targetDate = dateStr;
        if (!targetDate) {
            const now = new Date();
            const vnDateObj = new Date(now.getTime() + 7 * 3600 * 1000);
            targetDate = vnDateObj.toISOString().split('T')[0];
        }

        const members = await findMembersInTelesaleGroup(telegramGroupId);
        const reportedIds = new Set(await findReportedEmployeeIds(telegramGroupId, targetDate));

        const reportsRes = await pool.query(
            `SELECT employee_id, tong_ds_hnay, tong_lich, tong_toi_hnay, submitted_at
             FROM telesale_daily_reports
             WHERE telegram_group_id = $1 AND report_date = $2`,
            [String(telegramGroupId), targetDate]
        );
        const reportMap = new Map();
        for (const r of reportsRes.rows) {
            reportMap.set(r.employee_id, r);
        }

        const enrichedMembers = [];
        for (const m of members) {
            // Xác định tài khoản kiểm tra điểm danh: ưu tiên tài khoản đã được đấu nối
            const effectiveEmpId = m.linked_employee_id || m.id;
            const effectiveTgId = m.linked_telegram_id || m.telegram_id;

            const attendance = await getEmployeeAttendanceStatus({
                employeeId: effectiveEmpId,
                telegramId: effectiveTgId,
                dateStr: targetDate
            });

            const hasReportedToday = reportedIds.has(m.id);
            const reportData = reportMap.get(m.id) || null;

            enrichedMembers.push({
                employee_id: m.id,
                full_name: m.full_name,
                telegram_id: m.telegram_id,
                membership_status: m.membership_status,
                linked_employee_id: m.linked_employee_id || null,
                linked_telegram_id: m.linked_telegram_id || null,
                linked_employee_name: m.linked_employee_name || null,
                linked_group_name: m.linked_group_name || null,
                linked_notes: m.linked_notes || '',
                attendance,
                hasReportedToday,
                reportData: reportData ? {
                    tong_ds_hnay: Number(reportData.tong_ds_hnay || 0),
                    tong_lich: Number(reportData.tong_lich || 0),
                    tong_toi_hnay: Number(reportData.tong_toi_hnay || 0),
                    submitted_at: reportData.submitted_at
                } : null
            });
        }

        return enrichedMembers;
    }

    /**
     * Lấy danh sách toàn bộ nhân sự đang hoạt động trong hệ thống để phục vụ đấu nối.
     */
    async function getAvailableCheckinEmployees() {
        const result = await pool.query(
            `SELECT e.id, e.full_name, e.telegram_id, e.employee_code, e.department, e.role,
                    g.group_name, g.telegram_group_id
             FROM employees e
             LEFT JOIN telegram_groups g ON g.id = e.group_id
             WHERE e.is_active = TRUE
               AND e.full_name NOT IN ('Boss', 'Longg', 'test', 'Boss Hỗ Trợ')
             ORDER BY e.full_name ASC`
        );
        return result.rows;
    }

    /**
     * Cập nhật đấu nối tài khoản điểm danh thủ công trên Web Admin.
     */
    async function updateTelesaleMapping({ telegramGroupId, employeeId, linkedEmployeeId, linkedTelegramId = null, notes = '' }) {
        let finalTgId = linkedTelegramId;
        if (linkedEmployeeId && !finalTgId) {
            const empRes = await pool.query(
                `SELECT telegram_id FROM employees WHERE id = $1 LIMIT 1`,
                [linkedEmployeeId]
            );
            finalTgId = empRes.rows[0]?.telegram_id || null;
        }

        const updateRes = await pool.query(
            `UPDATE employee_group_memberships
             SET linked_employee_id = $1,
                 linked_telegram_id = $2,
                 linked_notes = $3,
                 updated_at = NOW()
             WHERE employee_id = $4 AND telegram_group_id = $5
             RETURNING *`,
            [linkedEmployeeId || null, finalTgId, notes || null, employeeId, String(telegramGroupId)]
        );

        if (updateRes.rows.length === 0) {
            const insertRes = await pool.query(
                `INSERT INTO employee_group_memberships (
                    employee_id, telegram_group_id, role, status,
                    linked_employee_id, linked_telegram_id, linked_notes,
                    created_at, updated_at
                 ) VALUES ($1, $2, 'Telesale', 'ACTIVE', $3, $4, $5, NOW(), NOW())
                 RETURNING *`,
                [employeeId, String(telegramGroupId), linkedEmployeeId || null, finalTgId, notes || null]
            );
            return insertRes.rows[0];
        }

        return updateRes.rows[0];
    }

    /**
     * Tự động khớp đấu nối theo tên trùng hoặc tên gọi gần giống.
     */
    async function autoMatchTelesaleMappings(telegramGroupId) {
        const members = await findMembersInTelesaleGroup(telegramGroupId);
        const available = await getAvailableCheckinEmployees();
        let matchedCount = 0;

        for (const m of members) {
            if (m.linked_employee_id) continue; // Đã đấu nối rồi -> giữ nguyên

            const mNameClean = (m.full_name || '').trim().toLowerCase();
            if (!mNameClean) continue;

            // Tìm nhân sự có tên trùng hoặc tên gọi khớp
            let best = null;
            for (const cand of available) {
                // Không tự map vào chính hồ sơ Telesale không có điểm danh
                if (cand.id === m.id && !cand.telegram_id) continue;

                const cNameClean = (cand.full_name || '').trim().toLowerCase();
                if (cNameClean === mNameClean) {
                    best = cand;
                    break;
                }
                if (cNameClean.endsWith(' ' + mNameClean)) {
                    best = cand;
                }
            }

            if (best) {
                await updateTelesaleMapping({
                    telegramGroupId,
                    employeeId: m.id,
                    linkedEmployeeId: best.id,
                    linkedTelegramId: best.telegram_id,
                    notes: 'Hệ thống tự động đấu nối theo tên'
                });
                matchedCount++;
            }
        }

        return matchedCount;
    }

    /**
     * Ghi nhận phạt vi phạm muộn nộp báo cáo vào bảng tk_penalties.
     */
    async function createPenalty({ telegramGroupId, employeeId, dateStr, amount = 50000, reason }) {
        // Tìm UUID của nhóm trong telegram_groups
        const groupRes = await pool.query(
            `SELECT id FROM telegram_groups WHERE telegram_group_id = $1 LIMIT 1`,
            [String(telegramGroupId)]
        );
        const internalGroupId = groupRes.rows[0]?.id || null;

        // Tránh ghi phạt trùng cho cùng 1 ngày
        const existRes = await pool.query(
            `SELECT id FROM tk_penalties
             WHERE user_id = $1 AND date = $2 AND violation_type = 'LATE_REPORT' LIMIT 1`,
            [employeeId, dateStr]
        );

        if (existRes.rows.length > 0) {
            return existRes.rows[0];
        }

        const insertRes = await pool.query(
            `INSERT INTO tk_penalties (group_id, user_id, date, violation_type, amount, reason, is_paid)
             VALUES ($1, $2, $3, 'LATE_REPORT', $4, $5, FALSE)
             RETURNING *;`,
            [internalGroupId, employeeId, dateStr, amount, reason || 'Chậm nộp báo cáo Telesale sau 19:00']
        );
        return insertRes.rows[0];
    }

    /**
     * Lấy tổng kết các báo cáo trong ngày của cả nhóm.
     */
    async function getDailyGroupSummary(telegramGroupId, reportDate) {
        const result = await pool.query(
            `SELECT r.*, e.full_name
             FROM telesale_daily_reports r
             JOIN employees e ON e.id = r.employee_id
             WHERE r.telegram_group_id = $1 AND r.report_date = $2
             ORDER BY r.tong_ds_hnay DESC, r.submitted_at ASC`,
            [String(telegramGroupId), reportDate]
        );

        const rows = result.rows;
        const totals = rows.reduce((acc, row) => {
            acc.so_nhan += Number(row.so_nhan || 0);
            acc.tong_vang += Number(row.so_trung_knc_vang || 0);
            acc.tong_lich += Number(row.tong_lich || 0);
            acc.tong_toi += Number(row.tong_toi_hnay || 0);
            acc.tong_bong += Number(row.tong_bong_hnay || 0);
            acc.lich_ngay_mai += Number(row.lich_ngay_mai || 0);
            acc.tong_ds += Number(row.tong_ds_hnay || 0);
            return acc;
        }, { so_nhan: 0, tong_vang: 0, tong_lich: 0, tong_toi: 0, tong_bong: 0, lich_ngay_mai: 0, tong_ds: 0 });

        return {
            reports: rows,
            totals
        };
    }

    return {
        upsertDailyReport,
        getDailyReport,
        getMonthlyPreviousRevenue,
        findEmployeeByTelegramId,
        findEmployeeByName,
        findOrCreateEmployee,
        linkTelegramIdIfEmpty,
        findActiveTelesaleGroups,
        findMembersInTelesaleGroup,
        findReportedEmployeeIds,
        findOffDutyEmployeeIds,
        findOnLeaveEmployeeIds,
        createPenalty,
        getDailyGroupSummary,
        getActiveServices,
        hasEmployeeWorkedToday,
        getEmployeeAttendanceStatus,
        getTelesaleMappings,
        getAvailableCheckinEmployees,
        updateTelesaleMapping,
        autoMatchTelesaleMappings
    };
}

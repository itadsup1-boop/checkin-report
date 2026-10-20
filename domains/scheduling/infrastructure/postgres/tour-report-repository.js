/**
 * SQL của Báo Công Tour KTV (`ktv_tour_reports`).
 *
 * Tầng infrastructure — tuân thủ kiến trúc tách biệt SQL, giữ dưới 300 dòng.
 */

export function createTourReportRepository({ pool }) {
    /** Thêm một ca báo công tour mới. */
    async function insertTourReport(data) {
        const query = `
            INSERT INTO ktv_tour_reports
            (group_id, message_id, telegram_user_id, reported_by, report_date,
             customer_name, phone, customer_type, doctor, service, ktv_names,
             tour_credit, appointment_id, photo_file_id, photo_url, is_valid,
             status, missing_reason, raw_text, notes)
            VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING *
        `;
        const params = [
            String(data.groupId), data.messageId || null, data.telegramUserId || null, data.reportedBy || null,
            data.reportDate, data.customerName, data.phone || null, data.customerType || 'Khách cũ',
            data.doctor || null, data.service || null, Array.isArray(data.ktvNames) ? data.ktvNames : [],
            data.tourCredit !== undefined ? data.tourCredit : 1.0, data.appointmentId || null,
            data.photoFileId || null, data.photoUrl || null, data.isValid !== undefined ? data.isValid : true,
            data.status || 'VALID', data.missingReason || null, data.rawText || null, data.notes || null
        ];
        const res = await pool.query(query, params);
        return res.rows[0];
    }

    /** Cập nhật sửa đổi thông tin ca tour đã báo. */
    async function updateTourReport(id, data) {
        const query = `
            UPDATE ktv_tour_reports
            SET customer_name = COALESCE($2, customer_name),
                phone = COALESCE($3, phone),
                customer_type = COALESCE($4, customer_type),
                doctor = COALESCE($5, doctor),
                service = COALESCE($6, service),
                ktv_names = COALESCE($7, ktv_names),
                tour_credit = COALESCE($8, tour_credit),
                photo_file_id = COALESCE($9, photo_file_id),
                photo_url = COALESCE($10, photo_url),
                is_valid = COALESCE($11, is_valid),
                status = COALESCE($12, status),
                missing_reason = $13,
                notes = COALESCE($14, notes),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;
        const params = [
            id, data.customerName, data.phone, data.customerType, data.doctor, data.service,
            data.ktvNames, data.tourCredit, data.photoFileId, data.photoUrl,
            data.isValid, data.status, data.missingReason, data.notes
        ];
        const res = await pool.query(query, params);
        return res.rows[0] || null;
    }

    /** Lấy chi tiết một tour theo id. */
    async function findById(id) {
        const res = await pool.query('SELECT * FROM ktv_tour_reports WHERE id = $1', [id]);
        return res.rows[0] || null;
    }

    function getBranchGroupIds(groupId) {
        const g = String(groupId || '');
        if (g === '-1002228375063' || g === '-4807311025') return ['-1002228375063', '-4807311025'];
        if (g === '-4815602983' || g === '-1002148193072') return ['-4815602983', '-1002148193072'];
        return [g];
    }

    /** Danh sách tour gần đây của nhóm (lọc theo người dùng: của ai người đó sửa). */
    async function findRecentTours(groupId, options = {}) {
        const limit = typeof options === 'number' ? options : (options.limit || 30);
        const tgId = options.telegramUserId ? Number(options.telegramUserId) : null;
        const ktv = options.ktvName ? String(options.ktvName).trim() : '';
        const params = [String(groupId), limit];
        let userFilter = '';
        if (tgId || ktv) {
            params.push(tgId || -1, ktv || '');
            userFilter = `AND (($3::bigint > 0 AND telegram_user_id = $3::bigint) OR ($4::text != '' AND ($4::text = ANY(ktv_names) OR array_to_string(ktv_names, ',') ILIKE '%' || $4::text || '%')))`;
        }
        const query = `
            SELECT id, group_id, report_date, customer_name, phone, customer_type,
                   doctor, service, ktv_names, tour_credit, photo_url, notes, is_valid, status,
                   telegram_user_id, created_at
            FROM ktv_tour_reports
            WHERE group_id = $1 ${userFilter}
            ORDER BY report_date DESC, id DESC
            LIMIT $2
        `;
        const res = await pool.query(query, params);
        return res.rows;
    }

    /** Kiểm tra xem khách đã được báo tour cùng ngày và cùng dịch vụ trong nhóm chưa. */
    async function findDuplicateToday(groupId, reportDate, phone, service) {
        if (!phone) return null;
        const query = `SELECT id, customer_name, phone, service, ktv_names, report_date FROM ktv_tour_reports WHERE group_id = $1 AND report_date = $2::date AND phone = $3 AND is_valid = TRUE AND status = 'VALID' AND ($4::text IS NULL OR service = $4::text) LIMIT 1`;
        const res = await pool.query(query, [String(groupId), reportDate, String(phone), service || null]);
        return res.rows[0] || null;
    }

    /** Tìm ca tour đang thiếu ảnh/chờ bổ sung theo message_id gốc. */
    async function findPendingByMessageId(groupId, replyMessageId) {
        const query = `SELECT * FROM ktv_tour_reports WHERE group_id = $1 AND message_id = $2 AND is_valid = FALSE ORDER BY id DESC LIMIT 1`;
        const res = await pool.query(query, [String(groupId), replyMessageId]);
        return res.rows[0] || null;
    }

    /** Lấy gợi ý khách đã đặt lịch trong ngày hôm nay từ `customer_appointments`. */
    async function getTodayAppointmentSuggestions(groupId, dateStr) {
        const targetGroups = getBranchGroupIds(groupId);
        const query = `
            SELECT id, customer_name, phone, service, sessions, session_type, doctor, nurse, appointment_time, status
            FROM customer_appointments
            WHERE group_id = ANY($1::text[])
              AND (DATE(appointment_time AT TIME ZONE 'Asia/Ho_Chi_Minh') = $2::date OR DATE(appointment_time) = $2::date)
              AND status != 'CANCELLED'
            ORDER BY appointment_time ASC
        `;
        const res = await pool.query(query, [targetGroups, dateStr]);
        return res.rows;
    }

    /** Lấy danh sách bác sĩ của hệ thống hoặc nhóm để hiển thị dropdown. */
    async function getDoctorList(groupId) {
        const targetGroups = getBranchGroupIds(groupId);
        const query = `
            SELECT DISTINCT full_name as name FROM employees WHERE lower(role) LIKE '%bác sĩ%' OR lower(role) LIKE '%doctor%'
            UNION SELECT DISTINCT doctor as name FROM customer_appointments WHERE doctor IS NOT NULL AND trim(doctor) != '' AND group_id = ANY($1::text[])
            UNION SELECT DISTINCT doctor as name FROM ktv_tour_reports WHERE doctor IS NOT NULL AND trim(doctor) != '' AND group_id = ANY($1::text[])
            ORDER BY name ASC
        `;
        const res = await pool.query(query, [targetGroups]);
        return res.rows.map(r => r.name).filter(Boolean);
    }

    /** Lấy danh sách KTV và thông tin KTV gần nhất của user. */
    async function getKtvList(groupId, telegramId) {
        const g = String(groupId || '');
        let groupFilter = '';
        const params = [];
        if (g === '-1002228375063' || g === '-4807311025') {
            params.push(['-1002228375063', '-4807311025', '-4233999474', '-1002226331591']);
            groupFilter = 'AND telegram_group_id = ANY($1::text[])';
        } else if (g === '-4815602983' || g === '-1002148193072') {
            params.push(['-4815602983', '-1002148193072', '-1002224124601', '-1002251518652', '-1002019033581']);
            groupFilter = 'AND telegram_group_id = ANY($1::text[])';
        }
        const res = await pool.query(`
            SELECT full_name, telegram_id, telegram_username
            FROM employees WHERE is_active = TRUE ${groupFilter}
              AND (lower(role) LIKE '%kỹ thuật%' OR lower(role) LIKE '%ktv%')
            ORDER BY full_name ASC
        `, params);
        const map = new Map();
        for (const r of res.rows) {
            const name = (r.full_name || '').trim().replace(/\s+(ktv|kỹ thuật viên)$/i, '').trim();
            const key = r.telegram_id ? String(r.telegram_id) : name.toLowerCase();
            if (!map.has(key) || name.length > map.get(key).name.length) {
                map.set(key, { name, telegram_id: r.telegram_id, username: r.telegram_username || '' });
            }
        }
        let userLastKtv = '';
        let userEmpName = '';
        if (telegramId && !isNaN(Number(telegramId))) {
            const lastTour = await pool.query('SELECT ktv_names[1] as last_ktv FROM ktv_tour_reports WHERE telegram_user_id = $1 ORDER BY id DESC LIMIT 1', [Number(telegramId)]);
            if (lastTour.rows.length > 0) userLastKtv = lastTour.rows[0].last_ktv || '';
            const emp = await pool.query('SELECT full_name FROM employees WHERE telegram_id = $1 AND is_active = TRUE LIMIT 1', [String(telegramId)]);
            if (emp.rows.length > 0) userEmpName = emp.rows[0].full_name || '';
        }
        return {
            ktvs: Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
            userLastKtv,
            userEmpName
        };
    }


    /** Thống kê công tour cho KTV: Hôm nay, Tháng này, Tổng hoàn thành, và danh sách ca theo ngày. */
    async function getKtvStats(telegramId, ktvName, groupId, dateStr) {
        const searchName = String(ktvName || '').trim();
        const searchId = telegramId ? Number(telegramId) : -1;

        const statsQuery = `
            WITH matched_tours AS (
                SELECT id, report_date, tour_credit, is_valid, status
                FROM ktv_tour_reports
                WHERE group_id = $1
                  AND is_valid = TRUE
                  AND status = 'VALID'
                  AND (
                      telegram_user_id = $2
                      OR ($3 != '' AND $3 = ANY(ktv_names))
                      OR ($3 != '' AND array_to_string(ktv_names, ',') ILIKE '%' || $3 || '%')
                  )
            )
            SELECT
                COALESCE(SUM(CASE WHEN report_date = $4::date THEN tour_credit ELSE 0 END), 0) AS today_credit,
                COALESCE(SUM(CASE WHEN DATE_TRUNC('month', report_date) = DATE_TRUNC('month', $4::date) THEN tour_credit ELSE 0 END), 0) AS month_credit,
                COALESCE(SUM(tour_credit), 0) AS total_credit,
                COALESCE(COUNT(*), 0) AS total_count
            FROM matched_tours
        `;
        const statsRes = await pool.query(statsQuery, [String(groupId), searchId, searchName, dateStr]);

        const listQuery = `
            SELECT id, report_date, customer_name, phone, customer_type, doctor, service,
                   ktv_names, tour_credit, photo_url, status, created_at
            FROM ktv_tour_reports
            WHERE group_id = $1
              AND report_date = $4::date
              AND is_valid = TRUE
              AND status = 'VALID'
              AND (
                  telegram_user_id = $2
                  OR ($3 != '' AND $3 = ANY(ktv_names))
                  OR ($3 != '' AND array_to_string(ktv_names, ',') ILIKE '%' || $3 || '%')
              )
            ORDER BY id DESC
        `;
        const listRes = await pool.query(listQuery, [String(groupId), searchId, searchName, dateStr]);

        const summary = statsRes.rows[0] || {};
        return {
            todayCredit: Number(summary.today_credit || 0),
            monthCredit: Number(summary.month_credit || 0),
            totalCredit: Number(summary.total_credit || 0),
            totalCount: Number(summary.total_count || 0),
            tours: listRes.rows
        };
    }

    /** Tổng hợp số công tour của tất cả KTV trong nhóm theo ngày (dùng cho cron 22:00 hoặc lệnh /tongtour). */
    async function getDailyGroupSummary(groupId, dateStr) {
        const query = `
            SELECT
                ktv_name,
                ROUND(SUM(tour_credit), 2) AS total_credit,
                COUNT(*) AS total_tours
            FROM (
                SELECT UNNEST(ktv_names) AS ktv_name, tour_credit
                FROM ktv_tour_reports
                WHERE group_id = $1
                  AND report_date = $2::date
                  AND is_valid = TRUE
                  AND status = 'VALID'
            ) t
            WHERE trim(ktv_name) != ''
            GROUP BY ktv_name
            ORDER BY total_credit DESC, ktv_name ASC
        `;
        const res = await pool.query(query, [String(groupId), dateStr]);
        const totalTours = res.rows.reduce((sum, row) => sum + Number(row.total_credit || 0), 0);
        return {
            ktvSummaries: res.rows,
            totalTours: Number(totalTours.toFixed(2))
        };
    }

    /** Đánh dấu hoàn tất lịch hẹn tương ứng trong `customer_appointments`. */
    async function markAppointmentCompleted(appointmentId, proofUrl) {
        if (!appointmentId) return;
        await pool.query(
            `UPDATE customer_appointments
             SET status = 'COMPLETED',
                 proof_image = COALESCE(proof_image, $2),
                 is_photo_debt = FALSE,
                 updated_at = NOW()
             WHERE id = $1`,
            [appointmentId, proofUrl || null]
        );
    }

    return {
        insertTourReport,
        updateTourReport,
        findById,
        findRecentTours,
        findDuplicateToday,
        findPendingByMessageId,
        getTodayAppointmentSuggestions,
        getDoctorList,
        getKtvList,
        getKtvStats,
        getDailyGroupSummary,
        markAppointmentCompleted
    };
}

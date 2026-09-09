export function createCompanyHolidayRepository({ pool }) {
    async function list({ year } = {}) {
        const params = [];
        let where = 'WHERE 1 = 1';
        if (year) {
            params.push(Number(year));
            where += ` AND (EXTRACT(YEAR FROM start_date) = $${params.length} OR EXTRACT(YEAR FROM end_date) = $${params.length})`;
        }
        const result = await pool.query(
            `SELECT h.*, h.start_date::text AS start_date, h.end_date::text AS end_date,
                    a.full_name AS created_by_name,
                    COUNT(n.id)::int AS notification_count,
                    COUNT(n.id) FILTER (WHERE n.status = 'SENT')::int AS sent_count,
                    COUNT(n.id) FILTER (WHERE n.status = 'FAILED')::int AS failed_count
             FROM company_holidays h
             LEFT JOIN admin_accounts a ON a.id = h.created_by
             LEFT JOIN company_holiday_notifications n ON n.holiday_id = h.id
             ${where}
             GROUP BY h.id, a.full_name
             ORDER BY h.start_date DESC, h.created_at DESC`,
            params
        );
        return result.rows;
    }

    async function findById(id) {
        const result = await pool.query('SELECT * FROM company_holidays WHERE id = $1', [id]);
        return result.rows[0] || null;
    }

    async function findOverlap({ startDate, endDate, excludeId = null }) {
        const result = await pool.query(
            `SELECT id, name, start_date, end_date FROM company_holidays
             WHERE status = 'SCHEDULED' AND start_date <= $2::date AND end_date >= $1::date
               AND ($3::uuid IS NULL OR id <> $3::uuid)
             LIMIT 1`,
            [startDate, endDate, excludeId]
        );
        return result.rows[0] || null;
    }

    async function create(data) {
        const result = await pool.query(
            `INSERT INTO company_holidays (name, start_date, end_date, note, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [data.name, data.startDate, data.endDate, data.note || null, data.createdBy || null]
        );
        return result.rows[0];
    }

    async function update(id, data) {
        const result = await pool.query(
            `UPDATE company_holidays SET name = $2, start_date = $3, end_date = $4,
                    note = $5, updated_at = NOW(), announcement_sent_at = NULL
             WHERE id = $1 AND status = 'SCHEDULED' RETURNING *`,
            [id, data.name, data.startDate, data.endDate, data.note || null]
        );
        if (result.rows[0]) await pool.query('DELETE FROM company_holiday_notifications WHERE holiday_id = $1', [id]);
        return result.rows[0] || null;
    }

    async function cancel(id) {
        const result = await pool.query(
            `UPDATE company_holidays SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND status = 'SCHEDULED' RETURNING *`, [id]
        );
        return result.rows[0] || null;
    }

    async function isHoliday(date) {
        const result = await pool.query(
            `SELECT id, name, start_date, end_date FROM company_holidays
             WHERE status = 'SCHEDULED' AND $1::date BETWEEN start_date AND end_date
             ORDER BY start_date LIMIT 1`, [date]
        );
        return result.rows[0] || null;
    }

    async function findDueForAnnouncement(date, time) {
        const result = await pool.query(
            `SELECT *, start_date::text AS start_date, end_date::text AS end_date FROM company_holidays
             WHERE status = 'SCHEDULED' AND start_date = $1::date
               AND announcement_time <= $2::time AND announcement_sent_at IS NULL
             ORDER BY created_at`, [date, time]
        );
        return result.rows;
    }

    async function findRecipientGroups() {
        const result = await pool.query(
            `SELECT telegram_group_id, group_name, bot_role FROM telegram_groups
             WHERE bot_role IN ('timekeep', 'report', 'report_tour')
               AND is_active = TRUE AND COALESCE(is_deleted, FALSE) = FALSE
             ORDER BY group_name`
        );
        return result.rows;
    }

    async function claimNotification(holidayId, groupId) {
        const result = await pool.query(
             `INSERT INTO company_holiday_notifications (holiday_id, telegram_group_id, status)
             VALUES ($1, $2, 'PENDING')
             ON CONFLICT (holiday_id, telegram_group_id) DO UPDATE SET
                status = 'PENDING', error_message = NULL, updated_at = NOW()
             WHERE company_holiday_notifications.status = 'FAILED'
             RETURNING id`,
            [holidayId, groupId]
        );
        return result.rows[0] || null;
    }

    async function markNotification(id, { status, messageId, error }) {
        await pool.query(
            `UPDATE company_holiday_notifications SET status = $2, telegram_message_id = $3,
                    error_message = $4, sent_at = CASE WHEN $2 = 'SENT' THEN NOW() ELSE sent_at END,
                    updated_at = NOW() WHERE id = $1`,
            [id, status, messageId || null, error || null]
        );
    }

    async function markAnnouncementComplete(id) {
        await pool.query('UPDATE company_holidays SET announcement_sent_at = NOW(), updated_at = NOW() WHERE id = $1', [id]);
    }

    return { list, findById, findOverlap, create, update, cancel, isHoliday, findDueForAnnouncement,
        findRecipientGroups, claimNotification, markNotification, markAnnouncementComplete };
}

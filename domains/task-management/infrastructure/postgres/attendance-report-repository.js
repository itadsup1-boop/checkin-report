export function createAttendanceReportRepository({ pool }) {
    async function listGroups() {
        const result = await pool.query(
            'SELECT id, telegram_group_id, group_name FROM public.telegram_groups ORDER BY group_name ASC, created_at ASC'
        );
        return result.rows;
    }

    async function listAttendanceForDate(groupIds, date) {
        const result = await pool.query(`
            SELECT
                tg.id AS group_id,
                tg.group_name,
                u.id AS user_id,
                u.full_name,
                u.employee_code,
                $2::date AS report_date,
                s.id AS schedule_id,
                ci.id AS checkin_id,
                ci.check_in_time,
                ci.status AS checkin_status,
                COALESCE(p.late_minutes, 0) AS late_minutes,
                COALESCE(p.amount, 0) AS penalty_amount,
                CASE WHEN p.id IS NOT NULL OR ds.result IN ('LATE', 'LATE_NOTIFIED') THEN TRUE ELSE FALSE END AS is_late
            FROM public.employees u
            JOIN public.telegram_groups tg ON tg.telegram_group_id = u.telegram_group_id
            LEFT JOIN public.tk_schedules s ON s.user_id = u.id AND s.date = $2
            LEFT JOIN public.tk_check_ins ci ON ci.user_id = u.id AND ci.date = $2
            LEFT JOIN public.tk_penalties p ON p.user_id = u.id AND p.date = $2 AND p.violation_type = 'LATE'
            LEFT JOIN public.tk_attendance_daily_status ds
                ON ds.group_id = tg.id AND ds.user_id = u.id AND ds.date = $2
            WHERE ($1::uuid[] IS NULL OR tg.id = ANY($1::uuid[]))
              AND u.is_active = TRUE
            ORDER BY tg.group_name ASC, u.full_name ASC
        `, [groupIds, date]);
        return result.rows;
    }

    async function summarizeAttendance(groupIds, fromDate, toDate) {
        const result = await pool.query(`
            WITH active AS (
                SELECT tg.id AS group_id, COUNT(*)::int AS active_employee_count
                FROM public.employees u
                JOIN public.telegram_groups tg ON tg.telegram_group_id = u.telegram_group_id
                WHERE u.is_active = TRUE
                  AND ($1::uuid[] IS NULL OR tg.id = ANY($1::uuid[]))
                GROUP BY tg.id
            ), scheduled AS (
                SELECT tg.id AS group_id,
                       COUNT(s.id)::int AS scheduled_count,
                       COUNT(ci.id)::int AS scheduled_checkin_count,
                       COUNT(*) FILTER (WHERE ci.id IS NULL)::int AS absent_count
                FROM public.tk_schedules s
                JOIN public.employees u ON u.id = s.user_id AND u.is_active = TRUE
                JOIN public.telegram_groups tg ON tg.telegram_group_id = u.telegram_group_id
                LEFT JOIN public.tk_check_ins ci ON ci.user_id = s.user_id AND ci.date = s.date
                WHERE s.date >= $2 AND s.date <= $3
                  AND ($1::uuid[] IS NULL OR tg.id = ANY($1::uuid[]))
                GROUP BY tg.id
            ), checked AS (
                SELECT tg.id AS group_id, COUNT(DISTINCT ci.id)::int AS checkin_count
                FROM public.tk_check_ins ci
                JOIN public.employees u ON u.id = ci.user_id AND u.is_active = TRUE
                JOIN public.telegram_groups tg ON tg.telegram_group_id = u.telegram_group_id
                WHERE ci.date >= $2 AND ci.date <= $3
                  AND ($1::uuid[] IS NULL OR tg.id = ANY($1::uuid[]))
                GROUP BY tg.id
            ), late AS (
                SELECT tg.id AS group_id,
                       COUNT(DISTINCT (p.user_id::text || ':' || p.date::text))::int AS late_count,
                       COALESCE(SUM(p.amount), 0)::int AS penalty_total
                FROM public.tk_penalties p
                JOIN public.employees u ON u.id = p.user_id AND u.is_active = TRUE
                JOIN public.telegram_groups tg ON tg.telegram_group_id = u.telegram_group_id
                WHERE p.date >= $2 AND p.date <= $3
                  AND p.violation_type = 'LATE'
                  AND ($1::uuid[] IS NULL OR tg.id = ANY($1::uuid[]))
                GROUP BY tg.id
            )
            SELECT tg.id AS group_id, tg.group_name,
                   COALESCE(active.active_employee_count, 0)::int AS active_employee_count,
                   COALESCE(scheduled.scheduled_count, 0)::int AS scheduled_count,
                   COALESCE(checked.checkin_count, 0)::int AS checkin_count,
                   COALESCE(scheduled.scheduled_checkin_count, 0)::int AS scheduled_checkin_count,
                   COALESCE(scheduled.absent_count, 0)::int AS absent_count,
                   COALESCE(late.late_count, 0)::int AS late_count,
                   GREATEST(COALESCE(scheduled.scheduled_checkin_count, 0) - COALESCE(late.late_count, 0), 0)::int AS on_time_count,
                   COALESCE(late.penalty_total, 0)::int AS penalty_total
            FROM public.telegram_groups tg
            LEFT JOIN active ON active.group_id = tg.id
            LEFT JOIN scheduled ON scheduled.group_id = tg.id
            LEFT JOIN checked ON checked.group_id = tg.id
            LEFT JOIN late ON late.group_id = tg.id
            WHERE ($1::uuid[] IS NULL OR tg.id = ANY($1::uuid[]))
            ORDER BY tg.group_name ASC
        `, [groupIds, fromDate, toDate]);
        return result.rows;
    }

    async function createSchedule({ managerId, chatId, groupId, frequency, localTime, timezone = 'Asia/Ho_Chi_Minh' }) {
        const result = await pool.query(`
            INSERT INTO ai_management.attendance_report_schedules
                (manager_id, telegram_chat_id, group_id, frequency, local_time, timezone)
            VALUES ($1, $2, $3, $4, $5::time, $6)
            RETURNING *
        `, [String(managerId), String(chatId), groupId, frequency, localTime, timezone]);
        return result.rows[0];
    }

    async function findDueSchedules(date, localTime) {
        const result = await pool.query(`
            SELECT s.*, g.group_name, g.telegram_group_id
            FROM ai_management.attendance_report_schedules s
            JOIN public.telegram_groups g ON g.id = s.group_id
            WHERE s.active = TRUE
              AND s.frequency = 'DAILY'
              AND s.local_time = $2::time
              AND (s.last_sent_on IS NULL OR s.last_sent_on < $1::date)
        `, [date, localTime]);
        return result.rows;
    }

    async function markScheduleSent(id, date) {
        await pool.query(
            'UPDATE ai_management.attendance_report_schedules SET last_sent_on = $2::date, updated_at = NOW() WHERE id = $1',
            [id, date]
        );
    }

    return { listGroups, listAttendanceForDate, summarizeAttendance, createSchedule, findDueSchedules, markScheduleSent };
}

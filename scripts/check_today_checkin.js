import pool from '../packages/database/index.js';

function readArg(name) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : null;
}

const fullName = readArg('name')?.trim();
const telegramGroupId = readArg('group')?.trim() || null;

if (!fullName) {
    console.error('Cách dùng: node scripts/check_today_checkin.js --name "Tên nhân viên" [--group TELEGRAM_GROUP_ID]');
    process.exit(1);
}

try {
    const result = await pool.query(`
        SELECT
            e.full_name,
            e.telegram_id,
            e.telegram_group_id,
            g.group_name,
            (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text AS date,
            s.shift_type,
            CASE
                WHEN s.shift_type IN ('CA_1', 'CA_SANG') THEN COALESCE(gs.shift_1_time::text, '08:00:00')
                WHEN s.shift_type IN ('CA_2', 'CA_CHIEU', 'FULL_DAY') THEN COALESCE(gs.shift_2_time::text, '13:30:00')
                ELSE NULL
            END AS shift_start,
            ci.check_in_count,
            ci.first_check_in,
            ci.last_check_in,
            ds.result AS cron_result,
            ds.reminder_sent_at,
            ds.late_warning_sent_at,
            ds.finalized_at,
            p.late_minutes,
            p.amount AS penalty_amount,
            p.reason AS penalty_reason,
            CASE
                WHEN COALESCE(e.is_active, true) = false THEN 'INACTIVE'
                WHEN COALESCE(e.is_exempt_checkin, false) = true THEN 'EXEMPT'
                WHEN s.id IS NULL THEN 'NO_SCHEDULE'
                WHEN s.shift_type = 'OFF' THEN 'OFF'
                WHEN ds.result = 'ON_TIME' THEN 'ON_TIME'
                WHEN ds.result IN ('LATE', 'LATE_NOTIFIED') OR p.id IS NOT NULL THEN 'LATE'
                WHEN ci.check_in_count > 0 THEN 'CHECKED_IN_PENDING_CRON'
                ELSE 'NOT_CHECKED_IN'
            END AS checkin_status
        FROM employees e
        JOIN telegram_groups g ON g.id = e.group_id
        LEFT JOIN group_settings gs ON gs.telegram_group_id = g.telegram_group_id
        LEFT JOIN tk_schedules s
          ON s.user_id = e.id
         AND s.group_id = g.id
         AND s.date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*)::int AS check_in_count,
                TO_CHAR(MIN(c.check_in_time) AT TIME ZONE 'Asia/Bangkok', 'HH24:MI:SS') AS first_check_in,
                TO_CHAR(MAX(c.check_in_time) AT TIME ZONE 'Asia/Bangkok', 'HH24:MI:SS') AS last_check_in
            FROM tk_check_ins c
            WHERE c.user_id = e.id
              AND c.group_id = g.id
              AND c.date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
        ) ci ON true
        LEFT JOIN tk_attendance_daily_status ds
          ON ds.user_id = e.id
         AND ds.group_id = g.id
         AND ds.date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
        LEFT JOIN tk_penalties p
          ON p.user_id = e.id
         AND p.group_id = g.id
         AND p.date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
         AND p.violation_type = 'LATE'
        WHERE LOWER(TRIM(e.full_name)) = LOWER(TRIM($1))
          AND ($2::text IS NULL OR e.telegram_group_id = $2)
        ORDER BY g.group_name
    `, [fullName, telegramGroupId]);

    if (result.rows.length === 0) {
        console.log('Không tìm thấy nhân sự phù hợp.');
        process.exitCode = 2;
    } else if (result.rows.length > 1 && !telegramGroupId) {
        console.table(result.rows.map(row => ({
            full_name: row.full_name,
            telegram_group_id: row.telegram_group_id,
            group_name: row.group_name,
            status: row.checkin_status
        })));
        console.log('Nhân sự xuất hiện ở nhiều nhóm. Chạy lại với --group TELEGRAM_GROUP_ID để xem chính xác.');
        process.exitCode = 3;
    } else {
        console.table(result.rows);
    }
} catch (error) {
    console.error('Kiểm tra trạng thái check-in thất bại:', error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}

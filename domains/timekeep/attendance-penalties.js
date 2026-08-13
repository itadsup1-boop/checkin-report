const WORKING_SHIFTS = [
    'CA_1',
    'CA_2',
    'CA_SANG',
    'CA_CHIEU',
    'FULL_DAY',
    'HALF_DAY_PM_WORK'
];

const LEAVE_REQUEST_TYPES = ['FULL_DAY', 'HALF_DAY_AM', 'HALF_DAY_PM'];

export const TIMEKEEP_PENALTIES = Object.freeze({
    UNAUTHORIZED_ABSENT: 50000,
    SUDDEN_LEAVE: 100000,
    CONSECUTIVE_LEAVE: 200000
});

function formatVietnameseDate(date) {
    const [year, month, day] = String(date).split('-');
    return `${day}/${month}/${year}`;
}

/**
 * Chốt người không check-in lúc 14:00.
 *
 * Một người chỉ bị chốt khi:
 * - Có lịch làm và lịch đã tồn tại trước 14:00 của ngày đó.
 * - Không có bất kỳ lượt check-in nào.
 * - Không có đơn báo nghỉ còn hiệu lực (PENDING/APPROVED/REJECTED).
 * - Vẫn hoạt động trong đúng nhóm chấm công ở ngày cần xử lý.
 *
 * Hàm này không gửi Telegram. Người gọi quyết định có thông báo hay không, nhờ
 * vậy có thể bổ sung dữ liệu lịch sử lên Sheet mà không phát tin cũ vào nhóm.
 */
export async function finalizeUnauthorizedAbsences({
    pool,
    date,
    requireScheduleBeforeShift = false
}) {
    const candidatesResult = await pool.query(
        `SELECT s.group_id,
                s.user_id,
                s.date::text AS date,
                e.full_name,
                g.telegram_group_id,
                g.group_name
         FROM tk_schedules s
         JOIN employees e ON e.id = s.user_id
         JOIN telegram_groups g ON g.id = s.group_id
         LEFT JOIN group_settings gs ON gs.telegram_group_id = g.telegram_group_id
         LEFT JOIN employee_group_memberships gm
           ON gm.employee_id = e.id
          AND gm.telegram_group_id = g.telegram_group_id
         WHERE s.date = $1::date
           AND s.shift_type = ANY($2::text[])
           AND s.created_at <= (
               ($1::date + CASE
                   WHEN $4::boolean AND s.shift_type IN ('CA_1', 'CA_SANG', 'FULL_DAY')
                       THEN COALESCE(NULLIF(gs.shift_1_time::text, '')::time, TIME '08:00')
                   WHEN $4::boolean AND s.shift_type IN ('CA_2', 'CA_CHIEU')
                       THEN COALESCE(NULLIF(gs.shift_2_time::text, '')::time, TIME '13:30')
                   WHEN $4::boolean AND s.shift_type = 'HALF_DAY_PM_WORK'
                       THEN TIME '13:30'
                   ELSE TIME '14:00'
               END) AT TIME ZONE 'Asia/Bangkok'
           )
           AND g.bot_role = 'timekeep'
           AND g.is_active = TRUE
           AND COALESCE(g.is_deleted, FALSE) = FALSE
           AND g.group_name NOT ILIKE '%test%'
           AND e.is_active = TRUE
           AND COALESCE(e.is_exempt_checkin, FALSE) = FALSE
           AND e.full_name NOT LIKE '/%'
           AND e.full_name <> 'tester'
           AND (
               COALESCE(gm.status, 'ACTIVE') <> 'PAUSED'
               OR s.date < COALESCE(gm.paused_at::date, CURRENT_DATE)
           )
           AND NOT EXISTS (
               SELECT 1
               FROM tk_check_ins c
               WHERE c.group_id = s.group_id
                 AND c.user_id = s.user_id
                 AND c.date = s.date
           )
           AND NOT EXISTS (
               SELECT 1
               FROM tk_attendance_daily_status ds
               WHERE ds.group_id = s.group_id
                 AND ds.user_id = s.user_id
                 AND ds.date = s.date
                 AND ds.result = 'ABSENT'
                 AND ds.finalized_at IS NOT NULL
           )
           AND NOT EXISTS (
               SELECT 1
               FROM tk_leave_requests r
               WHERE r.group_id = s.group_id
                 AND r.user_id = s.user_id
                 AND r.date = s.date
                 AND r.request_type = ANY($3::text[])
                 AND UPPER(COALESCE(r.status, 'PENDING')) <> 'CANCELLED'
           )
         ORDER BY g.group_name, e.full_name`,
        [date, WORKING_SHIFTS, LEAVE_REQUEST_TYPES, requireScheduleBeforeShift]
    );

    const processed = [];
    for (const candidate of candidatesResult.rows) {
        const insertResult = await pool.query(
            `INSERT INTO tk_penalties
                (group_id, user_id, date, violation_type, late_minutes, amount, reason, is_paid)
             VALUES ($1, $2, $3, 'UNAUTHORIZED_ABSENT', 0, $4,
                     'Không check-in và không có đơn báo nghỉ trước 14:00', FALSE)
             ON CONFLICT (group_id, user_id, date, violation_type) DO NOTHING
             RETURNING id`,
            [candidate.group_id, candidate.user_id, candidate.date, TIMEKEEP_PENALTIES.UNAUTHORIZED_ABSENT]
        );

        await pool.query(
            `INSERT INTO tk_attendance_daily_status
                (group_id, user_id, date, result, finalized_at, updated_at)
             VALUES ($1, $2, $3, 'ABSENT', NOW(), NOW())
             ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                result = 'ABSENT',
                finalized_at = COALESCE(tk_attendance_daily_status.finalized_at, NOW()),
                updated_at = NOW()`,
            [candidate.group_id, candidate.user_id, candidate.date]
        );

        const consecutivePenalty = await applyConsecutiveAbsencePenalty({
            pool,
            groupId: candidate.group_id,
            userId: candidate.user_id,
            date: candidate.date
        });

        processed.push({
            ...candidate,
            penaltyInserted: insertResult.rows.length > 0,
            penaltyId: insertResult.rows[0]?.id || null,
            consecutivePenaltyInserted: Boolean(consecutivePenalty?.id),
            consecutivePenaltyId: consecutivePenalty?.id || null
        });
    }

    return processed;
}

async function applyConsecutiveAbsencePenalty({ pool, groupId, userId, date }) {
    const previousResult = await pool.query(
        `SELECT 1
         FROM tk_attendance_daily_status
         WHERE group_id = $1
           AND user_id = $2
           AND date = $3::date - 1
           AND result = 'ABSENT'
         LIMIT 1`,
        [groupId, userId, date]
    );

    if (previousResult.rows.length === 0) return null;

    // Một chuỗi nghỉ 2 ngày trở lên chỉ tạo một án phạt 200.000đ.
    const nearbyPenalty = await pool.query(
        `SELECT id
         FROM tk_penalties
         WHERE group_id = $1
           AND user_id = $2
           AND violation_type = 'CONSECUTIVE_LEAVE'
           AND date BETWEEN $3::date - 1 AND $3::date
         LIMIT 1`,
        [groupId, userId, date]
    );
    if (nearbyPenalty.rows.length > 0) return null;

    const inserted = await pool.query(
        `INSERT INTO tk_penalties
            (group_id, user_id, date, violation_type, late_minutes, amount, reason, is_paid)
         VALUES ($1, $2, $3, 'CONSECUTIVE_LEAVE', 0, $4,
                 'Tự ý nghỉ liên tiếp 2 ngày, không có phê duyệt ngoại lệ', FALSE)
         ON CONFLICT (group_id, user_id, date, violation_type) DO NOTHING
         RETURNING id`,
        [groupId, userId, date, TIMEKEEP_PENALTIES.CONSECUTIVE_LEAVE]
    );
    return inserted.rows[0] || null;
}

/**
 * Áp dụng mức 100.000đ từ lần nghỉ đột xuất thứ hai và 200.000đ nếu đơn vừa
 * duyệt tạo thành hai ngày nghỉ liên tiếp. Dùng chung cho cả Telegram và web.
 */
export async function applyApprovedLeavePenalties({ pool, request }) {
    if (!LEAVE_REQUEST_TYPES.includes(request.request_type)) {
        return { suddenPenaltyId: null, consecutivePenaltyId: null };
    }

    const leaveCountResult = await pool.query(
        `SELECT COUNT(DISTINCT date)::int AS leave_count
         FROM tk_leave_requests
         WHERE user_id = $1
           AND status = 'APPROVED'
           AND request_type = ANY($2::text[])
           AND date >= date_trunc('month', $3::date)::date
           AND date < (date_trunc('month', $3::date) + INTERVAL '1 month')::date`,
        [request.user_id, LEAVE_REQUEST_TYPES, request.date]
    );

    const leaveCount = Number(leaveCountResult.rows[0]?.leave_count || 0);
    let suddenPenaltyId = null;
    if (leaveCount > 1) {
        const suddenInsert = await pool.query(
            `INSERT INTO tk_penalties
                (group_id, user_id, date, violation_type, late_minutes, amount, reason, is_paid)
             VALUES ($1, $2, $3, 'SUDDEN_LEAVE', 0, $4, $5, FALSE)
             ON CONFLICT (group_id, user_id, date, violation_type) DO NOTHING
             RETURNING id`,
            [
                request.group_id,
                request.user_id,
                request.date,
                TIMEKEEP_PENALTIES.SUDDEN_LEAVE,
                `Nghỉ đột xuất lần thứ ${leaveCount} trong tháng`
            ]
        );
        suddenPenaltyId = suddenInsert.rows[0]?.id || null;
    }

    const adjacentLeaveResult = await pool.query(
        `SELECT 1
         FROM tk_leave_requests
         WHERE user_id = $1
           AND status = 'APPROVED'
           AND request_type = ANY($2::text[])
           AND date IN ($3::date - 1, $3::date + 1)
         LIMIT 1`,
        [request.user_id, LEAVE_REQUEST_TYPES, request.date]
    );

    let consecutivePenaltyId = null;
    if (adjacentLeaveResult.rows.length > 0) {
        const nearbyPenalty = await pool.query(
            `SELECT id
             FROM tk_penalties
             WHERE user_id = $1
               AND violation_type = 'CONSECUTIVE_LEAVE'
               AND date BETWEEN $2::date - 1 AND $2::date + 1
             LIMIT 1`,
            [request.user_id, request.date]
        );

        if (nearbyPenalty.rows.length === 0) {
            const consecutiveInsert = await pool.query(
                `INSERT INTO tk_penalties
                    (group_id, user_id, date, violation_type, late_minutes, amount, reason, is_paid)
                 VALUES ($1, $2, $3, 'CONSECUTIVE_LEAVE', 0, $4,
                         'Nghỉ liên tiếp 2 ngày sai quy định', FALSE)
                 ON CONFLICT (group_id, user_id, date, violation_type) DO NOTHING
                 RETURNING id`,
                [request.group_id, request.user_id, request.date, TIMEKEEP_PENALTIES.CONSECUTIVE_LEAVE]
            );
            consecutivePenaltyId = consecutiveInsert.rows[0]?.id || null;
        }
    }

    return { suddenPenaltyId, consecutivePenaltyId };
}

export async function getPendingAbsenceNotifications({ pool, date }) {
    const result = await pool.query(
        `SELECT ds.group_id,
                ds.user_id,
                ds.date::text AS date,
                e.full_name,
                g.telegram_group_id,
                g.group_name
         FROM tk_attendance_daily_status ds
         JOIN employees e ON e.id = ds.user_id
         JOIN telegram_groups g ON g.id = ds.group_id
         LEFT JOIN employee_group_memberships gm
           ON gm.employee_id = e.id
          AND gm.telegram_group_id = g.telegram_group_id
         WHERE ds.date = $1::date
           AND ds.result = 'ABSENT'
           AND ds.absence_notified_at IS NULL
           AND g.bot_role = 'timekeep'
           AND g.is_active = TRUE
           AND COALESCE(g.is_deleted, FALSE) = FALSE
           AND (COALESCE(gm.status, 'ACTIVE') <> 'PAUSED'
                OR ds.date < COALESCE(gm.paused_at::date, CURRENT_DATE))
         ORDER BY g.group_name, e.full_name`,
        [date]
    );
    return result.rows;
}

export async function markAbsenceNotificationsSent({ pool, groupId, userIds, date }) {
    if (!userIds.length) return;
    await pool.query(
        `UPDATE tk_attendance_daily_status
         SET absence_notified_at = COALESCE(absence_notified_at, NOW()),
             updated_at = NOW()
         WHERE group_id = $1
           AND date = $2::date
           AND user_id = ANY($3::uuid[])
           AND result = 'ABSENT'`,
        [groupId, date, userIds]
    );
}

export function groupAbsenceNotifications(rows) {
    const groups = new Map();
    for (const row of rows) {
        const key = String(row.group_id);
        if (!groups.has(key)) {
            groups.set(key, {
                groupId: row.group_id,
                telegramGroupId: row.telegram_group_id,
                groupName: row.group_name,
                date: row.date,
                employees: []
            });
        }
        groups.get(key).employees.push({ userId: row.user_id, fullName: row.full_name });
    }
    return [...groups.values()];
}

export function buildAbsenceNotificationText(group) {
    const names = group.employees.map(employee => `• ${employee.fullName} — phạt 50.000đ`).join('\n');
    const total = group.employees.length * TIMEKEEP_PENALTIES.UNAUTHORIZED_ABSENT;
    return `🚫 <b>THÔNG BÁO NHÂN SỰ KHÔNG CHECK-IN</b>\n\n` +
        `⏰ Đến 14:00 ngày <b>${formatVietnameseDate(group.date)}</b>, các nhân sự sau không check-in và không có đơn báo nghỉ:\n\n` +
        `${names}\n\n` +
        `💰 Tổng tiền phạt: <b>${total.toLocaleString('vi-VN')}đ</b>\n` +
        `<i>Dữ liệu đã được ghi nhận vào bảng chấm công.</i>`;
}

export { WORKING_SHIFTS, LEAVE_REQUEST_TYPES };

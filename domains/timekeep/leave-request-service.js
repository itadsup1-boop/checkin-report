import {
    applyApprovedLeavePenalties,
    finalizeUnauthorizedAbsences
} from './attendance-penalties.js';

export const IMMEDIATE_LEAVE_TYPES = Object.freeze([
    'FULL_DAY',
    'HALF_DAY_AM',
    'HALF_DAY_PM',
    'LATE'
]);

const SCHEDULE_LEAVE_TYPES = new Set(['FULL_DAY', 'HALF_DAY_AM', 'HALF_DAY_PM']);
const AUTO_APPROVER = 'Hệ thống tự động chấp nhận';
const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
});

function toDateKey(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.slice(0, 10);
    }
    return DATE_FORMATTER.format(new Date(value));
}

export function effectiveShiftForRequest(requestType) {
    if (requestType === 'FULL_DAY') return 'OFF';
    if (requestType === 'HALF_DAY_AM') return 'HALF_DAY_PM_WORK';
    if (requestType === 'HALF_DAY_PM') return 'CA_SANG';
    return null;
}

export function snapshotSchedule(row) {
    if (!row) return { existed: false };
    return {
        existed: true,
        groupId: row.group_id,
        shiftType: row.shift_type,
        isLocked: Boolean(row.is_locked),
        proofUrl: row.proof_url || null,
        updatedBy: row.updated_by || null
    };
}

async function restoreSchedule(client, request, snapshot) {
    const date = toDateKey(request.date);
    if (!snapshot?.existed) {
        const appliedShift = effectiveShiftForRequest(request.request_type);
        await client.query(
            `DELETE FROM tk_schedules
             WHERE user_id = $1 AND date = $2
               AND group_id = $3 AND shift_type = $4 AND is_locked = TRUE`,
            [request.user_id, date, request.group_id, appliedShift]
        );
        return;
    }

    await client.query(
        `INSERT INTO tk_schedules
            (group_id, user_id, date, shift_type, is_locked, proof_url, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id, date) DO UPDATE SET
            group_id = EXCLUDED.group_id,
            shift_type = EXCLUDED.shift_type,
            is_locked = EXCLUDED.is_locked,
            proof_url = EXCLUDED.proof_url,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()`,
        [
            snapshot.groupId || request.group_id,
            request.user_id,
            date,
            snapshot.shiftType,
            Boolean(snapshot.isLocked),
            snapshot.proofUrl || null,
            snapshot.updatedBy || null
        ]
    );
}

async function applyScheduleEffect(client, request) {
    const shiftType = effectiveShiftForRequest(request.request_type);
    if (!shiftType) return;

    await client.query(
        `INSERT INTO tk_schedules
            (group_id, user_id, date, shift_type, is_locked, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, TRUE, $5, NOW())
         ON CONFLICT (user_id, date) DO UPDATE SET
            group_id = EXCLUDED.group_id,
            shift_type = EXCLUDED.shift_type,
            is_locked = TRUE,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()`,
        [request.group_id, request.user_id, toDateKey(request.date), shiftType, AUTO_APPROVER]
    );
}

async function removePenaltiesCreatedByAcceptedLeave(client, request) {
    if (!SCHEDULE_LEAVE_TYPES.has(request.request_type)) return [];
    const result = await client.query(
        `DELETE FROM tk_penalties
         WHERE group_id = $1 AND user_id = $2 AND date = $3
           AND violation_type IN ('SUDDEN_LEAVE', 'CONSECUTIVE_LEAVE')
         RETURNING id, violation_type, amount`,
        [request.group_id, request.user_id, request.date]
    );
    return result.rows;
}

async function restoreLatePenaltyAfterRejection(client, request) {
    if (request.request_type !== 'LATE') return [];
    const discountSuffix = ' (Đã giảm 50% do có đơn báo trước)';
    const result = await client.query(
        `UPDATE tk_penalties
         SET amount = amount * 2,
             reason = REPLACE(reason, $4, '')
         WHERE group_id = $1 AND user_id = $2 AND date = $3
           AND violation_type = 'LATE'
           AND amount > 0
           AND reason LIKE '%' || $4 || '%'
         RETURNING id, amount, reason`,
        [request.group_id, request.user_id, request.date, discountSuffix]
    );
    return result.rows;
}

async function restorePreviousAutoAcceptedRequest(client, previousRequest) {
    if (!previousRequest?.auto_accepted || previousRequest.status !== 'APPROVED') return;
    if (SCHEDULE_LEAVE_TYPES.has(previousRequest.request_type)) {
        await restoreSchedule(client, previousRequest, previousRequest.previous_schedule);
        await removePenaltiesCreatedByAcceptedLeave(client, previousRequest);
        await client.query(
            `DELETE FROM tk_attendance_daily_status
             WHERE group_id = $1 AND user_id = $2 AND date = $3 AND result = 'ON_LEAVE'`,
            [previousRequest.group_id, previousRequest.user_id, previousRequest.date]
        );
    }
}

export async function createAutoAcceptedLeaveRequest({
    pool,
    groupId,
    userId,
    requestType,
    lateMinutes = 0,
    date,
    reason,
    proofUrl = null
}) {
    if (!IMMEDIATE_LEAVE_TYPES.includes(requestType)) {
        throw new Error(`Loại đơn không hỗ trợ tự chấp nhận: ${requestType}`);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const previousResult = await client.query(
            `SELECT * FROM tk_leave_requests
             WHERE group_id = $1 AND user_id = $2 AND date = $3
               AND status IN ('PENDING', 'APPROVED', 'REJECTED')
             ORDER BY created_at DESC
             FOR UPDATE`,
            [groupId, userId, date]
        );
        const previousRequest = previousResult.rows[0] || null;
        await restorePreviousAutoAcceptedRequest(client, previousRequest);

        await client.query(
            `UPDATE tk_leave_requests
             SET status = 'CANCELLED'
             WHERE group_id = $1 AND user_id = $2 AND date = $3
               AND status IN ('PENDING', 'APPROVED', 'REJECTED')`,
            [groupId, userId, date]
        );

        const scheduleResult = await client.query(
            `SELECT group_id, shift_type, is_locked, proof_url, updated_by
             FROM tk_schedules
             WHERE user_id = $1 AND date = $2
             FOR UPDATE`,
            [userId, date]
        );
        const previousSchedule = snapshotSchedule(scheduleResult.rows[0] || null);

        const inserted = await client.query(
            `INSERT INTO tk_leave_requests
                (group_id, user_id, request_type, late_minutes, date, reason, proof_url,
                 status, approved_by, auto_accepted, effective_applied_at, previous_schedule)
             VALUES ($1, $2, $3, $4, $5, $6, $7,
                     'APPROVED', $8, TRUE, NOW(), $9::jsonb)
             RETURNING *`,
            [
                groupId, userId, requestType, Number(lateMinutes) || 0, date, reason, proofUrl,
                AUTO_APPROVER, JSON.stringify(previousSchedule)
            ]
        );
        const request = inserted.rows[0];

        let leavePenalties = { suddenPenaltyId: null, consecutivePenaltyId: null };
        if (SCHEDULE_LEAVE_TYPES.has(requestType)) {
            await applyScheduleEffect(client, request);
            await client.query(
                `DELETE FROM tk_penalties
                 WHERE group_id = $1 AND user_id = $2 AND date = $3
                   AND violation_type = 'UNAUTHORIZED_ABSENT'`,
                [groupId, userId, date]
            );
            if (requestType === 'FULL_DAY') {
                await client.query(
                    `INSERT INTO tk_attendance_daily_status
                        (group_id, user_id, date, result, finalized_at, updated_at)
                     VALUES ($1, $2, $3, 'ON_LEAVE', NOW(), NOW())
                     ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                        result = 'ON_LEAVE', finalized_at = NOW(), updated_at = NOW()`,
                    [groupId, userId, date]
                );
            } else if (requestType === 'HALF_DAY_AM') {
                // Bỏ cảnh báo ca sáng để nhân sự vẫn được chấm công cho ca chiều.
                await client.query(
                    `DELETE FROM tk_attendance_daily_status
                     WHERE group_id = $1 AND user_id = $2 AND date = $3
                       AND result = 'LATE_NOTIFIED' AND finalized_at IS NULL`,
                    [groupId, userId, date]
                );
            }
            leavePenalties = await applyApprovedLeavePenalties({ pool: client, request });
        }

        await client.query('COMMIT');
        return { request, leavePenalties };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

function shouldFinalizeAbsence(date, now) {
    const dateKey = toDateKey(date);
    const todayKey = DATE_FORMATTER.format(now);
    if (dateKey < todayKey) return true;
    if (dateKey > todayKey) return false;
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false
    }).format(now));
    return hour >= 14;
}

export async function rejectAutoAcceptedLeaveRequest({ pool, requestId, rejectedBy, now = new Date() }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const requestResult = await client.query(
            'SELECT * FROM tk_leave_requests WHERE id = $1 FOR UPDATE',
            [requestId]
        );
        if (requestResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return { result: 'NOT_FOUND' };
        }

        const request = requestResult.rows[0];
        if (!request.auto_accepted || request.status !== 'APPROVED') {
            await client.query('ROLLBACK');
            return { result: 'NOT_REJECTABLE', request };
        }

        await client.query(
            `UPDATE tk_leave_requests
             SET status = 'REJECTED', approved_by = $2, rejected_at = NOW()
             WHERE id = $1`,
            [requestId, rejectedBy || 'Admin']
        );

        let removedPenalties = [];
        let restoredLatePenalties = [];
        if (SCHEDULE_LEAVE_TYPES.has(request.request_type)) {
            await restoreSchedule(client, request, request.previous_schedule);
            removedPenalties = await removePenaltiesCreatedByAcceptedLeave(client, request);
            await client.query(
                `DELETE FROM tk_attendance_daily_status
                 WHERE group_id = $1 AND user_id = $2 AND date = $3 AND result = 'ON_LEAVE'`,
                [request.group_id, request.user_id, request.date]
            );
            if (shouldFinalizeAbsence(request.date, now)) {
                await finalizeUnauthorizedAbsences({
                    pool: client,
                    date: toDateKey(request.date),
                    groupId: request.group_id,
                    userId: request.user_id
                });
            }
        } else {
            restoredLatePenalties = await restoreLatePenaltyAfterRejection(client, request);
        }

        await client.query('COMMIT');
        return {
            result: 'REJECTED',
            request: { ...request, status: 'REJECTED', approved_by: rejectedBy },
            removedPenalties,
            restoredLatePenalties
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

export { AUTO_APPROVER, SCHEDULE_LEAVE_TYPES };

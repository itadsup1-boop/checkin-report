/**
 * Đơn nghỉ đột xuất tự động chấp nhận (không chờ Admin duyệt): tạo đơn +
 * chuyển ca + tính phạt trong một transaction, và khôi phục chính xác khi bị
 * từ chối sau đó.
 *
 * Xuất hàm rời (không qua factory DI) vì `apps/api/index.js` và
 * `timekeep_bot.js` import trực tiếp các hàm này — giữ nguyên đường nhập để
 * không phải sửa hai nơi đó khi đợt tách này diễn ra.
 */

import { createLeaveRequestRepository } from '../infrastructure/postgres/leave-request-repository.js';
import {
    IMMEDIATE_LEAVE_TYPES, SCHEDULE_LEAVE_TYPES, AUTO_APPROVER,
    toDateKey, effectiveShiftForRequest, snapshotSchedule, shouldFinalizeAbsence
} from '../domain/leave-request-rules.js';
import { applyApprovedLeavePenalties, finalizeUnauthorizedAbsences } from './attendance-penalties.js';

const repository = createLeaveRequestRepository();

async function restorePreviousAutoAcceptedRequest(client, previousRequest) {
    if (!previousRequest?.auto_accepted || previousRequest.status !== 'APPROVED') return;
    if (SCHEDULE_LEAVE_TYPES.has(previousRequest.request_type)) {
        const dateKey = toDateKey(previousRequest.date);
        await repository.restoreSchedule(
            client,
            { group_id: previousRequest.group_id, user_id: previousRequest.user_id, appliedShift: effectiveShiftForRequest(previousRequest.request_type) },
            previousRequest.previous_schedule,
            dateKey
        );
        await repository.removePenaltiesCreatedByAcceptedLeave(client, previousRequest);
        await repository.deleteOnLeaveStatus(client, previousRequest);
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

        const previousRequest = await repository.lockPreviousRequest(client, { group_id: groupId, user_id: userId, date });
        await restorePreviousAutoAcceptedRequest(client, previousRequest);
        await repository.cancelPreviousRequests(client, { group_id: groupId, user_id: userId, date });

        const scheduleRow = await repository.lockCurrentSchedule(client, { user_id: userId, date });
        const previousSchedule = snapshotSchedule(scheduleRow);

        const request = await repository.insertAutoAcceptedRequest(client, {
            group_id: groupId, user_id: userId, requestType, lateMinutes: Number(lateMinutes) || 0, date, reason, proofUrl,
            approvedBy: AUTO_APPROVER, previousSchedule
        });

        let leavePenalties = { suddenPenaltyId: null, consecutivePenaltyId: null };
        if (SCHEDULE_LEAVE_TYPES.has(requestType)) {
            const dateKey = toDateKey(date);
            const shiftType = effectiveShiftForRequest(requestType);
            await repository.applyScheduleEffect(client, { group_id: groupId, user_id: userId, dateKey, shiftType, updatedBy: AUTO_APPROVER });
            await repository.deleteUnauthorizedAbsentPenalty(client, { group_id: groupId, user_id: userId, date });

            if (requestType === 'FULL_DAY') {
                await repository.upsertAttendanceStatusOnLeave(client, { group_id: groupId, user_id: userId, date });
            } else if (requestType === 'HALF_DAY_AM') {
                await repository.clearMorningLateWarning(client, { group_id: groupId, user_id: userId, date });
            }
            leavePenalties = await applyApprovedLeavePenalties({ pool: client, request });
        } else if (requestType === 'LATE') {
            // Không còn mốc "phải báo trước 30 phút": nếu cron đã chốt phạt
            // trước khi đơn này được tạo (báo sau khi đã chấm công), hồi tố lại
            // mức phạt thay vì để nhân viên chịu nguyên 100%.
            const existingPenalty = await repository.findLatePenaltyForDate(client, { group_id: groupId, user_id: userId, date });
            if (existingPenalty && existingPenalty.amount > 0) {
                const declaredMinutes = Number(lateMinutes) || 0;
                const actualMinutes = Number(existingPenalty.late_minutes) || 0;
                const withinDeclaredWindow = declaredMinutes > 0 && actualMinutes <= declaredMinutes;
                const adjustedAmount = withinDeclaredWindow ? 0 : existingPenalty.amount / 2;
                const suffix = withinDeclaredWindow
                    ? ` (Đã báo trước đi muộn ${declaredMinutes} phút, đến đúng trong thời gian đã báo — miễn phạt, báo sau khi chấm công)`
                    : ' (Đã giảm 50% do có đơn báo trước, dù báo sau khi đã chấm công)';
                await repository.adjustLatePenaltyForLateAnnouncement(client, existingPenalty.id, {
                    amount: adjustedAmount,
                    reason: existingPenalty.reason + suffix
                });
            }
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

export async function rejectAutoAcceptedLeaveRequest({ pool, requestId, rejectedBy, now = new Date() }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const request = await repository.lockRequestById(client, requestId);
        if (!request) {
            await client.query('ROLLBACK');
            return { result: 'NOT_FOUND' };
        }

        if (!request.auto_accepted || request.status !== 'APPROVED') {
            await client.query('ROLLBACK');
            return { result: 'NOT_REJECTABLE', request };
        }

        await repository.markRequestRejected(client, requestId, rejectedBy || 'Admin');

        let removedPenalties = [];
        let restoredLatePenalties = [];
        if (SCHEDULE_LEAVE_TYPES.has(request.request_type)) {
            const dateKey = toDateKey(request.date);
            await repository.restoreSchedule(
                client,
                { group_id: request.group_id, user_id: request.user_id, appliedShift: effectiveShiftForRequest(request.request_type) },
                request.previous_schedule,
                dateKey
            );
            removedPenalties = await repository.removePenaltiesCreatedByAcceptedLeave(client, request);
            await repository.deleteOnLeaveStatus(client, request);

            if (shouldFinalizeAbsence(request.date, now)) {
                await finalizeUnauthorizedAbsences({
                    pool: client, date: dateKey, groupId: request.group_id, userId: request.user_id
                });
            }
        } else {
            const discountSuffix = ' (Đã giảm 50% do có đơn báo trước)';
            restoredLatePenalties = await repository.restoreLatePenaltyAfterRejection(client, request, discountSuffix);
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

export {
    IMMEDIATE_LEAVE_TYPES, AUTO_APPROVER, SCHEDULE_LEAVE_TYPES,
    effectiveShiftForRequest, snapshotSchedule
} from '../domain/leave-request-rules.js';

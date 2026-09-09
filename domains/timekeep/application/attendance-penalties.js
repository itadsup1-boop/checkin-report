/**
 * Phạt vắng mặt: chốt người không check-in, phạt nghỉ đột xuất/liên tiếp, và
 * thông báo vắng chưa gửi.
 *
 * Xuất hàm rời (không qua factory DI) vì `apps/api/index.js` và
 * `leave-request-service.js` import trực tiếp các hàm này, không đi qua
 * `registerTimekeepModule()` — giữ nguyên để hai nơi đó không phải sửa gì khi
 * đợt tách này diễn ra.
 */

import { createPenaltyRepository } from '../infrastructure/postgres/penalty-repository.js';
import { WORKING_SHIFTS, LEAVE_REQUEST_TYPES, TIMEKEEP_PENALTIES } from '../domain/attendance-penalty-rules.js';

const repository = createPenaltyRepository();

async function applyConsecutiveAbsencePenalty(db, { groupId, userId, date }) {
    const hasPriorAbsence = await repository.findPriorDayAbsent(db, { groupId, userId, date });
    if (!hasPriorAbsence) return null;

    // Một chuỗi nghỉ 2 ngày trở lên chỉ tạo một án phạt 200.000đ.
    const nearbyPenalty = await repository.findNearbyConsecutivePenaltyByGroupUser(db, { groupId, userId, date });
    if (nearbyPenalty) return null;

    return repository.insertConsecutiveAbsencePenalty(db, {
        groupId, userId, date,
        amount: TIMEKEEP_PENALTIES.CONSECUTIVE_LEAVE,
        reason: 'Tự ý nghỉ liên tiếp 2 ngày, không có phê duyệt ngoại lệ'
    });
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
    pool: db,
    date,
    requireScheduleBeforeShift = false,
    groupId = null,
    userId = null
}) {
    const candidates = await repository.findAbsenceCandidates(db, {
        date, workingShifts: WORKING_SHIFTS, leaveRequestTypes: LEAVE_REQUEST_TYPES,
        requireScheduleBeforeShift, groupId, userId
    });

    const processed = [];
    for (const candidate of candidates) {
        const penalty = await repository.insertUnauthorizedAbsentPenalty(db, {
            groupId: candidate.group_id, userId: candidate.user_id, date: candidate.date,
            amount: TIMEKEEP_PENALTIES.UNAUTHORIZED_ABSENT
        });

        await repository.upsertAttendanceStatusAbsent(db, {
            groupId: candidate.group_id, userId: candidate.user_id, date: candidate.date
        });

        const consecutivePenalty = await applyConsecutiveAbsencePenalty(db, {
            groupId: candidate.group_id, userId: candidate.user_id, date: candidate.date
        });

        processed.push({
            ...candidate,
            penaltyInserted: Boolean(penalty),
            penaltyId: penalty?.id || null,
            consecutivePenaltyInserted: Boolean(consecutivePenalty?.id),
            consecutivePenaltyId: consecutivePenalty?.id || null
        });
    }

    return processed;
}

/**
 * Áp dụng mức 100.000đ từ lần nghỉ đột xuất thứ hai và 200.000đ nếu đơn vừa
 * duyệt tạo thành hai ngày nghỉ liên tiếp. Dùng chung cho cả Telegram và web.
 */
export async function applyApprovedLeavePenalties({ pool: db, request }) {
    if (!LEAVE_REQUEST_TYPES.includes(request.request_type)) {
        return { suddenPenaltyId: null, consecutivePenaltyId: null };
    }

    const leaveCount = await repository.countApprovedLeaveThisMonth(db, {
        userId: request.user_id, requestTypes: LEAVE_REQUEST_TYPES, date: request.date
    });

    let suddenPenaltyId = null;
    if (leaveCount > 1) {
        const suddenPenalty = await repository.insertSuddenLeavePenalty(db, {
            groupId: request.group_id, userId: request.user_id, date: request.date,
            amount: TIMEKEEP_PENALTIES.SUDDEN_LEAVE,
            reason: `Nghỉ đột xuất lần thứ ${leaveCount} trong tháng`
        });
        suddenPenaltyId = suddenPenalty?.id || null;
    }

    const hasAdjacentLeave = await repository.findAdjacentApprovedLeave(db, {
        userId: request.user_id, requestTypes: LEAVE_REQUEST_TYPES, date: request.date
    });

    let consecutivePenaltyId = null;
    if (hasAdjacentLeave) {
        const nearbyPenalty = await repository.findNearbyConsecutivePenaltyByUser(db, {
            userId: request.user_id, date: request.date
        });
        if (!nearbyPenalty) {
            const consecutivePenalty = await repository.insertConsecutiveAbsencePenalty(db, {
                groupId: request.group_id, userId: request.user_id, date: request.date,
                amount: TIMEKEEP_PENALTIES.CONSECUTIVE_LEAVE,
                reason: 'Nghỉ liên tiếp 2 ngày sai quy định'
            });
            consecutivePenaltyId = consecutivePenalty?.id || null;
        }
    }

    return { suddenPenaltyId, consecutivePenaltyId };
}

export async function getPendingAbsenceNotifications({ pool: db, date }) {
    return repository.findPendingAbsenceNotificationRows(db, date);
}

export async function markAbsenceNotificationsSent({ pool: db, groupId, userIds, date }) {
    return repository.markAbsenceNotificationsSentRows(db, { groupId, userIds, date });
}

export { WORKING_SHIFTS, LEAVE_REQUEST_TYPES, TIMEKEEP_PENALTIES, groupAbsenceNotifications, buildAbsenceNotificationText } from '../domain/attendance-penalty-rules.js';

/**
 * Duyệt/từ chối đơn nghỉ qua nút Telegram, và miễn trừ án phạt nghỉ liên tiếp.
 *
 * Hai luồng đơn khác nhau:
 * - Đơn đã tự động chấp nhận (`auto_accepted`): "Từ chối" phải thu hồi hiệu lực
 *   (khôi phục lịch/phạt) qua `rejectAutoAcceptedLeaveRequest`.
 * - Đơn PENDING kiểu cũ (báo trước, hoặc SCHEDULE_CHANGE >= 2 ngày nghỉ): duyệt/
 *   từ chối trực tiếp, không có gì để khôi phục vì chưa từng có hiệu lực.
 */

import { createLeaveRequestRepository } from '../infrastructure/postgres/leave-request-repository.js';
import { createPenaltyRepository } from '../infrastructure/postgres/penalty-repository.js';
import { rejectAutoAcceptedLeaveRequest } from './leave-request-service.js';
import { applyApprovedLeavePenalties } from './attendance-penalties.js';

const repository = createLeaveRequestRepository();
const penaltyRepository = createPenaltyRepository();

const SCHEDULE_LEAVE_TYPES = ['FULL_DAY', 'HALF_DAY_AM', 'HALF_DAY_PM'];

function shiftForRequestType(requestType) {
    if (requestType === 'HALF_DAY_AM') return 'HALF_DAY_PM_WORK';
    if (requestType === 'HALF_DAY_PM') return 'CA_SANG';
    return 'OFF';
}

function requestTypeLabel(request) {
    if (request.request_type === 'FULL_DAY') return 'Nghỉ cả ngày 🟥';
    if (request.request_type === 'HALF_DAY_AM') return 'Nghỉ nửa ngày (Sáng) 🌅';
    if (request.request_type === 'HALF_DAY_PM') return 'Nghỉ nửa ngày (Chiều) 🌇';
    return `Xin đi muộn (${request.late_minutes} phút) 🟩`;
}

export function createReviewLeaveRequest({ pool, isSystemAdmin, isManager, moment, syncSheets }) {
    async function checkReviewerPermission(clickerId) {
        if (isSystemAdmin(clickerId)) return true;
        return isManager(clickerId);
    }

    async function reviewLeaveRequest({ action, requestId, clickerId, clickerUsername, clickerFirstName }) {
        const isAllowed = await checkReviewerPermission(clickerId);
        if (!isAllowed) {
            return { ok: false, alert: true, message: '⚠️ Bạn không có quyền phê duyệt yêu cầu này!' };
        }

        const request = await repository.findForApproval(pool, requestId);
        if (!request) {
            return { ok: false, alert: true, message: 'Yêu cầu không tồn tại trong hệ thống!' };
        }

        const isAutoReject = action === 'reject' && request.auto_accepted === true && request.status === 'APPROVED';
        if (!isAutoReject && request.status !== 'PENDING') {
            return { ok: false, alert: true, message: `Yêu cầu này đã được xử lý trước đó (Trạng thái: ${request.status})!` };
        }

        const adminName = (await repository.findEmployeeFullNameByTelegramId(pool, clickerId))
            || (clickerUsername ? `@${clickerUsername}` : clickerFirstName);

        const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

        if (isAutoReject) {
            const outcome = await rejectAutoAcceptedLeaveRequest({ pool, requestId, rejectedBy: adminName });
            if (outcome.result !== 'REJECTED') {
                return { ok: false, alert: true, message: 'Đơn này không còn ở trạng thái có thể từ chối!' };
            }
        } else {
            await repository.updateLegacyRequestStatus(pool, requestId, newStatus, adminName);
        }

        let penaltyButtons = [];
        let syncNeeded = isAutoReject;

        if (newStatus === 'APPROVED' && SCHEDULE_LEAVE_TYPES.includes(request.request_type)) {
            const formattedDate = moment(request.date).format('YYYY-MM-DD');
            await repository.upsertApprovedShift(pool, {
                groupId: request.group_id, userId: request.user_id, date: formattedDate,
                shiftType: shiftForRequestType(request.request_type)
            });

            const leavePenalties = await applyApprovedLeavePenalties({ pool, request: { ...request, date: formattedDate } });
            if (leavePenalties.consecutivePenaltyId) {
                penaltyButtons.push([{
                    text: '✅ Miễn phạt nghỉ liên tiếp',
                    callback_data: `excuse_penalty_${leavePenalties.consecutivePenaltyId}`
                }]);
            }
            syncNeeded = true;
        } else if (newStatus === 'APPROVED' && request.request_type === 'SCHEDULE_CHANGE') {
            try {
                const daysToSave = JSON.parse(request.reason);
                for (const day of daysToSave) {
                    await repository.upsertApprovedShift(pool, {
                        groupId: request.group_id, userId: request.user_id,
                        date: moment(day.date).format('YYYY-MM-DD'), shiftType: day.shift_type
                    });
                }
                syncNeeded = true;
            } catch (jsonErr) {
                console.error('[Approve Schedule Change Error] Failed to parse days:', jsonErr);
            }
        }

        const updatedMsg = buildReviewedMessage(request, newStatus, adminName, moment);

        if (syncNeeded) syncSheets().catch(e => console.error('Sync sheet error:', e));

        return {
            ok: true,
            newStatus,
            adminName,
            updatedMsg,
            penaltyButtons,
            employeeTelegramId: request.user_telegram_id,
            notifyText: buildNotifyText(request, newStatus, adminName, moment)
        };
    }

    async function excusePenalty({ penaltyId, clickerId }) {
        const isAllowed = await checkReviewerPermission(clickerId);
        if (!isAllowed) {
            return { ok: false, message: '⚠️ Bạn không có quyền miễn trừ án phạt này!' };
        }

        const adminName = await repository.findEmployeeFullNameByTelegramId(pool, clickerId) || 'Admin';
        await penaltyRepository.excusePenalty(pool, { penaltyId, adminName });
        syncSheets().catch(e => console.error('Sync sheet error:', e));

        return { ok: true, adminName };
    }

    return { reviewLeaveRequest, excusePenalty };
}

function buildReviewedMessage(request, newStatus, adminName, moment) {
    const colorSymbol = newStatus === 'APPROVED' ? '🟢' : '🔴';
    const resultLabel = newStatus === 'APPROVED' ? 'Đã duyệt' : 'Từ chối';

    if (request.request_type === 'SCHEDULE_CHANGE') {
        const startOfWeekFormatted = moment(request.date).format('DD/MM/YYYY');
        const endOfWeekFormatted = moment(request.date).endOf('isoWeek').format('DD/MM/YYYY');
        let offDaysDates = '';
        try {
            const daysToSave = JSON.parse(request.reason);
            offDaysDates = daysToSave.filter(d => d.shift_type === 'OFF').map(d => moment(d.date).format('DD/MM')).join(', ');
        } catch (_) { /* giữ chuỗi rỗng nếu reason không phải JSON hợp lệ */ }

        const statusText = newStatus === 'APPROVED' ? '✅ <b>ĐÃ DUYỆT ĐĂNG KÝ LỊCH TUẦN</b>' : '❌ <b>ĐÃ TỪ CHỐI ĐĂNG KÝ LỊCH TUẦN</b>';
        return `${statusText}\n\n` +
            `👤 <b>Nhân viên:</b> ${request.full_name}\n` +
            `💼 <b>Vị trí:</b> ${request.role}\n` +
            `📅 <b>Tuần đăng ký:</b> ${startOfWeekFormatted} - ${endOfWeekFormatted}\n` +
            `🌴 <b>Các ngày xin nghỉ:</b> ${offDaysDates}\n` +
            `🤝 <b>Trạng thái:</b> ${colorSymbol} ${resultLabel} bởi Admin <b>${adminName}</b>`;
    }

    const statusText = newStatus === 'APPROVED' ? '✅ <b>ĐÃ DUYỆT YÊU CẦU NGHỈ</b>' : '❌ <b>ĐÃ TỪ CHỐI YÊU CẦU NGHỈ</b>';
    const displayDate = moment(request.date).format('DD/MM/YYYY');
    return `${statusText}\n\n` +
        `👤 <b>Nhân viên:</b> ${request.full_name}\n` +
        `💼 <b>Vị trí:</b> ${request.role}\n` +
        `📅 <b>Ngày xin phép:</b> ${displayDate}\n` +
        `📝 <b>Loại yêu cầu:</b> ${requestTypeLabel(request)}\n` +
        `💬 <b>Lý do:</b> ${request.reason}\n` +
        `🤝 <b>Trạng thái:</b> ${colorSymbol} ${resultLabel} bởi Admin <b>${adminName}</b>`;
}

function buildNotifyText(request, newStatus, adminName, moment) {
    const resultLabel = newStatus === 'APPROVED' ? 'Đã được DUYỆT ✅' : 'Bị TỪ CHỐI ❌';
    if (request.request_type === 'SCHEDULE_CHANGE') {
        const startOfWeekFormatted = moment(request.date).format('DD/MM/YYYY');
        const endOfWeekFormatted = moment(request.date).endOf('isoWeek').format('DD/MM/YYYY');
        return `🔔 <b>Kết quả duyệt đăng ký lịch tuần (${startOfWeekFormatted} - ${endOfWeekFormatted}):</b>\n\n` +
            `📊 <b>Kết quả:</b> ${resultLabel}\n👤 <b>Người duyệt:</b> Admin ${adminName}`;
    }
    const displayDate = moment(request.date).format('DD/MM/YYYY');
    return `🔔 <b>Kết quả duyệt đơn xin nghỉ/đi muộn ngày ${displayDate}:</b>\n\n` +
        `📝 <b>Loại:</b> ${requestTypeLabel(request)}\n` +
        `📊 <b>Kết quả:</b> ${resultLabel}\n👤 <b>Người duyệt:</b> Admin ${adminName}`;
}

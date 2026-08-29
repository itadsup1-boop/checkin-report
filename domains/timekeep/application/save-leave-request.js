/**
 * Đơn nghỉ đột xuất/đi muộn từ Mini App — có hiệu lực ngay, Quản lý chỉ có thể
 * từ chối sau đó (xem `application/leave-request-service.js`).
 */

import { IMMEDIATE_LEAVE_TYPES, createAutoAcceptedLeaveRequest } from './leave-request-service.js';

function decodeProofImage(proofImageDataUrl, telegramId, fs, path, uploadDir) {
    if (!proofImageDataUrl) return null;
    const matches = proofImageDataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;

    const buffer = Buffer.from(matches[2], 'base64');
    const ext = matches[1].split('/')[1] || 'png';
    const filename = `urgent_proof_${telegramId}_${Date.now()}.${ext}`;

    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, filename), buffer);
    return `/mini-app/uploads/proofs/${filename}`;
}

function requestTypeName(requestType, lateMinutes) {
    if (requestType === 'HALF_DAY_AM') return 'Nghỉ nửa ngày (Sáng) 🌅';
    if (requestType === 'HALF_DAY_PM') return 'Nghỉ nửa ngày (Chiều) 🌇';
    if (requestType === 'LATE') return `Xin đi muộn (${lateMinutes} phút) 🟩`;
    return 'Nghỉ cả ngày 🟥';
}

export function createSaveLeaveRequest({
    pool, repository, findEmployeeContext, isSystemAdmin, syncSheets,
    fs, path, moment, uploadDir, bot, sendMessageToRoleGroup, publicBaseUrl
}) {
    async function saveLeaveRequest({ telegramId, chatId, requestType, lateMinutes, date, reason, proofImage }) {
        if (!telegramId || !requestType || !date || !reason) {
            return { ok: false, status: 400, message: 'Thiếu thông tin bắt buộc!' };
        }
        if (!IMMEDIATE_LEAVE_TYPES.includes(requestType)) {
            return { ok: false, status: 400, message: 'Loại đơn này không thuộc luồng nghỉ đột xuất hoặc đi muộn.' };
        }

        const user = await findEmployeeContext(telegramId, chatId);
        if (!user) {
            return { ok: false, status: 404, message: 'Nhân sự chưa đăng ký tài khoản! Vui lòng đăng ký trước.' };
        }

        const isAdmin = isSystemAdmin(telegramId) || user.role === 'admin';

        let groupId = user.group_id;
        let telegramGroupId = chatId;
        if (chatId) {
            const group = await repository.findGroupByTelegramGroupId(chatId);
            if (group) {
                if (!isAdmin && user.group_id !== group.id) {
                    return { ok: false, status: 404, message: 'Nhân sự chưa đăng ký tài khoản trong nhóm này!' };
                }
                groupId = group.id;
            } else if (!isAdmin) {
                return { ok: false, status: 404, message: 'Nhóm Telegram này chưa được đăng ký trong hệ thống!' };
            }
        } else {
            telegramGroupId = await repository.findTelegramGroupId(groupId);
        }

        const proofUrl = decodeProofImage(proofImage, telegramId, fs, path, uploadDir);

        // Đơn nghỉ đột xuất/đi muộn có hiệu lực ngay. Lịch cũ được chụp lại trong
        // cùng transaction để có thể khôi phục chính xác nếu quản lý từ chối.
        const autoAccepted = await createAutoAcceptedLeaveRequest({
            pool, groupId, userId: user.id, requestType, lateMinutes, date, reason, proofUrl
        });
        const requestId = autoAccepted.request.id;

        if (telegramGroupId) {
            const displayDate = moment(date).format('DD/MM/YYYY');

            let msg = `✅ <b>ĐƠN ĐÃ ĐƯỢC TỰ ĐỘNG CHẤP NHẬN</b>\n\n` +
                `👤 <b>Nhân viên:</b> ${user.full_name}\n` +
                `💼 <b>Vị trí:</b> ${user.role}\n` +
                `📅 <b>Ngày xin phép:</b> ${displayDate}\n` +
                `📝 <b>Loại yêu cầu:</b> ${requestTypeName(requestType, lateMinutes)}\n` +
                `💬 <b>Lý do:</b> ${reason}\n` +
                `📌 <b>Trạng thái:</b> Có hiệu lực ngay\n`;

            msg += proofUrl
                ? `📸 <b>Minh chứng:</b> <a href="${publicBaseUrl}${proofUrl}">Xem ảnh đính kèm</a>\n`
                : `📸 <b>Minh chứng:</b> Không có\n`;
            msg += `\n------------------------------------------\n<i>Quản lý/Admin chỉ bấm “Từ chối” nếu không chấp nhận đơn này.</i>`;

            const actionRows = [[{ text: 'Từ chối ❌', callback_data: `reject_leave_${requestId}` }]];
            if (autoAccepted.leavePenalties.consecutivePenaltyId) {
                actionRows.push([{
                    text: '✅ Miễn phạt nghỉ liên tiếp',
                    callback_data: `excuse_penalty_${autoAccepted.leavePenalties.consecutivePenaltyId}`
                }]);
            }

            await sendMessageToRoleGroup(bot, telegramGroupId, 'timekeep', msg, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: actionRows }
            }, 'leave_request_notice');
        }

        syncSheets().catch(e => console.error('Sync sheet error:', e));
        return { ok: true, message: 'Đơn đã được chấp nhận và có hiệu lực ngay. Quản lý có thể từ chối trên nhóm.' };
    }

    return { saveLeaveRequest };
}

/**
 * Soạn và gửi tin duyệt "Báo bù công tour" vào nhóm role report_tour.
 *
 * Gửi NGOÀI transaction: Telegram chậm hoặc lỗi thì không được giữ khoá database.
 * Đổi lại phải chấp nhận trạng thái trung gian — xem markStatus ở tầng application.
 */

import { requestTypeLabel, maskPhone } from '../../domain/makeup-rules.js';

/**
 * @param {object} deps
 * @param {Function} deps.escapeHtml
 * @param {Function} deps.sendPhotoToRoleGroup
 */
export function createMakeupNotifier({ bot, escapeHtml, sendPhotoToRoleGroup, moment }) {
    function buildCaption(request) {
        const safe = {
            employee: escapeHtml(request.employeeName),
            customer: escapeHtml(request.customerName),
            phone: escapeHtml(request.phone),
            service: escapeHtml(request.service),
            sessions: escapeHtml(request.sessions),
            sessionType: escapeHtml(request.sessionType || 'Bán'),
            revenue: escapeHtml(request.revenue),
            reason: escapeHtml(request.reason)
        };

        // Hai dòng "Base64:" ở đầu là của bản cũ, image_hasher dựa vào để nhận diện.
        // GIỮ NGUYÊN cả hai dòng — bỏ đi có thể làm hỏng việc dò ảnh trùng.
        return `Base64: ${safe.employee}\n`
            + `Base64: ${safe.employee}\n`
            + '🕘 <b>YÊU CẦU BÁO BÙ CÔNG TOUR</b> 🕘\n\n'
            + `👤 <b>Nhân viên:</b> ${safe.employee}\n`
            + `⏰ <b>Giờ hẹn khách:</b> ${moment(request.appointmentTime).format('HH:mm')}\n`
            + `👤 <b>Khách hàng:</b> ${safe.customer}\n`
            + `📞 <b>SĐT:</b> ${maskPhone(safe.phone)}\n`
            + `💇 <b>Dịch vụ:</b> ${safe.service} (Buổi: ${safe.sessions})\n`
            + `💰 <b>Doanh thu:</b> ${safe.revenue}\n`
            + `📌 <b>Dạng buổi:</b> ${safe.sessionType}\n`
            + `❓ <b>Loại yêu cầu:</b> ${requestTypeLabel(request.requestType)}\n`
            + `📝 <b>Lý do báo bù:</b> ${safe.reason}\n\n`
            + '<i>Sếp hoặc Quản lý vui lòng xem ảnh đính kèm bên dưới và nhấn duyệt:</i>';
    }

    const approvalKeyboard = requestId => ({
        inline_keyboard: [[
            { text: '✅ Duyệt', callback_data: `makeup_app_${requestId}` },
            { text: '❌ Từ chối', callback_data: `makeup_rej_${requestId}` }
        ]]
    });

    /**
     * @returns {Promise<object|null>} tin đã gửi, null nếu Telegram từ chối
     */
    function send({ groupId, requestId, buffer, request }) {
        return sendPhotoToRoleGroup(bot, groupId, 'report_tour', { source: buffer }, {
            caption: buildCaption(request),
            parse_mode: 'HTML',
            reply_markup: approvalKeyboard(requestId)
        }, 'tour_makeup_request_notice');
    }

    return { send, buildCaption };
}

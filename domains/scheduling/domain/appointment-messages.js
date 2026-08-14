/**
 * Nội dung tin nhắn lịch khách gửi vào nhóm.
 *
 * ⚠️ Dữ liệu người dùng (tên khách, dịch vụ…) được ghép thẳng vào HTML, GIỮ
 * NGUYÊN như bản cũ. Tên khách chứa `<` sẽ làm Telegram từ chối cả tin nhắn.
 * Đây là lỗi có sẵn, không phải do đợt tách này; sửa thì phải sửa kèm test vì
 * bọc escape sẽ đổi cách hiển thị dấu & và <.
 */

import { APPOINTMENT_STATUS, parseRevenue } from './appointment-rules.js';

const timeOf = value =>
    new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

const dateOf = value => new Date(value).toLocaleDateString('vi-VN');

/** Các dòng chỉ hiện khi có dữ liệu — bản cũ bỏ hẳn dòng trống. */
function optionalLines(a) {
    return {
        revenue: a.revenue ? `💰 Thu tiền: ${a.revenue}\n` : '',
        sessionType: a.session_type ? `🏷 Dạng buổi: <b>${a.session_type}</b>\n` : '',
        incurred: a.today_incurred ? `📝 Phát sinh: ${a.today_incurred}\n` : '',
        doctor: a.doctor ? `👨‍⚕️ Bác sĩ: ${a.doctor}\n` : '',
        nurse: a.nurse ? `👩‍⚕️ Điều dưỡng: ${a.nurse}\n` : ''
    };
}

/** Báo động khi nhân viên chốt khách đi luôn (`is_urgent`). */
export function buildUrgentAlert(a) {
    const line = optionalLines(a);
    return '🚨 <b>BÁO ĐỘNG LỊCH KHÁCH ĐI LUÔN</b> 🚨\n\n'
        + `⏰ Giờ hẹn: <b>${timeOf(a.appointment_time)}</b>\n`
        + `👤 Khách hàng: <b>${a.customer_name}</b> (SĐT: ${a.phone})\n`
        + `💇 Dịch vụ: ${a.service || ''} - Buổi: ${a.sessions || ''}\n`
        + line.sessionType + line.doctor + line.nurse + line.incurred + line.revenue
        + `💼 Nhân viên chốt: <b>${a.employee_name}</b>\n\n`
        + '👉 <i>KTV vui lòng chuẩn bị đón khách</i>';
}

/** Báo khi nhân viên cập nhật phát sinh cho lịch ĐÃ tới giờ. */
export function buildUpdateReport(a) {
    const line = optionalLines(a);
    return '🚨 <b>BÁO CÁO CẬP NHẬT PHÁT SINH</b> 🚨\n\n'
        + `⏰ Giờ hẹn: <b>${timeOf(a.appointment_time)}</b>\n`
        + `👤 Khách hàng: <b>${a.customer_name}</b> (SĐT: ${a.phone})\n`
        + `💇 Dịch vụ: ${a.service || ''} - Buổi: ${a.sessions || ''}\n`
        + line.sessionType + line.doctor + line.nurse + line.incurred + line.revenue
        + `💼 Nhân viên chốt: <b>${a.employee_name}</b>\n\n`
        + '👉 <i>Bản ghi đã được cập nhật thành công! Vui lòng rep ảnh hoàn thành công tour.</i>';
}

/** Nhắc khi tới đúng giờ hẹn (cron quét mỗi phút). */
export function buildDueReminder(a) {
    const line = optionalLines(a);
    return '🚨 <b>BÁO ĐỘNG LỊCH KHÁCH HÀNG ĐẾN GIỜ</b> 🚨\n\n'
        + `⏰ Giờ hẹn: <b>${timeOf(a.appointment_time)}</b>\n`
        + `👤 Khách hàng: <b>${a.customer_name}</b> (SĐT: ${a.phone})\n`
        + `💇 Dịch vụ: ${a.service} - Buổi: ${a.sessions}\n`
        + line.sessionType + line.incurred + line.doctor + line.nurse + line.revenue
        + `💼 Nhân viên phụ trách: <b>${a.employee_name}</b>\n\n`
        + '👉 <i>Vui lòng chuẩn bị đón khách!</i>';
}

/** Một dòng trong danh sách tổng hợp; `withStatus` chỉ dùng cho bản tổng kết tối. */
function listLine(a, { withStatus = false } = {}) {
    const revenue = a.revenue ? ` - Thu tiền: ${a.revenue}` : '';
    const sessionType = a.session_type ? ` - Dạng buổi: ${a.session_type}` : '';
    const incurred = a.today_incurred ? `\n   └ 📝 Phát sinh: ${a.today_incurred}` : '';

    let status = '';
    if (withStatus) {
        if (a.status === APPOINTMENT_STATUS.ACTIVE) status = ' (Chờ khách)';
        else if (a.status === APPOINTMENT_STATUS.ARRIVED) status = ' (Đã đến)';
        else if (a.status === APPOINTMENT_STATUS.CANCELLED) status = ' (Đã hủy)';
    }

    return `⏰ <b>${timeOf(a.appointment_time)}</b> | Khách: ${a.customer_name} (${a.phone})${status}\n`
        + `   └ NV: ${a.employee_name} - DV: ${a.service} - Buổi: ${a.sessions}${sessionType}${revenue}${incurred}\n\n`;
}

/** 20h02 — lịch của ngày mai. */
export function buildTomorrowReport(appointments, tomorrowStr) {
    let message = `🌅 <b>BÁO CÁO LỊCH KHÁCH HÀNG NGÀY MAI (${tomorrowStr})</b>\n\n`;
    if (appointments.length === 0) {
        return message + '📭 Hiện tại chưa có lịch hẹn khách hàng nào được đặt cho ngày mai.';
    }
    appointments.forEach(a => { message += listLine(a); });
    return message;
}

/** 22h00 — tổng kết lịch trong ngày, kèm trạng thái từng lịch. */
export function buildDailySummary(appointments, todayStr) {
    let message = `🌙 <b>TỔNG KẾT LỊCH KHÁCH HÀNG HÔM NAY (${todayStr})</b>\n\n`;
    if (appointments.length === 0) {
        return message + '📭 Hôm nay không có lịch hẹn khách hàng nào.';
    }
    appointments.forEach(a => { message += listLine(a, { withStatus: true }); });
    return message;
}

/** 00:00 — các lịch chưa đủ điều kiện tính công tour. */
export function buildTourIncomplete(incompleteItems, dateStr) {
    let message = `⚠️ <b>THÔNG BÁO CHƯA ĐỦ CÔNG TOUR — ${dateStr}</b>\n\n`;
    message += `Có <b>${incompleteItems.length}</b> lịch khách thiếu thông tin:\n\n`;
    incompleteItems.forEach(({ item, missingFields }, idx) => {
        message += `${idx + 1}. ❌ <b>Chưa đủ công tour</b>\n`
            + `   Khách: <b>${item.customer_name || 'N/A'}</b> (${item.phone || 'N/A'}) — ${timeOf(item.appointment_time)}\n`
            + `   NV: ${item.employee_name || 'N/A'}\n`
            + `   Thiếu: ${missingFields.join(', ')}\n\n`;
    });
    return message;
}

/** 00:00 — các lịch đủ công, kèm tổng doanh thu. */
export function buildTourValidSummary(validItems, totalRevenue, dateStr) {
    let message = `✅ <b>TỔNG KẾT LỊCH HỢP LỆ — ${dateStr}</b>\n\n`;
    validItems.forEach((item, idx) => {
        const sessionType = item.session_type ? ` | Dạng: ${item.session_type}` : '';
        const incurred = item.today_incurred ? `\n   └ 📝 Phát sinh: ${item.today_incurred}` : '';
        const doctor = item.doctor ? `\n   └ 👨‍⚕️ Bác sĩ: ${item.doctor}` : '';
        const nurse = item.nurse ? `\n   └ 👩‍⚕️ Điều dưỡng: ${item.nurse}` : '';
        message += `${idx + 1}. ✅ <b>${item.customer_name}</b> (${item.phone}) — ${timeOf(item.appointment_time)}\n`
            + `   NV: ${item.employee_name} | DV: ${item.service} | Buổi: ${item.sessions}${sessionType}${incurred}${doctor}${nurse}\n`
            + `   💰 Thu tiền: ${parseRevenue(item.revenue).toLocaleString('vi-VN')}đ\n\n`;
    });
    message += '━━━━━━━━━━━━━━━━\n'
        + `📊 Tổng số lịch đầy đủ: <b>${validItems.length}</b>\n`
        + `💵 Tổng doanh thu ngày: <b>${totalRevenue.toLocaleString('vi-VN')}đ</b>`;
    return message;
}

export const TOUR_EMPTY_MESSAGE = '📋 <i>Hôm qua không có lịch khách nào được ghi nhận.</i>';

/** Tin nhắn sau khi bấm "Đã đến" — kèm nhắc nợ ảnh. */
export function buildArrivedMessage(originalMessage, id) {
    return '✅ <b>ĐÃ ĐẾN</b> ✅\n\n' + originalMessage
        + '\n\n⚠️ <b>LƯU Ý:</b> Bạn đang NỢ 1 ẢNH BẰNG CHỨNG cho khách này!'
        + '\n👉 Hãy vào <b>Bảng Tiện Ích (/app) ➔ Nhiệm Vụ</b> để tải ảnh lên nhé!'
        + `\n\n🆔 Mã Lịch: #${id}`;
}

export function buildCancelledMessage(originalMessage, reason) {
    return `❌ <b>ĐÃ HỦY/ RỜI LỊCH</b> ❌\nLý do: ${reason}\n\n` + originalMessage;
}

export const CANCEL_PROMPT = '\n\n👇 <b>VUI LÒNG CHỌN LÝ DO HỦY:</b>';

/** Đúng chuỗi bản cũ dùng để gỡ lời nhắc (không có thẻ <b>) khi bấm Quay lại. */
export const CANCEL_PROMPT_PLAIN = '\n\n👇 VUI LÒNG CHỌN LÝ DO HỦY:';

/* ---------- Bàn phím ---------- */
/**
 * ⚠️ Các chuỗi `callback_data` dưới đây là HỢP ĐỒNG: tin nhắn cũ trong nhóm vẫn
 * mang đúng nút này. Đổi chuỗi là những tin đó bấm không ăn nữa.
 */

export const arrivalKeyboard = (id, { withArrived = true } = {}) => {
    const row = [];
    if (withArrived) row.push({ text: '✅ Đã đến', callback_data: `arr_${id}` });
    row.push({ text: '❌ Hủy lịch/ Rời lịch', callback_data: `can_${id}` });
    return { inline_keyboard: [row] };
};

/** Bản cũ dùng chữ "Hủy/ Rời lịch" (không có "lịch" ở giữa) ở tin cập nhật. */
export const updateKeyboard = (id, { withArrived = true } = {}) => {
    const row = [];
    if (withArrived) row.push({ text: '✅ Đã đến', callback_data: `arr_${id}` });
    row.push({ text: '❌ Hủy/ Rời lịch', callback_data: `can_${id}` });
    return { inline_keyboard: [row] };
};

export const cancelReasonKeyboard = id => ({
    inline_keyboard: [
        [{ text: '👻 Khách bom lịch', callback_data: `cr_bom_${id}` }],
        [{ text: '📅 Bận đột xuất / Xin dời ngày', callback_data: `cr_ban_${id}` }],
        [{ text: '💸 Chưa đủ tài chính / Chê đắt', callback_data: `cr_tien_${id}` }],
        [{ text: '🏃 Đã qua cơ sở khác', callback_data: `cr_khacspa_${id}` }],
        [{ text: '✍️ Lý do khác (Vào App)', callback_data: `cr_app_${id}` }],
        [{ text: '⬅️ Quay lại', callback_data: `cr_back_${id}` }]
    ]
});

export { timeOf, dateOf };

/**
 * Quy tắc của hồ sơ khách hàng — thuần, không pg/express/telegraf/Google.
 */

/** Hai role được dùng chức năng hồ sơ khách hàng. */
export const CUSTOMER_REPLY_ROLES = ['customer', 'customer_record'];

/** Bot Telegram không tải nổi file lớn hơn mức này — giới hạn của Bot API. */
export const TELEGRAM_BOT_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

/** Số ảnh/video tối đa nhận trong một lần gửi từ Mini App. */
export const MAX_MEDIA_FILES = 20;

/** Giãn cách thử lại khi tải file lên Drive hỏng (phút), theo số lần đã thử. */
export const RETRY_MINUTES = [1, 5, 15, 30];

export class CustomerError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'CustomerError';
        this.status = status;
    }
}

/**
 * Nội dung tin nhắn đăng vào nhóm khi ghi nhận một hồ sơ.
 *
 * Ở chế độ reply, tin này còn là ĐÍCH để nhân viên reply ảnh vào, nên phải kèm
 * mã hồ sơ dạng `CR:<uuid>` — đó là thứ duy nhất giúp bot biết ảnh thuộc hồ sơ nào.
 *
 * @param {Function} escapeHtml bọc dữ liệu người dùng, truyền từ ngoài vào để
 *   tầng này không phải biết cách bot escape
 */
export function buildRecordNotification(data, recordId, { replyMode = false, escapeHtml, displayDate }) {
    const customerTypeDisplay = data.customerType === 'NEW' ? 'Khách mới ☘️' : 'Khách cũ 🔁';

    let message = '☘️ <b>GHI NHẬN THÔNG TIN KHÁCH HÀNG</b> ☘️\n\n'
        + `📅 <b>Ngày ghi nhận:</b> ${displayDate}\n`
        + `👤 <b>Nhân viên báo cáo:</b> ${escapeHtml(data.employeeName)}\n`
        + `👩‍💼 <b>Tư vấn:</b> ${escapeHtml(data.consultant)}\n`
        + `📊 <b>Loại khách:</b> ${customerTypeDisplay}\n`
        + `👤 <b>Tên khách hàng:</b> ${escapeHtml(data.customerName)}\n`
        + `📞 <b>Điện thoại:</b> ${escapeHtml(data.phone)}\n`
        + `📍 <b>Địa chỉ:</b> ${escapeHtml(data.address) || 'Không có'}\n`
        + `🛠️ <b>Dịch vụ:</b> ${escapeHtml(data.service)}\n`
        + `🎁 <b>Tặng kèm:</b> ${escapeHtml(data.gift) || 'Không có'}\n`
        + `💸 <b>Tổng Bill:</b> ${data.billAmount.toLocaleString('vi-VN')}đ\n`
        + `💳 <b>Đã thanh toán:</b> ${data.paidAmount.toLocaleString('vi-VN')}đ\n`
        + `🚨 <b>Còn nợ:</b> ${data.debtAmount.toLocaleString('vi-VN')}đ\n`
        + `🧑‍⚕️ <b>Người thực hiện:</b> ${escapeHtml(data.operator)}\n`
        + `🛡️ <b>Bảo hành:</b> ${escapeHtml(data.warranty) || 'Không có'}`;

    if (replyMode) {
        message += '\n\n📎 <b>GỬI ẢNH/VIDEO BẰNG TELEGRAM</b>\n'
            + 'Reply trực tiếp tin nhắn này rồi gửi ảnh/video của đúng khách hàng. '
            + 'Bot sẽ tiếp nhận từng file và tự đồng bộ Google Drive trong nền.\n'
            + '⚠️ Video cần được Telegram nén xuống dưới 20 MB.\n'
            + `🆔 <b>Mã hồ sơ:</b> <code>CR:${recordId}</code>`;
    }
    return message;
}

/** Đọc mã hồ sơ `CR:<uuid>` từ tin nhắn mà nhân viên đang reply vào. */
export function extractRecordId(message) {
    const match = String(message || '')
        .match(/CR:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return match ? match[1] : null;
}

/** Đuôi file suy ra từ mime; Telegram không phải lúc nào cũng gửi kèm tên file. */
export function inferMediaExtension(mimeType, mediaType) {
    const known = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'video/mp4': '.mp4',
        'video/quicktime': '.mov'
    };
    return known[mimeType] || (mediaType === 'video' ? '.mp4' : '.jpg');
}

/** Nhóm phải đang bật và đúng role hồ sơ khách hàng. */
export function isUsableCustomerGroup(group) {
    return Boolean(group)
        && CUSTOMER_REPLY_ROLES.includes(group.bot_role)
        && group.is_active === true
        && group.is_deleted !== true;
}

export const cleanPhoneForFolder = phone => String(phone || '').replace(/[^0-9+]/g, '');

export const retryDelayMinutes = attempts =>
    RETRY_MINUTES[Math.min(Math.max(attempts - 1, 0), RETRY_MINUTES.length - 1)];

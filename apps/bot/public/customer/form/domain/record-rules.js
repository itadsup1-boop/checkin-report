/**
 * Quy tắc của hồ sơ khách hàng — hàm thuần, không DOM, không mạng.
 *
 * Phần đáng chú ý nhất là cách đọc số tiền: nhân viên gõ "30tr" hoặc "500k" chứ
 * không gõ đủ số 0. Đọc sai một bậc là sai doanh thu, nên logic này tách riêng
 * để đọc và kiểm được.
 */

/** Hai cách nộp ảnh/video minh chứng. */
export const MEDIA_MODES = {
    MINI_APP: 'mini_app',
    TELEGRAM_REPLY: 'telegram_reply'
};

/**
 * Đọc số tiền người dùng gõ tự do.
 *
 *   "30tr" · "30 triệu" · "30m" · "30 củ"   -> 30 000 000
 *   "500k" · "500 nghìn" · "500 lít"        -> 500 000
 *   "1.500.000" · "1,500,000"               -> 1 500 000
 *
 * Bỏ dấu chấm và dấu phẩy TRƯỚC khi lấy số: người Việt dùng dấu chấm làm phân
 * cách nghìn, không phải phân cách thập phân.
 */
export function parseMoney(value) {
    if (!value) return 0;

    const clean = String(value).toLowerCase().replace(/,/g, '').replace(/\./g, '').trim();
    const match = clean.match(/[\d]+/);
    if (!match) return 0;

    let amount = parseInt(match[0], 10);
    if (['tr', 'triệu', 'm', 'củ'].some(unit => clean.includes(unit))) {
        amount *= 1000000;
    } else if (['k', 'nghìn', 'ngàn', 'lít'].some(unit => clean.includes(unit))) {
        amount *= 1000;
    }
    return amount;
}

/** Còn nợ = hóa đơn − đã trả, không bao giờ âm (trả dư vẫn tính là hết nợ). */
export function computeDebt(billText, paidText) {
    return Math.max(0, parseMoney(billText) - parseMoney(paidText));
}

export const formatMoney = amount => Number(amount).toLocaleString('vi-VN');

/**
 * Số điện thoại: cho phép dấu cách, chấm, gạch và dấu cộng vì nhân viên hay
 * chép từ Zalo. Chỉ chặn trường hợp gõ chữ hoặc quá dài.
 */
export const PHONE_PATTERN = /^[0-9+.\s-]{2,20}$/;

export function isValidPhone(phone) {
    return PHONE_PATTERN.test(String(phone || '').trim());
}

/**
 * Kiểm tra trước khi gửi.
 * @returns {{ok:true} | {ok:false, message:string}}
 */
export function checkRecord({ phone, mediaMode, fileCount }) {
    // Chế độ tải trong Mini App bắt buộc có ảnh; chế độ reply thì ảnh gửi sau
    // trong nhóm Telegram nên ở đây chưa có gì để kiểm.
    if (mediaMode === MEDIA_MODES.MINI_APP && fileCount === 0) {
        return {
            ok: false,
            message: '⚠️ Bạn bắt buộc phải chọn tải lên ít nhất một ảnh hoặc video minh chứng!'
        };
    }
    if (!isValidPhone(phone)) {
        return { ok: false, message: '⚠️ Số điện thoại không hợp lệ, vui lòng kiểm tra lại!' };
    }
    return { ok: true };
}

/** Cùng tên và cùng dung lượng thì coi là đã chọn rồi, tránh gửi trùng ảnh. */
export function isDuplicateFile(files, candidate) {
    return files.some(file => file.name === candidate.name && file.size === candidate.size);
}

export const todayLabel = (date = new Date()) => {
    const pad = number => String(number).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
};

export const CUSTOMER_TYPES = [
    { value: 'NEW', label: 'Khách mới' },
    { value: 'OLD', label: 'Khách cũ' }
];

/**
 * Quy tắc của lịch khách — hàm thuần, không DOM, không mạng.
 *
 * Tách riêng vì đây là chỗ dễ sai và khó nhìn ra khi nằm lẫn trong code giao diện:
 * định dạng "số buổi làm" và cách quy đổi giờ hẹn sang ô datetime-local.
 */

/**
 * Kiểm tra ô "Số Buổi Làm".
 *
 * Hợp lệ: để trống · "0" · "<số>/<số>" (liệu trình) · "<số>/Tái khám".
 * Cố ý KHÔNG nhận "2-10" hay "2 10": nhân viên gõ sai định dạng thì Google Sheet
 * bên dưới không tách được buổi, nên chặn ngay từ lúc nhập.
 */
export function validateSessions(value) {
    if (!value) return true;

    const clean = String(value).trim().toLowerCase();
    if (clean === '0') return true;
    if (clean.indexOf('/') === -1) return false;

    const parts = clean.split('/');
    if (parts.length !== 2) return false;

    const left = parts[0].trim();
    const right = parts[1].trim();

    if (!/^\d+$/.test(left)) return false;
    if (/^\d+$/.test(right)) return true;
    return right === 'tái khám' || right === 'tai kham';
}

export const SESSION_HELP =
    'Số Buổi Làm chưa đúng định dạng!\nVí dụ:\n- Liệu trình: 2/10\n- Tái khám: 1/Tái khám';

/* ---------- Ngày giờ ---------- */

const pad = number => String(number).padStart(2, '0');

/** yyyy-mm-dd theo giờ máy, dùng cho <input type="date">. */
export function toDateInput(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayString() {
    return toDateInput(new Date());
}

export function yesterdayString() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return toDateInput(date);
}

/**
 * Quy đổi mốc thời gian sang giá trị <input type="datetime-local">.
 * Dùng giờ ĐỊA PHƯƠNG chứ không phải ISO/UTC — ISO sẽ lệch múi giờ và làm giờ hẹn
 * hiển thị sai 7 tiếng.
 */
export function toDateTimeLocal(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Giờ hiển thị trong danh sách: 09:30 */
export function formatTime(value) {
    return new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(value) {
    return new Date(value).toLocaleDateString('vi-VN');
}

export function formatDateTime(value) {
    return `${formatTime(value)} ${formatDate(value)}`;
}

/* ---------- Trạng thái lịch hẹn ---------- */

/**
 * Lịch còn hiệu lực gồm cả ARRIVED (khách đã đến) — chỉ trạng thái khác hai giá
 * trị này mới coi là đã hủy.
 */
export function isCancelled(item) {
    return item.status !== 'ACTIVE' && item.status !== 'ARRIVED';
}

/** Lịch đã qua giờ và khách chưa đến thì không cho sửa/hủy nữa. */
export function isLocked(item, now = new Date()) {
    return new Date(item.appointment_time) < now && item.status !== 'ARRIVED';
}

/* ---------- Yêu cầu báo bù công tour ---------- */

export const MAKEUP_EXISTING = 'EXISTING_APPOINTMENT';
export const MAKEUP_MISSING = 'MISSING_APPOINTMENT';

/** Các ô bị khoá khi chọn "bổ sung lịch cũ" — dữ liệu phải lấy từ lịch gốc. */
export const MAKEUP_LOCKED_FIELDS = [
    'customerName', 'phone', 'service', 'sessions', 'sessionType', 'revenue', 'appointmentTime'
];

/**
 * Kiểm tra trước khi gửi yêu cầu báo bù.
 * @returns {{ok:true} | {ok:false, message:string}}
 */
export function checkMakeupRequest(form) {
    if (form.request_type === MAKEUP_EXISTING && !form.original_appointment_id) {
        return { ok: false, message: 'Vui lòng chọn lịch hẹn thiếu cần bổ sung!' };
    }

    const required = [
        form.appointment_time, form.customer_name, form.phone, form.service,
        form.sessions, form.revenue, form.reason, form.imageBase64
    ];
    if (required.some(value => !value)) {
        return { ok: false, message: 'Vui lòng điền đầy đủ các trường thông tin và tải ảnh minh chứng!' };
    }
    return { ok: true };
}

/** Bác sĩ / điều dưỡng được nối vào lý do vì bảng yêu cầu bù chưa có cột riêng. */
export function appendStaffToReason(reason, { doctor, nurse }) {
    let text = reason;
    if (doctor) text += `\nBác sĩ: ${doctor}`;
    if (nurse) text += `\nĐiều dưỡng: ${nurse}`;
    return text;
}

/** Nhãn + màu cho trạng thái của một yêu cầu báo bù. */
export function makeupStatusLabel(item) {
    if (item.status === 'APPROVED') {
        let text = 'Đã duyệt';
        if (item.sheet_sync_status === 'SUCCESS') text += ' (Đã đồng bộ Sheet)';
        else if (item.sheet_sync_status === 'FAILED') text += ` (Lỗi Sheet: ${item.sheet_sync_error || 'Unknown'})`;
        else text += ' (Đang chờ đồng bộ Sheet)';
        return { text, tone: 'ok' };
    }
    if (item.status === 'REJECTED') return { text: 'Từ chối', tone: 'bad' };
    if (item.status === 'PENDING_NOTIFICATION') return { text: 'Đang chờ gửi thông báo', tone: 'warn' };
    if (item.status === 'NOTIFICATION_FAILED') return { text: 'Lỗi gửi thông báo', tone: 'bad' };
    return { text: 'Đang chờ', tone: 'warn' };
}

export const requestTypeLabel = type =>
    (type === MAKEUP_EXISTING ? 'Bổ sung lịch cũ' : 'Báo bù lịch mới');

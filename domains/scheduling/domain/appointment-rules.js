/**
 * Quy tắc của lịch khách (bảng `customer_appointments`) — thuần, không pg/express/telegraf.
 */

/** Vòng đời một lịch hẹn. */
export const APPOINTMENT_STATUS = {
    ACTIVE: 'ACTIVE',      // đã đặt, chưa xác nhận
    ARRIVED: 'ARRIVED',    // khách đã đến
    CANCELLED: 'CANCELLED' // hủy hoặc rời lịch
};

/** Hai role nhận thông báo lịch khách. `report` dùng chung, không chỉ `report_tour`. */
export const SCHEDULE_NOTIFY_ROLES = ['report', 'report_tour'];

/** Hai lịch cách nhau dưới 1 tiếng bị coi là trùng khung giờ. */
export const OVERLAP_MINUTES = 59;

/** Lý do hủy chọn nhanh bằng nút; `app` là "lý do khác", phải gõ trong Mini App. */
export const CANCEL_REASONS = {
    bom: 'Khách bom lịch (Không nghe, chặn số)',
    ban: 'Bận đột xuất / Xin dời ngày',
    tien: 'Chưa đủ tài chính / Chê đắt',
    khacspa: 'Đã qua cơ sở khác làm'
};

/**
 * Số buổi làm chỉ nhận dạng `X/Y` hoặc `X/Tái khám`, hoặc để trống, hoặc `0`.
 *
 * Gõ sai định dạng thì tổng hợp công tour cuối ngày đếm sai buổi, nên chặn ngay
 * lúc nhập thay vì sửa sau.
 */
export function isValidSessions(value) {
    if (!value) return true;
    const clean = value.trim().toLowerCase();
    if (clean === '0') return true;
    if (!clean.includes('/')) return false;

    const parts = clean.split('/');
    if (parts.length !== 2) return false;

    const left = parts[0].trim();
    const right = parts[1].trim();
    if (!/^\d+$/.test(left)) return false;
    if (/^\d+$/.test(right)) return true;
    return right === 'tái khám' || right === 'tai kham';
}

/** "500,000đ" → 500000. Nhân viên gõ tiền tự do nên chỉ giữ lại chữ số. */
export function parseRevenue(value) {
    if (!value) return 0;
    const number = parseInt(String(value).replace(/[^\d]/g, ''), 10);
    return Number.isNaN(number) ? 0 : number;
}

/**
 * Một lịch đủ điều kiện tính công tour khi nào.
 *
 * Chạy lúc 00:00 cho lịch của hôm qua. Lịch còn ACTIVE tới lúc đó nghĩa là nhân
 * viên quên xác nhận — vẫn tính là thiếu, không tự đoán hộ.
 *
 * @returns {string[]} danh sách phần còn thiếu; rỗng nghĩa là đủ công
 */
export function findMissingTourFields(item) {
    const missing = [];
    const blank = value => !value || !String(value).trim();

    if (blank(item.customer_name)) missing.push('Tên khách');
    if (blank(item.phone)) missing.push('SĐT');
    if (blank(item.service)) missing.push('Dịch vụ');
    if (blank(item.sessions)) missing.push('Buổi làm');
    if (blank(item.revenue)) missing.push('Thu tiền');
    if (blank(item.session_type)) missing.push('Dạng buổi');

    // Khách đã đến thì bắt buộc có ảnh chứng thực.
    if (item.status === APPOINTMENT_STATUS.ARRIVED && (item.is_photo_debt === true || !item.proof_image)) {
        missing.push('Ảnh chứng thực');
    }
    if (item.status === APPOINTMENT_STATUS.ACTIVE) {
        missing.push('Chưa xác nhận khách đến hoặc hủy lịch');
    }
    return missing;
}

/**
 * Nhóm đặt lịch lấy từ `start_param` khi Mini App mở từ nút trong nhóm.
 * Dạng `schedule_<groupId>` hoặc `scheduleclient_<groupId>`.
 */
export function groupIdFromStartParam(startParam) {
    const value = String(startParam || '');
    if (!value.startsWith('schedule_') && !value.startsWith('scheduleclient_')) return '';
    const parts = value.split('_');
    return parts.length >= 2 ? parts[1] : '';
}

/** `MINI_APP` là giá trị giữ chỗ cũ, không phải nhóm thật. */
export const isRealGroupId = groupId => Boolean(groupId) && groupId !== 'MINI_APP';

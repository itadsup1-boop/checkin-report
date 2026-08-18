/**
 * Quy tắc của chấm công — thuần, không pg/express/telegraf.
 */

/** Bốn ca trực hợp lệ. Giá trị này đi thẳng vào cột tk_schedules.shift_type. */
export const SHIFT_TYPES = ['CA_SANG', 'CA_CHIEU', 'FULL_DAY', 'OFF'];

export const isValidShift = shiftType => SHIFT_TYPES.includes(shiftType);

/** Chỉ Quản lý (hoặc Admin hệ thống) được mở/đóng đăng ký lịch tuần. */
export const SCHEDULE_TOGGLE_ROLES = ['Quản lý', 'Quản lý kho'];

export class TimekeepError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'TimekeepError';
        this.status = status;
    }
}

/**
 * Mã nhân viên tự sinh khi Admin chưa tạo sẵn hồ sơ.
 * Lấy 4 chữ số cuối của mốc thời gian để hai người đăng ký cùng lúc không trùng mã.
 */
export function buildEmployeeCode(telegramId, now = Date.now()) {
    return `EMP-${telegramId}-${String(now).slice(-4)}`;
}

/** Ba trường bắt buộc khi đăng ký; thiếu nhóm thì không biết xếp vào đâu. */
export function checkRegistrationInput({ telegramId, fullName, role, telegramGroupId }) {
    if (!telegramId || !fullName || !role) {
        return { ok: false, message: 'Thiếu thông tin đăng ký bắt buộc!' };
    }
    if (!telegramGroupId) {
        return {
            ok: false,
            message: 'Vui lòng mở Mini App từ liên kết Đăng ký trong nhóm làm việc của bạn để xác định nhóm trực thuộc!'
        };
    }
    return { ok: true };
}

/**
 * Admin dán cả đường dẫn Google Sheet thay vì mã. Cắt lấy mã trong đường dẫn;
 * không phải đường dẫn thì coi như người ta đã dán đúng mã.
 */
export function extractSheetId(input) {
    if (!input) return null;
    const match = String(input).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : String(input).trim();
}

/**
 * Trạng thái chấm công của một nhân sự trong ngày.
 * Thứ tự xét là cố ý: chưa có lịch → nghỉ → chưa check-in → đi muộn → đúng giờ.
 */
export function attendanceStatus({ hasSchedule, shiftType, hasCheckIn, lateMinutes }) {
    if (!hasSchedule) return 'NO_SCHEDULE';
    if (shiftType === 'OFF') return 'OFF';
    if (!hasCheckIn) return 'NOT_CHECKED_IN';
    return lateMinutes > 0 ? 'LATE' : 'ON_TIME';
}

/** Giờ check-in hiển thị dạng HH:mm theo giờ Việt Nam. */
export function formatCheckInTime(value) {
    if (!value) return null;
    return new Date(new Date(value).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

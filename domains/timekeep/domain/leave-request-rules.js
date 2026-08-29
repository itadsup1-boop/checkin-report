/**
 * Quy tắc đơn nghỉ đột xuất tự động chấp nhận: loại đơn nào có hiệu lực ngay,
 * ca áp dụng khi được duyệt, chuẩn hoá mốc ngày, và chụp lại lịch cũ để khôi
 * phục chính xác khi bị từ chối.
 *
 * Thuần — không pg/express/telegraf.
 */

export const IMMEDIATE_LEAVE_TYPES = Object.freeze([
    'FULL_DAY',
    'HALF_DAY_AM',
    'HALF_DAY_PM',
    'LATE'
]);

export const SCHEDULE_LEAVE_TYPES = new Set(['FULL_DAY', 'HALF_DAY_AM', 'HALF_DAY_PM']);
export const AUTO_APPROVER = 'Hệ thống tự động chấp nhận';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
});

export function toDateKey(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.slice(0, 10);
    }
    return DATE_FORMATTER.format(new Date(value));
}

/** Nghỉ cả ngày -> ca OFF; nghỉ nửa ngày sáng/chiều -> đổi sang ca còn lại của ngày đó. */
export function effectiveShiftForRequest(requestType) {
    if (requestType === 'FULL_DAY') return 'OFF';
    if (requestType === 'HALF_DAY_AM') return 'HALF_DAY_PM_WORK';
    if (requestType === 'HALF_DAY_PM') return 'CA_SANG';
    return null;
}

export function snapshotSchedule(row) {
    if (!row) return { existed: false };
    return {
        existed: true,
        groupId: row.group_id,
        shiftType: row.shift_type,
        isLocked: Boolean(row.is_locked),
        proofUrl: row.proof_url || null,
        updatedBy: row.updated_by || null
    };
}

/** Sau 14:00 của đúng ngày nghỉ (hoặc ngày đã qua) mới cần chốt lại vắng không phép khi đơn bị từ chối. */
export function shouldFinalizeAbsence(date, now) {
    const dateKey = toDateKey(date);
    const todayKey = DATE_FORMATTER.format(now);
    if (dateKey < todayKey) return true;
    if (dateKey > todayKey) return false;
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false
    }).format(now));
    return hour >= 14;
}

/**
 * Cụm báo đi muộn nhân viên hay gõ thẳng trong nhóm thay vì mở Mini App. Chỉ
 * bắt cụm ĐỘNG TỪ + muộn/trễ (không bắt "trễ"/"chậm" đứng một mình) để giảm
 * nhận nhầm câu không liên quan.
 */
const LATE_SIGNAL_PHRASES = [
    'đi muộn', 'đến muộn', 'tới muộn',
    'đi trễ', 'đến trễ', 'tới trễ',
    'xin muộn', 'xin trễ', 'báo muộn', 'báo trễ'
];

/** Số đếm viết bằng chữ hay gặp — nhiều người gõ "năm phút" thay vì "5 phút". */
const NUMBER_WORDS = {
    'mười lăm': 15, 'hai mươi': 20, 'ba mươi': 30, 'bốn mươi': 40,
    'năm mươi': 50, 'sáu mươi': 60, 'mười': 10,
    'một': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'năm': 5,
    'sáu': 6, 'bảy': 7, 'tám': 8, 'chín': 9
};

/**
 * Nhận diện tin nhắn tự báo đi muộn và cố trích số phút.
 *
 * KHÔNG tự phân biệt "xin phép" hay "báo cáo" — trong tiếng Việt "xin ..." đã
 * là một hành vi xin phép, không có ranh giới thật giữa hai cách nói. Việc lọc
 * người ngoài hỏi/nhắc hộ (không phải chính nhân viên tự báo) nằm ở tầng gọi
 * hàm này: chỉ gọi khi người GỬI tin nhắn chính là nhân viên đang được nhắc tới.
 *
 * @returns {{matched: boolean, minutes: ?number}} `minutes` null nghĩa là có
 *   tín hiệu đi muộn nhưng không trích được số phút — nơi gọi tự quyết định
 *   giá trị mặc định.
 */
export function parseLateAnnouncement(text) {
    const normalized = (text || '').toLowerCase();
    if (!LATE_SIGNAL_PHRASES.some(phrase => normalized.includes(phrase))) {
        return { matched: false, minutes: null };
    }

    const digitMatch = normalized.match(/(\d+)\s*(phút|p\b|'|min)/);
    if (digitMatch) {
        return { matched: true, minutes: parseInt(digitMatch[1], 10) };
    }

    const wordKeys = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length);
    for (const word of wordKeys) {
        if (normalized.includes(`${word} phút`) || normalized.includes(`${word} p `)) {
            return { matched: true, minutes: NUMBER_WORDS[word] };
        }
    }

    return { matched: true, minutes: null };
}

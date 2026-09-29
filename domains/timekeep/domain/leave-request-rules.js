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
    'xin muộn', 'xin trễ', 'báo muộn', 'báo trễ',
    'vào muộn', 'vào trễ'
];

/** Số đếm viết bằng chữ hay gặp — nhiều người gõ "năm phút" thay vì "5 phút". */
const NUMBER_WORDS = {
    'mười lăm': 15, 'hai mươi': 20, 'ba mươi': 30, 'bốn mươi': 40,
    'năm mươi': 50, 'sáu mươi': 60, 'mười': 10,
    'một': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'năm': 5,
    'sáu': 6, 'bảy': 7, 'tám': 8, 'chín': 9
};

/**
 * Nhận diện tin nhắn tự báo đi muộn hoặc xin vào làm theo mốc giờ đích (vd: 'xin mai 9 rưỡi vào làm').
 *
 * @returns {{matched: boolean, minutes: ?number, targetTime?: string}}
 */
export function parseLateAnnouncement(text, baseShiftHour = 8.5) {
    const normalized = (text || '').toLowerCase();

    // Bỏ qua các câu hỏi/khiếu nại, xem lại công/phạt hoặc nói về quá khứ (không phải đơn mới)
    const isPastOrInquiry = /(?:xem lại|check lại|kiểm tra lại|sao lại|tại sao|vẫn trừ|bị trừ|vẫn bị trừ|trừ như bt|đã xin|xin rồi|sao vẫn)/i.test(normalized)
        || (/(?:hôm qua|hôm kia|hôm nọ|hôm trước|ngày hôm qua|hôm rồi)/i.test(normalized) && !normalized.includes('hôm nay') && !normalized.includes('mai'));
    if (isPastOrInquiry) {
        return { matched: false, minutes: null };
    }

    // 1. Kiểm tra các mẫu câu thời lượng cụ thể trước (phút / tiếng / giờ)
    const hasLatePhrase = LATE_SIGNAL_PHRASES.some(phrase => normalized.includes(phrase));

    if (hasLatePhrase) {
        if (normalized.includes('nửa tiếng') || normalized.includes('nửa giờ')) {
            return { matched: true, minutes: 30 };
        }
        const digitMinMatch = normalized.match(/(\d+)\s*(phút|p\b|'|min)/);
        if (digitMinMatch) {
            return { matched: true, minutes: parseInt(digitMinMatch[1], 10) };
        }
        const comboMatch = normalized.match(/(\d+)\s*(?:tiếng|giờ|h)\s*(\d+)(?!\s*rưỡi)\s*(?:phút|p|phut)?/);
        if (comboMatch) {
            const h = parseInt(comboMatch[1], 10);
            const m = parseInt(comboMatch[2], 10);
            return { matched: true, minutes: h * 60 + m };
        }
        const ruoiMatch = normalized.match(/(\d+)\s*(?:tiếng|giờ)\s*rưỡi/);
        if (ruoiMatch) {
            const h = parseInt(ruoiMatch[1], 10);
            return { matched: true, minutes: h * 60 + 30 };
        }
        const decimalMatch = normalized.match(/(\d+[.,]\d+)\s*(?:tiếng|giờ|h\b)/);
        if (decimalMatch) {
            const h = parseFloat(decimalMatch[1].replace(',', '.'));
            return { matched: true, minutes: Math.round(h * 60) };
        }
        const hourMatch = normalized.match(/(\d+)\s*(?:tiếng|giờ|h\b)(?!\s*\d)/);
        if (hourMatch) {
            const h = parseInt(hourMatch[1], 10);
            if (h <= 4) {
                return { matched: true, minutes: h * 60 };
            }
        }
        const wordKeys = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length);
        for (const word of wordKeys) {
            if (normalized.includes(word + ' tiếng') || normalized.includes(word + ' giờ')) {
                return { matched: true, minutes: NUMBER_WORDS[word] * 60 };
            }
            if (normalized.includes(word + ' phút') || normalized.includes(word + ' p ')) {
                return { matched: true, minutes: NUMBER_WORDS[word] };
            }
        }
    }

    // 2. Kiểm tra MỐC GIỜ ĐÍCH VÀO LÀM:
    // 'xin mai 9 rưỡi vào làm', 'xin vào làm lúc 9h30', 'xin ca 9h30', 'xin vào muộn 10h', 'xin đi muộn khoảng 10h 10 rưỡi'
    const targetClockRegex = /(?:xin|báo|chuyển|đổi)(?:[^\n.,!?;]*?)(?:vào làm|đi làm|đến làm|tới làm|ca|vào muộn|đến muộn|tới muộn|đi muộn)(?:[^\n.,!?;]*?)(?:lúc|khoảng|tầm|sau)?\s*(\d{1,2})\s*(?:h(?:\s*(\d{1,2}))?|giờ(?:\s*(\d{1,2}))?|:(\d{1,2})|\s*rưỡi)?(?:\s+(?:hoặc|đến|-|tới)?\s*(\d{1,2})\s*(?:rưỡi|h(?:\d{1,2})?))?/i;
    const reverseClockRegex = /(?:xin|báo)(?:[^\n.,!?;]*?)\s+(\d{1,2})\s*(?:h(\d{1,2})?|:(\d{1,2})|\s*giờ(?:\s*(\d{1,2}))?|\s*rưỡi)\s+(?:vào làm|đi làm|đến làm|tới làm|mới vào|mới đi)/i;

    let clockMatch = normalized.match(reverseClockRegex) || normalized.match(targetClockRegex);
    if (clockMatch) {
        const matchStr = clockMatch[0];
        let hour = parseInt(clockMatch[1], 10);
        let min = 0;
        if (matchStr.includes('rưỡi')) {
            min = 30;
            if (clockMatch[5]) hour = parseInt(clockMatch[5], 10);
        } else if (clockMatch[2] || clockMatch[3] || clockMatch[4]) {
            min = parseInt(clockMatch[2] || clockMatch[3] || clockMatch[4], 10);
        }
        if (hour >= 7 && hour <= 15) {
            const targetTotalMin = hour * 60 + min;
            const baseTotalMin = Math.round(baseShiftHour * 60); // 8:30 = 510
            const diffMin = Math.max(0, targetTotalMin - baseTotalMin);
            return { matched: true, minutes: diffMin, targetTime: `${hour}:${min < 10 ? '0' : ''}${min}` };
        }
    }

    if (hasLatePhrase) {
        return { matched: true, minutes: null };
    }

    return { matched: false, minutes: null };
}

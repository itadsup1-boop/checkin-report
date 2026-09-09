/**
 * Quy tắc nghiệp vụ check-in tuyến điểm bán thị trường (Retail / Market Check-in).
 * Thuần logic Javascript — không import database hay framework.
 */

export const RETAIL_CONFIG = {
    TARGET_POINTS_PER_DAY: 15,
    SHIFT_START: '08:30',
    SHIFT_END: '18:00',
    LUNCH_START: '12:00',
    LUNCH_END: '13:30',
    CUTOFF_TIME: '20:00', // Chốt sổ 20:00 tối: sau 20:00 không nhận thêm bất kỳ check-in nào trong ngày
    MIN_PHOTOS_REQUIRED: 1,
    MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS: 0, // Đã tắt theo yêu cầu (cho phép gửi liên tục không giới hạn thời gian chờ)
    GROUP_ROLE: 'retail_checkin'
};

/**
 * Bóc tách nội dung caption dạng: [Tên điểm bán] - [Địa chỉ chi tiết] hoặc Tên điểm bán - Địa chỉ
 * @param {string} rawText 
 * @returns {{ storeName: string, storeAddress: string } | null}
 */
export function parseCheckinCaption(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const cleanText = rawText.trim();
    if (!cleanText.includes('-')) return null;

    // Tách theo dấu gạch ngang đầu tiên
    const parts = cleanText.split('-');
    const rawStore = parts[0].trim();
    const rawAddress = parts.slice(1).join('-').trim();

    // Loại bỏ dấu ngoặc vuông nếu người dùng nhập theo format [Tên] - [Địa chỉ]
    const storeName = rawStore.replace(/^[\[\(\{]/, '').replace(/[\]\)\}]$/, '').trim();
    const storeAddress = rawAddress.replace(/^[\[\(\{]/, '').replace(/[\]\)\}]$/, '').trim();

    // Cả tên điểm bán và địa chỉ chi tiết đều bắt buộc phải có
    if (storeName.length < 2 || storeAddress.length < 2) return null;

    return {
        storeName,
        storeAddress
    };
}

/**
 * Kiểm tra số lượng ảnh minh chứng (bắt buộc ≥ 1 ảnh)
 * @param {number} photoCount 
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateCheckinPhotos(photoCount) {
    if (!photoCount || photoCount < RETAIL_CONFIG.MIN_PHOTOS_REQUIRED) {
        return {
            valid: false,
            message: `⚠️ <b>Thiếu ảnh minh chứng!</b>\nMỗi lượt check-in bắt buộc gửi kèm ít nhất <b>01 ảnh</b> minh chứng tại điểm bán.`
        };
    }
    return { valid: true };
}

/**
 * Kiểm tra khung giờ gửi báo cáo
 * @param {object} momentInstance (Moment object đã set UTC+7)
 * @param {string} shiftStart
 * @param {string} shiftEnd
 * @param {boolean} allowSunday
 * @param {string} cutoffTime
 * @returns {{ isWorkingHour: boolean, isOvertime?: boolean, isEarly?: boolean, isLunchBreak: boolean, isCutoff?: boolean, message?: string }}
 */
export function validateWorkingHours(
    momentInstance,
    shiftStart = RETAIL_CONFIG.SHIFT_START,
    shiftEnd = RETAIL_CONFIG.SHIFT_END,
    allowSunday = (process.env.ALLOW_SUNDAY_RETAIL_CHECKIN === 'true'),
    cutoffTime = RETAIL_CONFIG.CUTOFF_TIME
) {
    const timeStr = momentInstance.format('HH:mm');
    const dayOfWeek = momentInstance.isoWeekday(); // 1 = Monday, 7 = Sunday

    if (dayOfWeek === 7 && !allowSunday) {
        return {
            isWorkingHour: false,
            isLunchBreak: false,
            message: 'Hôm nay là Chủ Nhật (ngày nghỉ theo lịch làm việc).'
        };
    }

    const cutoff = (cutoffTime || RETAIL_CONFIG.CUTOFF_TIME || '20:00').slice(0, 5);
    // Sau 20:00: Chốt sổ hoàn toàn, không ghi nhận thêm
    if (timeStr >= cutoff) {
        return {
            isWorkingHour: false,
            isCutoff: true,
            isOvertime: true,
            isLunchBreak: false,
            message: `⚠️ <b>Đã quá giờ nhận báo cáo (${cutoff})!</b>\nHệ thống đã chốt sổ lúc ${cutoff}, không ghi nhận thêm bất kỳ lượt check-in nào trong ngày hôm nay.`
        };
    }

    const start = (shiftStart || RETAIL_CONFIG.SHIFT_START).slice(0, 5);
    const end = (shiftEnd || RETAIL_CONFIG.SHIFT_END).slice(0, 5);

    // Quá giờ làm việc nhưng trước 20:00: vẫn cho phép gửi báo cáo và ghi nhận (ngoài giờ)
    const isOvertime = timeStr > end;
    const isEarly = timeStr < start;
    const isLunch = timeStr >= RETAIL_CONFIG.LUNCH_START && timeStr <= RETAIL_CONFIG.LUNCH_END;

    return {
        isWorkingHour: true,
        isOvertime,
        isEarly,
        isLunchBreak: isLunch,
        message: isLunch ? 'Đang trong giờ nghỉ trưa (12:00 - 13:30).' : null
    };
}

/**
 * Tính toán tiến độ KPI
 * @param {number} currentValidCount 
 * @returns {{ completed: boolean, remaining: number, progressText: string }}
 */
export function calculateKpiProgress(currentValidCount, target = RETAIL_CONFIG.TARGET_POINTS_PER_DAY) {
    const effectiveTarget = Number(target) || RETAIL_CONFIG.TARGET_POINTS_PER_DAY;
    const completed = currentValidCount >= effectiveTarget;
    const remaining = Math.max(0, effectiveTarget - currentValidCount);
    return {
        completed,
        remaining,
        progressText: `${currentValidCount}/${effectiveTarget}`
    };
}

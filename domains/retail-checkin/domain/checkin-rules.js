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
    MIN_PHOTOS_REQUIRED: 2,
    MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS: 120, // Tối thiểu 2 phút giữa 2 điểm bán để chống spam
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

    if (storeName.length < 2) return null;

    return {
        storeName,
        storeAddress: storeAddress || 'Chưa có địa chỉ chi tiết'
    };
}

/**
 * Kiểm tra số lượng ảnh minh chứng (bắt buộc ≥ 2 ảnh)
 * @param {number} photoCount 
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateCheckinPhotos(photoCount) {
    if (!photoCount || photoCount < RETAIL_CONFIG.MIN_PHOTOS_REQUIRED) {
        return {
            valid: false,
            message: `⚠️ <b>Thiếu ảnh minh chứng!</b>\nMỗi lượt check-in bắt buộc tối thiểu <b>02 ảnh</b>:\n• 01 ảnh selfie rõ mặt trước biển hiệu/cổng điểm bán\n• 01 ảnh chụp quầy kệ/sản phẩm bên trong cửa hàng.`
        };
    }
    return { valid: true };
}

/**
 * Kiểm tra khung giờ gửi báo cáo
 * @param {object} momentInstance (Moment object đã set UTC+7)
 * @returns {{ isWorkingHour: boolean, isLunchBreak: boolean, message?: string }}
 */
export function validateWorkingHours(momentInstance) {
    const timeStr = momentInstance.format('HH:mm');
    const dayOfWeek = momentInstance.isoWeekday(); // 1 = Monday, 7 = Sunday

    if (dayOfWeek === 7) {
        return {
            isWorkingHour: false,
            isLunchBreak: false,
            message: 'Hôm nay là Chủ Nhật (ngày nghỉ theo lịch làm việc).'
        };
    }

    if (timeStr < RETAIL_CONFIG.SHIFT_START || timeStr > RETAIL_CONFIG.SHIFT_END) {
        return {
            isWorkingHour: false,
            isLunchBreak: false,
            message: `Ngoài khung giờ làm việc (${RETAIL_CONFIG.SHIFT_START} - ${RETAIL_CONFIG.SHIFT_END}).`
        };
    }

    const isLunch = timeStr >= RETAIL_CONFIG.LUNCH_START && timeStr <= RETAIL_CONFIG.LUNCH_END;
    return {
        isWorkingHour: true,
        isLunchBreak: isLunch,
        message: isLunch ? 'Đang trong giờ nghỉ trưa (12:00 - 13:30).' : null
    };
}

/**
 * Tính toán tiến độ KPI
 * @param {number} currentValidCount 
 * @returns {{ completed: boolean, remaining: number, progressText: string }}
 */
export function calculateKpiProgress(currentValidCount) {
    const target = RETAIL_CONFIG.TARGET_POINTS_PER_DAY;
    const completed = currentValidCount >= target;
    const remaining = Math.max(0, target - currentValidCount);
    return {
        completed,
        remaining,
        progressText: `${currentValidCount}/${target}`
    };
}

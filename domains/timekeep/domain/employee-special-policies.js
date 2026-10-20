/**
 * Chính sách đặc thù cho từng nhân sự (Sales / Telesale có lịch làm riêng, gặp khách).
 * Thuần - không express, pg, telegraf.
 */

export const DINH_NGOC_TELEGRAM_ID = '8973621367';
export const DINH_NGOC_USER_ID = 'dc286880-c850-4740-8db0-ee700db216e8';
export const CA_9_17_CODE = 'CA_9_17';

export const SPECIAL_EMPLOYEES = Object.freeze({
    [DINH_NGOC_USER_ID]: {
        fullName: 'Đinh Ngọc',
        telegramId: DINH_NGOC_TELEGRAM_ID,
        shiftType: CA_9_17_CODE,
        shiftStart: '09:00:00',
        shiftEnd: '17:00:00',
        graceMinutes: 5,
        weeklyClientMeetingQuotaDays: 1.5,
        fixedSundayOff: true
    }
});

/** Kiểm tra nhân sự có chính sách ca hoặc chế độ đặc thù hay không */
export function isSpecialEmployee(identifier) {
    if (!identifier) return false;
    const str = String(identifier).trim();
    if (SPECIAL_EMPLOYEES[str]) return true;
    return Object.values(SPECIAL_EMPLOYEES).some(e => e.telegramId === str);
}

/** Lấy thông tin cấu hình đặc thù của nhân sự */
export function getSpecialEmployeeConfig(identifier) {
    if (!identifier) return null;
    const str = String(identifier).trim();
    if (SPECIAL_EMPLOYEES[str]) return SPECIAL_EMPLOYEES[str];
    return Object.values(SPECIAL_EMPLOYEES).find(e => e.telegramId === str) || null;
}

/** Kiểm tra loại ca có phải là Ca 9h - 17h */
export function isCa917Shift(shiftType) {
    return String(shiftType || '').toUpperCase() === CA_9_17_CODE;
}

/**
 * Tính toán số ngày nghỉ gặp khách trong tuần và kiểm tra có trong hạn mức không.
 * @param {Array<{request_type: string, date: string}>} existingWeeklyLeaves Các đơn nghỉ trong tuần
 * @param {string} currentRequestType Loại đơn hiện tại (FULL_DAY, HALF_DAY_AM, HALF_DAY_PM)
 * @param {number} quota Hạn mức tối đa (mặc định 1.5)
 */
export function checkWeeklyMeetingQuota(existingWeeklyLeaves = [], currentRequestType = 'FULL_DAY', quota = 1.5) {
    let currentDays = 0;
    if (currentRequestType === 'FULL_DAY') currentDays = 1.0;
    else if (currentRequestType === 'HALF_DAY_AM' || currentRequestType === 'HALF_DAY_PM') currentDays = 0.5;

    let existingDays = 0;
    for (const leave of existingWeeklyLeaves) {
        if (leave.request_type === 'FULL_DAY') existingDays += 1.0;
        else if (leave.request_type === 'HALF_DAY_AM' || leave.request_type === 'HALF_DAY_PM') existingDays += 0.5;
    }

    const totalDays = existingDays + currentDays;
    return {
        withinQuota: totalDays <= quota,
        existingDays,
        currentDays,
        totalDays,
        quota
    };
}

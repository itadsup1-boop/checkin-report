/**
 * Danh sách nhân sự nội bộ / tài khoản test cần loại trừ khỏi toàn bộ các Google Sheets
 * và báo cáo xuất ra.
 */
export const EXCLUDED_SHEET_NAMES = [
    'boss',
    'longg',
    'test',
    'tester',
    'boss hỗ trợ',
    'boss ho tro',
    'bot test'
];

/**
 * Kiểm tra xem tên nhân viên có thuộc danh sách loại trừ không (không phân biệt hoa thường, khoảng trắng).
 * @param {string} name 
 * @returns {boolean}
 */
export function isExcludedSheetEmployee(name) {
    if (!name || typeof name !== 'string') return false;
    const clean = name.trim().toLowerCase();
    return EXCLUDED_SHEET_NAMES.includes(clean);
}

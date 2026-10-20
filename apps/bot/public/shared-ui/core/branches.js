/**
 * Danh sách cơ sở kho — NGUỒN DUY NHẤT cho cả ba Mini App kho.
 *
 * `code` phải khớp đúng giá trị cột `tk_inventory.branch` trong database. Đây
 * không phải nhãn tự do: server chỉ nhận 'US' hoặc 'UK' (xem import-routes.js),
 * đổi ở đây mà không đổi database là hỏng nhập/xuất kho.
 *
 * Trước đây mỗi Mini App tự khai một mảng riêng nên tên cơ sở dễ lệch nhau giữa
 * các màn hình; giờ chỉ sửa một chỗ.
 */

export const BRANCHES = [
    { code: 'US', name: 'MEDITECH (US)', short: 'US' },
    { code: 'UK', name: 'Cơ sở UK', short: 'UK' }
];

export const BRANCH_CODES = BRANCHES.map(branch => branch.code);

export function branchName(code) {
    return BRANCHES.find(branch => branch.code === code)?.name || code || '';
}

/** Cơ sở còn lại — dùng khi hàng phải điều chuyển từ cơ sở kia. */
export function otherBranch(code) {
    return BRANCH_CODES.find(current => current !== code) || '';
}

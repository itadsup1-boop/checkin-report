/**
 * Ai được thao tác với đơn giá sản phẩm — thuần, không pg/express/telegraf.
 *
 * Theo yêu cầu chủ hệ thống: đặt nhãn vai trò nhân sự (`employees.role`) thành
 * "Kế toán" là ĐỦ để vào được, không bắt buộc phải cấp quyền
 * MANAGE_PRICING/VIEW_PRICING riêng qua "Quyền kho" nữa. Vẫn giữ đường quyền
 * cũ (Admin hệ thống, hoặc được cấp quyền theo nhóm) để không phá luồng đã có
 * — chỉ THÊM một cách vào nữa, không thay thế.
 */

export const ACCOUNTANT_ROLE_LABEL = 'Kế toán';

export function hasPricingAccess(actorContext, permissionCode) {
    if (actorContext.isAdmin) return true;
    return actorContext.employee?.role === ACCOUNTANT_ROLE_LABEL;
}

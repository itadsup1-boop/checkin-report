/**
 * Quy tắc của đơn xuất theo khách hàng — không DOM, không tự gọi mạng.
 *
 * Tách riêng vì đây là phần quyết định payload gửi lên server và phần tính xem
 * hàng có đủ không. Hai thứ đó phải đọc được mà không phải lội qua code giao diện.
 *
 * Quy tắc domain quan trọng: sản phẩm tách riêng theo TỪNG dịch vụ. Cùng một sản
 * phẩm nằm ở hai dịch vụ vẫn là hai dòng; tồn kho chỉ cộng ngầm khi kiểm tra tổng
 * để cảnh báo thiếu hàng.
 */

import { localStock, otherStock } from '../../data/warehouse-repo.js';

export const STEP_TITLES = ['Cơ sở', 'Khách hàng', 'Dịch vụ', 'Sản phẩm', 'Xác nhận'];
export const TOTAL_STEPS = STEP_TITLES.length;

/** Số điện thoại chỉ tính chữ số — nhân viên hay gõ kèm dấu cách hoặc dấu +. */
export const phoneDigitCount = value => String(value || '').replace(/\D/g, '').length;

export const activeLines = items => items.filter(line => !line.is_removed);

/* ---------- Khôi phục nháp ---------- */

/**
 * Đổ nháp đã lưu vào state. Bỏ qua dịch vụ không còn trong danh mục: Admin có thể
 * đã tắt dịch vụ đó trong lúc nhân viên bỏ dở đơn.
 */
export function applyDraft(state, saved, catalog, newKey) {
    if (!saved) return;
    state.branch = saved.branch || null;
    state.customerName = saved.customer_name || '';
    state.customerPhone = saved.customer_phone || '';
    state.doctorName = saved.doctor_name || '';
    state.technicianName = saved.technician_name || '';
    state.idempotencyKey = saved.idempotency_key || newKey;
    for (const entry of saved.services || []) {
        const service = catalog.services.find(item => item.id === entry.service_id);
        if (service) state.selections.set(service.id, (entry.items || []).map(line => {
            const product = catalog.products.find(item => item.id === line.product_id);
            return {
                ...line,
                quantity_mode: product?.quantity_mode === 'DECIMAL' ? 'DECIMAL' : 'INTEGER'
            };
        }));
    }
}

/** Payload gửi lên POST /api/warehouse/service-orders — giữ đúng tên field server đọc. */
export function buildPayload(state) {
    return {
        customer_name: state.customerName.trim(),
        customer_phone: state.customerPhone.trim(),
        doctor_name: state.doctorName.trim(),
        technician_name: state.technicianName.trim(),
        branch: state.branch,
        idempotency_key: state.idempotencyKey,
        services: [...state.selections.entries()].map(([serviceId, items]) => ({
            service_id: serviceId,
            items
        }))
    };
}

/* ---------- Tính khả năng đáp ứng ---------- */

/** Tổng số lượng cần cho mỗi sản phẩm, cộng ngầm qua tất cả dịch vụ. */
export function requiredByProduct(state) {
    const totals = new Map();
    for (const items of state.selections.values()) {
        for (const line of activeLines(items)) {
            totals.set(line.product_id, Number(((totals.get(line.product_id) || 0) + Number(line.actual_quantity || 0)).toFixed(1)));
        }
    }
    return totals;
}

/** Phân tích khả năng đáp ứng: đủ tại cơ sở / cần điều chuyển / thiếu toàn hệ thống. */
export function availability(state, catalog) {
    const rows = [];
    for (const [productId, required] of requiredByProduct(state)) {
        const local = localStock(catalog.stock, productId, state.branch);
        const other = otherStock(catalog.stock, productId, state.branch);
        const product = catalog.products.find(item => item.id === productId);
        rows.push({
            productId,
            name: product?.product_name || 'Sản phẩm đã bị xóa',
            required,
            local,
            other,
            total: local + other,
            transfer: Math.max(0, required - local),
            missing: Math.max(0, required - local - other)
        });
    }
    return rows;
}

export const totalQty = state => Number(
    [...requiredByProduct(state).values()].reduce((sum, value) => sum + value, 0).toFixed(1)
);

export const missingRows = (state, catalog) =>
    availability(state, catalog).filter(row => row.missing > 0);

export const transferRows = (state, catalog) =>
    availability(state, catalog).filter(row => row.missing === 0 && row.transfer > 0);

/* ---------- Sửa dòng trong đơn ---------- */

/** Bật/tắt một dịch vụ. Bật thì đổ sẵn sản phẩm theo mẫu Admin đã cấu hình. */
export function toggleService(state, catalog, serviceId) {
    if (state.selections.has(serviceId)) {
        state.selections.delete(serviceId);
        return;
    }
    const service = catalog.services.find(item => item.id === serviceId);
    if (!service) return;
    state.selections.set(serviceId, service.items.map((item, index) => ({
        product_id: item.product_id,
        product_name: item.product_name,
        barcode: item.barcode,
        quantity_mode: item.quantity_mode === 'DECIMAL' ? 'DECIMAL' : 'INTEGER',
        actual_quantity: item.default_quantity,
        template_quantity: item.default_quantity,
        item_source: 'TEMPLATE',
        is_removed: false,
        display_order: index
    })));
}

export function setLineQuantity(state, serviceId, productId, quantity) {
    const line = state.selections.get(serviceId)?.find(item => item.product_id === productId);
    if (!line) return;
    const minimum = line.quantity_mode === 'DECIMAL' ? 0.1 : 1;
    line.actual_quantity = Math.max(minimum, Number(Number(quantity).toFixed(1)));
}

/**
 * Loại bỏ / khôi phục một dòng.
 * Dòng bị loại vẫn nằm trong payload với is_removed = true, vì server cần biết
 * mẫu dịch vụ đã bị sửa gì so với cấu hình gốc.
 */
export function toggleRemoveLine(state, serviceId, productId) {
    const line = state.selections.get(serviceId)?.find(item => item.product_id === productId);
    if (!line) return;
    line.is_removed = !line.is_removed;
}

/** Thêm sản phẩm ngoài mẫu; đã có sẵn thì khôi phục và tăng 1. */
export function addProductToService(state, catalog, serviceId, productId) {
    const items = state.selections.get(serviceId);
    const product = catalog.products.find(item => item.id === productId);
    if (!items || !product) return;

    const existing = items.find(line => line.product_id === productId);
    if (existing) {
        existing.is_removed = false;
        existing.actual_quantity += 1;
        return;
    }
    items.push({
        product_id: product.id,
        product_name: product.product_name,
        barcode: product.barcode,
        quantity_mode: product.quantity_mode === 'DECIMAL' ? 'DECIMAL' : 'INTEGER',
        actual_quantity: 1,
        template_quantity: null,
        item_source: 'MANUAL',
        is_removed: false,
        display_order: items.length
    });
}

/* ---------- Điều kiện đi tiếp ---------- */

export function canAdvance(state) {
    switch (state.step) {
        case 0: return Boolean(state.branch);
        case 1: return state.customerName.trim().length > 0
            && phoneDigitCount(state.customerPhone) >= 4
            && state.doctorName.trim().length > 0
            && state.technicianName.trim().length > 0;
        case 2: return state.selections.size > 0;
        case 3: return totalQty(state) > 0;
        default: return true;
    }
}

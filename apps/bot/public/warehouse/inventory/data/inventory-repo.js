/**
 * Nguồn dữ liệu của Mini App tồn kho.
 *
 * KHÔNG có dữ liệu mẫu hardcode. Toàn bộ sản phẩm, tồn kho và lịch sử đọc từ
 * API thật; danh mục rỗng thì hiển thị trạng thái rỗng chứ không bịa ra.
 */

import { apiGet } from '../../../shared-ui/core/api.js';
import { BRANCHES, branchName } from '../../../shared-ui/core/branches.js';

// Cơ sở dùng chung cho mọi Mini App kho; re-export cho các tầng trong app này.
export { BRANCHES, branchName };

/**
 * Ngưỡng "sắp hết" áp dụng chung cho mọi sản phẩm.
 *
 * Đây là quy tắc hiển thị của hệ thống, KHÔNG phải dữ liệu cấu hình: bảng
 * tk_products chưa có cột ngưỡng riêng cho từng mặt hàng. Muốn đặt ngưỡng khác
 * nhau theo sản phẩm thì cần thêm cột và giao diện cấu hình trong Web Admin.
 */
export const NGUONG_SAP_HET = 10;

/** Toàn bộ danh mục kèm tồn tách theo từng cơ sở. */
export async function loadInventory() {
    const data = await apiGet('/api/warehouse/stock-overview');
    return (data.products || []).map(row => ({
        id: row.product_id,
        barcode: row.barcode || '',
        name: row.product_name || '',
        baseUnit: row.base_unit || 'chiếc',
        importUnit: row.import_unit || null,
        conversionRate: Number(row.conversion_rate) || 1.0,
        stockUS: Number(row.stock_us) || 0,
        stockUK: Number(row.stock_uk) || 0,
        updatedAt: row.updated_at || null
    }));
}

/** Lịch sử biến động của một sản phẩm, đọc từ sổ ledger. */
export async function loadProductHistory(productId) {
    const data = await apiGet('/api/warehouse/product-history', { product_id: productId });
    return (data.history || []).map(row => ({
        eventType: row.event_type,
        branch: row.branch,
        delta: Number(row.quantity_delta) || 0,
        balanceBefore: Number(row.balance_before) || 0,
        balanceAfter: Number(row.balance_after) || 0,
        // Dòng điều chuyển-dùng-ngay ghi số dư ẢO (hàng không thực sự nằm ở cơ sở
        // đích) nên UI không được hiển thị "còn X" cho những dòng này.
        virtualBalance: Boolean(row.metadata?.virtual_balance),
        actorName: row.actor_name || '',
        createdAt: row.created_at
    }));
}

/* ---------- Hàm tính toán thuần, không phụ thuộc giao diện ---------- */

/** Tồn theo cơ sở đang lọc; 'all' thì cộng cả hai. */
export function stockOf(item, branchFilter) {
    if (branchFilter === 'US') return item.stockUS;
    if (branchFilter === 'UK') return item.stockUK;
    return item.stockUS + item.stockUK;
}

/**
 * Phân loại tình trạng tồn kho.
 * @returns {{key:'out'|'low'|'ok', label:string}}
 */
export function stockStatus(quantity) {
    if (quantity === 0) return { key: 'out', label: 'Hết hàng' };
    if (quantity <= NGUONG_SAP_HET) return { key: 'low', label: 'Sắp hết' };
    return { key: 'ok', label: 'Ổn định' };
}

/** Tổng hợp số liệu cho các thẻ thống kê ở đầu màn hình. */
export function summarize(items, branchFilter) {
    let totalQuantity = 0;
    let outOfStock = 0;
    let lowStock = 0;

    for (const item of items) {
        const quantity = stockOf(item, branchFilter);
        totalQuantity += quantity;
        const status = stockStatus(quantity);
        if (status.key === 'out') outOfStock += 1;
        else if (status.key === 'low') lowStock += 1;
    }

    // Cộng dồn nhiều số thập phân bằng phép + của JS sinh sai số nhị phân
    // (vd 3447.6000000000004) — làm tròn 1 chữ số thập phân, khớp quy ước
    // số lượng kho (packages/warehouse domain: MAX_QUANTITY_DECIMALS = 1).
    totalQuantity = Math.round(totalQuantity * 10) / 10;

    return {
        totalQuantity,
        productCount: items.length,
        outOfStock,
        lowStock,
        needAttention: outOfStock + lowStock
    };
}

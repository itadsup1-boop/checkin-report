/**
 * Gọi API thật của tính năng đơn giá sản phẩm — không còn dữ liệu demo.
 */
import { apiGet, apiPost } from '../../../shared-ui/core/api.js';

export async function loadAccess() {
    const res = await apiGet('/api/warehouse/pricing/access');
    return {
        fullName: res.full_name,
        role: res.role,
        canManage: Boolean(res.can_manage),
        canView: Boolean(res.can_view)
    };
}

export async function searchProducts(query) {
    const res = await apiGet('/api/warehouse/pricing/search', { q: query || '' });
    return res.products.map(p => ({
        id: p.id,
        name: p.product_name,
        barcode: p.barcode,
        // Đã quy đổi sẵn theo đơn vị NHẬP (vd Lọ) ở server — sản phẩm không có
        // đơn vị đóng gói thì priceUnit chính là đơn vị cơ sở (vd chiếc).
        currentPrice: p.current_price !== null ? Number(p.current_price) : null,
        priceUnit: p.price_unit || 'đơn vị',
        priceUpdatedAt: p.price_updated_at
    }));
}

export async function loadPriceHistory(productId) {
    const res = await apiGet('/api/warehouse/pricing/history', { product_id: productId });
    return res.history.map(item => ({
        price: Number(item.unit_price),
        user: item.created_by_name,
        createdAt: item.created_at
    }));
}

export async function loadAllProducts() {
    const res = await apiGet('/api/warehouse/pricing/products');
    return res.products.map(p => ({
        id: p.id,
        name: p.product_name,
        barcode: p.barcode,
        currentPrice: p.current_price !== null ? Number(p.current_price) : null,
        priceUnit: p.price_unit || 'đơn vị',
        priceUpdatedAt: p.price_updated_at
    }));
}

export async function loadOrderTotals() {
    const res = await apiGet('/api/warehouse/pricing/orders');
    return res.orders.map(o => ({
        id: o.id,
        orderCode: o.order_code,
        branch: o.branch,
        status: o.status,
        approvedAt: o.approved_at,
        totalAmount: o.total_amount !== null ? Number(o.total_amount) : 0,
        hasMissingPrice: Boolean(o.has_missing_price),
        createdByName: o.created_by_name
    }));
}

export async function saveProductPrice(productId, unitPrice) {
    const res = await apiPost('/api/warehouse/pricing/save', { product_id: productId, unit_price: unitPrice });
    return {
        oldPrice: res.oldPrice !== null && res.oldPrice !== undefined ? Number(res.oldPrice) : null,
        newPrice: Number(res.newPrice),
        priceUnit: res.priceUnit || 'đơn vị',
        createdAt: res.createdAt,
        patchedOrderCount: res.patchedOrderCount || 0
    };
}

/** Lưu nhiều đơn giá cùng lúc — mỗi sản phẩm được lưu độc lập, một sản phẩm lỗi không chặn các sản phẩm còn lại. */
export async function saveProductPricesBatch(items) {
    const res = await apiPost('/api/warehouse/pricing/save-batch', {
        items: items.map(item => ({ product_id: item.productId, unit_price: item.newPrice }))
    });
    return res.results.map(r => ({
        productId: r.productId,
        success: Boolean(r.success),
        message: r.message || null,
        oldPrice: r.oldPrice !== null && r.oldPrice !== undefined ? Number(r.oldPrice) : null,
        newPrice: r.newPrice !== null && r.newPrice !== undefined ? Number(r.newPrice) : null,
        priceUnit: r.priceUnit || 'đơn vị',
        createdAt: r.createdAt || null,
        patchedOrderCount: r.patchedOrderCount || 0
    }));
}

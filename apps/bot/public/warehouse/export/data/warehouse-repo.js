/**
 * Nguồn dữ liệu duy nhất của Mini App xuất kho.
 *
 * TẤT CẢ dịch vụ, sản phẩm và tồn kho đều đọc từ API thật — không có dữ liệu mẫu
 * hardcode trong file này. Nếu Admin chưa cấu hình gì thì UI hiển thị trạng thái
 * rỗng chứ không tự bịa ra danh mục.
 *
 * Vì sao cần hai nguồn:
 * - `/api/warehouse/service-order/bootstrap` chỉ trả về dịch vụ/mẫu khi group đã
 *   bật cờ warehouse_service_order_enabled; khi cờ tắt nó trả rỗng.
 * - `/api/warehouse/stock-overview` luôn trả danh mục + tồn theo từng cơ sở, nên
 *   luồng xuất lẻ dùng được kể cả khi cờ đang tắt.
 */

import { apiGet } from '../../../shared-ui/core/api.js';

// Danh sách cơ sở dùng chung cho mọi Mini App kho, khai báo một chỗ duy nhất.
// Re-export để các flow trong app này không phải biết đường dẫn shared.
export { BRANCHES, branchName } from '../../../shared-ui/core/branches.js';

function toStockMap(rows) {
    const map = new Map();
    for (const row of rows) {
        map.set(row.product_id, {
            stock_us: Number(row.stock_us) || 0,
            stock_uk: Number(row.stock_uk) || 0
        });
    }
    return map;
}

/**
 * Nạp toàn bộ danh mục cần cho cả hai luồng.
 * @returns {Promise<{serviceOrderEnabled:boolean, services:Array, products:Array, stock:Map}>}
 */
export async function loadCatalog() {
    const [overview, bootstrap] = await Promise.all([
        apiGet('/api/warehouse/stock-overview'),
        // Bootstrap có thể lỗi nếu group chưa bật cờ ở một số cấu hình cũ;
        // luồng xuất lẻ vẫn phải chạy được nên ở đây không để lỗi lan ra ngoài.
        apiGet('/api/warehouse/service-order/bootstrap').catch(() => null)
    ]);

    const products = (overview.products || []).map(row => ({
        id: row.product_id,
        barcode: row.barcode || '',
        product_name: row.product_name || '',
        quantity_mode: row.quantity_mode === 'DECIMAL' ? 'DECIMAL' : 'INTEGER',
        stock_us: Number(row.stock_us) || 0,
        stock_uk: Number(row.stock_uk) || 0
    }));

    const stock = toStockMap(overview.products || []);

    // Tồn từ bootstrap (nếu có) là cùng một truy vấn nên chỉ dùng để bổ khuyết.
    for (const row of bootstrap?.inventory || []) {
        if (!stock.has(row.product_id)) {
            stock.set(row.product_id, {
                stock_us: Number(row.stock_us) || 0,
                stock_uk: Number(row.stock_uk) || 0
            });
        }
    }

    const services = (bootstrap?.services || []).map(service => ({
        id: service.id,
        service_code: service.service_code,
        service_name: service.service_name,
        description: service.description || '',
        items: (service.items || []).map((item, index) => ({
            product_id: item.product_id,
            product_name: item.product_name,
            barcode: item.barcode || '',
            quantity_mode: item.quantity_mode === 'DECIMAL' ? 'DECIMAL' : 'INTEGER',
            default_quantity: Number(item.default_quantity) || 1,
            display_order: Number(item.display_order ?? index)
        }))
    }));

    return {
        serviceOrderEnabled: bootstrap?.service_order_enabled === true,
        services,
        products,
        stock
    };
}

/** Tra tồn của một sản phẩm; luôn trả về object nên nơi gọi không cần kiểm tra null. */
export function stockOf(stock, productId) {
    return stock.get(productId) || { stock_us: 0, stock_uk: 0 };
}

/** Tồn tại cơ sở đang chọn. */
export function localStock(stock, productId, branch) {
    const entry = stockOf(stock, productId);
    return branch === 'UK' ? entry.stock_uk : entry.stock_us;
}

/** Tồn ở cơ sở còn lại (dùng để gợi ý điều chuyển). */
export function otherStock(stock, productId, branch) {
    const entry = stockOf(stock, productId);
    return branch === 'UK' ? entry.stock_us : entry.stock_uk;
}

export function lookupCustomerByPhone(phone) {
    return apiGet('/api/warehouse/customers/suggestion', { phone });
}

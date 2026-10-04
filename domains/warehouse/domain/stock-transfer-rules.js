/**
 * Quy tắc của "Chuyển kho" — di chuyển hàng THẬT giữa hai cơ sở, không gắn với
 * đơn xuất nào. Khác với điều chuyển "dùng ngay" ở approve-order.js: hàng ở đây
 * thực sự nằm lại trong tồn kho cơ sở đích, không giao thẳng cho khách.
 *
 * Thuần — không pg/express/telegraf.
 */

import { WAREHOUSE_BRANCHES, WarehouseError } from './constants.js';
import { roundQuantity } from './quantity-rules.js';

/**
 * Chuẩn hoá và kiểm tra đầu vào của một yêu cầu chuyển kho.
 *
 * @param {object} input
 * @param {string} input.from_branch
 * @param {string} input.to_branch
 * @param {Array<{product_id:string, quantity:number}>} input.items
 */
export function validateStockTransferInput(input) {
    const fromBranch = String(input?.from_branch || '').toUpperCase();
    const toBranch = String(input?.to_branch || '').toUpperCase();

    if (!WAREHOUSE_BRANCHES.includes(fromBranch) || !WAREHOUSE_BRANCHES.includes(toBranch)) {
        throw new WarehouseError('Cơ sở không hợp lệ.');
    }
    if (fromBranch === toBranch) {
        throw new WarehouseError('Cơ sở nguồn và cơ sở đích phải khác nhau.');
    }

    const items = Array.isArray(input?.items) ? input.items : [];
    if (items.length === 0) {
        throw new WarehouseError('Chưa chọn sản phẩm nào để chuyển.');
    }

    const seen = new Set();
    const normalizedItems = items.map(item => {
        const productId = String(item?.product_id || '');
        const quantity = roundQuantity(Number(item?.quantity));
        if (!productId) {
            throw new WarehouseError('Thiếu mã sản phẩm trong danh sách chuyển kho.');
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new WarehouseError('Số lượng chuyển phải là số dương.');
        }
        if (seen.has(productId)) {
            throw new WarehouseError('Một sản phẩm không được xuất hiện hai lần trong cùng phiếu chuyển.');
        }
        seen.add(productId);
        return { product_id: productId, quantity };
    });

    return {
        from_branch: fromBranch,
        to_branch: toBranch,
        idempotency_key: String(input?.idempotency_key || '').trim() || null,
        items: normalizedItems
    };
}

/**
 * Kiểm tra tồn tại cơ sở nguồn có đủ cho từng sản phẩm không.
 *
 * @param {Array<{product_id:string, quantity:number}>} items đã chuẩn hoá
 * @param {Map<string, number>} stockByProduct tồn tại cơ sở nguồn, theo product_id
 * @returns {Array<{product_id:string, required:number, available:number}>} danh
 *          sách sản phẩm KHÔNG đủ; rỗng nghĩa là chuyển được hết
 */
export function findInsufficientStock(items, stockByProduct) {
    const shortages = [];
    for (const item of items) {
        const available = Number(stockByProduct.get(item.product_id) || 0);
        if (available < item.quantity) {
            shortages.push({ product_id: item.product_id, required: item.quantity, available });
        }
    }
    return shortages;
}

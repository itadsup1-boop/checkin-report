import { WarehouseError, WAREHOUSE_BRANCHES } from './constants.js';

const MAX_RECEIPT_ITEMS = 100;

export function validateStockReceiptInput(input = {}) {
    const branch = String(input.branch || '').trim().toUpperCase();
    if (!WAREHOUSE_BRANCHES.includes(branch)) {
        throw new WarehouseError('Cơ sở nhập kho phải là US hoặc UK.', {
            code: 'WAREHOUSE_BRANCH_INVALID'
        });
    }

    if (!Array.isArray(input.items) || input.items.length === 0) {
        throw new WarehouseError('Phiếu nhập kho phải có ít nhất một sản phẩm.', {
            code: 'WAREHOUSE_RECEIPT_EMPTY'
        });
    }
    if (input.items.length > MAX_RECEIPT_ITEMS) {
        throw new WarehouseError(`Mỗi phiếu chỉ được nhập tối đa ${MAX_RECEIPT_ITEMS} sản phẩm.`, {
            code: 'WAREHOUSE_RECEIPT_TOO_LARGE'
        });
    }

    const seen = new Set();
    const items = input.items.map(item => {
        const productId = String(item?.product_id || '').trim();
        const quantity = Number(item?.quantity);
        if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
            throw new WarehouseError('Sản phẩm và số lượng nhập kho không hợp lệ.', {
                code: 'WAREHOUSE_RECEIPT_ITEM_INVALID'
            });
        }
        if (seen.has(productId)) {
            throw new WarehouseError('Một sản phẩm không được lặp lại trong cùng phiếu nhập.', {
                code: 'WAREHOUSE_RECEIPT_ITEM_DUPLICATE'
            });
        }
        seen.add(productId);
        return { product_id: productId, quantity };
    });

    return {
        branch,
        items,
        note: String(input.note || '').trim().slice(0, 500)
    };
}


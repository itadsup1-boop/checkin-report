import test from 'node:test';
import assert from 'node:assert/strict';
import { WarehouseError } from '../domain/constants.js';
import { validateStockTransferInput, findInsufficientStock } from '../domain/stock-transfer-rules.js';

const valid = {
    from_branch: 'us',
    to_branch: 'uk',
    idempotency_key: 'test-key',
    items: [{ product_id: 'p1', quantity: 2 }]
};

test('chuẩn hoá đầu vào chuyển kho: viết hoa cơ sở, giữ nguyên số lượng hợp lệ', () => {
    const normalized = validateStockTransferInput(valid);
    assert.equal(normalized.from_branch, 'US');
    assert.equal(normalized.to_branch, 'UK');
    assert.deepEqual(normalized.items, [{ product_id: 'p1', quantity: 2 }]);
});

test('chặn cơ sở nguồn và đích trùng nhau', () => {
    assert.throws(
        () => validateStockTransferInput({ ...valid, to_branch: 'us' }),
        WarehouseError
    );
});

test('chặn cơ sở không hợp lệ', () => {
    assert.throws(
        () => validateStockTransferInput({ ...valid, from_branch: 'VN' }),
        WarehouseError
    );
});

test('chặn phiếu không có sản phẩm nào', () => {
    assert.throws(
        () => validateStockTransferInput({ ...valid, items: [] }),
        WarehouseError
    );
});

test('chặn một sản phẩm xuất hiện hai lần trong cùng phiếu', () => {
    assert.throws(
        () => validateStockTransferInput({
            ...valid,
            items: [{ product_id: 'p1', quantity: 1 }, { product_id: 'p1', quantity: 2 }]
        }),
        WarehouseError
    );
});

test('chặn số lượng âm hoặc bằng 0', () => {
    assert.throws(
        () => validateStockTransferInput({ ...valid, items: [{ product_id: 'p1', quantity: 0 }] }),
        WarehouseError
    );
    assert.throws(
        () => validateStockTransferInput({ ...valid, items: [{ product_id: 'p1', quantity: -1 }] }),
        WarehouseError
    );
});

test('tìm đúng sản phẩm không đủ tồn ở cơ sở nguồn', () => {
    const items = [
        { product_id: 'p1', quantity: 5 },
        { product_id: 'p2', quantity: 3 }
    ];
    const stockByProduct = new Map([['p1', 10], ['p2', 1]]);
    const shortages = findInsufficientStock(items, stockByProduct);
    assert.equal(shortages.length, 1);
    assert.deepEqual(shortages[0], { product_id: 'p2', required: 3, available: 1 });
});

test('không thiếu hàng khi tồn đủ cho mọi sản phẩm', () => {
    const items = [{ product_id: 'p1', quantity: 5 }];
    const stockByProduct = new Map([['p1', 5]]);
    assert.deepEqual(findInsufficientStock(items, stockByProduct), []);
});

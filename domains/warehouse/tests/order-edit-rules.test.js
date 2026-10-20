import test from 'node:test';
import assert from 'node:assert/strict';
import {
    validateEditWindow,
    validateOrderEditAuthorization,
    calculateExportDeltas,
    validateExportStockAvailability,
    calculateImportDeltas,
    validateImportStockReduction
} from '../domain/order-edit-rules.js';

test('validateEditWindow cho phép sửa đơn trong 24h và chặn khi quá 24h', () => {
    const now = new Date('2026-10-04T12:00:00Z');
    
    // Đơn tạo 1 tiếng trước -> hợp lệ
    const res1 = validateEditWindow(new Date('2026-10-04T11:00:00Z'), now);
    assert.equal(res1.allowed, true);
    assert.equal(res1.hoursRemaining > 0, true);

    // Đơn tạo 23.5 tiếng trước -> hợp lệ
    const res2 = validateEditWindow(new Date('2026-10-03T12:30:00Z'), now);
    assert.equal(res2.allowed, true);

    // Đơn tạo 24 tiếng 1 phút trước -> bị chặn
    const res3 = validateEditWindow(new Date('2026-10-03T11:59:00Z'), now);
    assert.equal(res3.allowed, false);
    assert.equal(res3.reason, 'EXPIRED_24H');
});

test('validateOrderEditAuthorization chỉ cho phép người tạo hoặc Admin/Quản lý', () => {
    const order = {
        created_by: 'emp-1',
        created_by_telegram_id: '111'
    };

    // Đúng người tạo theo employee_id
    assert.equal(validateOrderEditAuthorization({
        actor: { employee: { id: 'emp-1' }, telegramId: '111' },
        order
    }).allowed, true);

    // Admin hệ thống
    assert.equal(validateOrderEditAuthorization({
        actor: { employee: { id: 'emp-2' }, telegramId: '999' },
        order,
        isSystemAdmin: true
    }).allowed, true);

    // Quản lý
    assert.equal(validateOrderEditAuthorization({
        actor: { employee: { id: 'emp-3', role: 'Quản lý' }, telegramId: '333' },
        order
    }).allowed, true);

    // Người khác không phải người tạo
    assert.equal(validateOrderEditAuthorization({
        actor: { employee: { id: 'emp-4', role: 'Kỹ thuật viên' }, telegramId: '444' },
        order
    }).allowed, false);
});

test('calculateExportDeltas tính đúng chênh lệch số lượng cho từng mặt hàng', () => {
    const currentItems = [
        { id: 'item-1', product_id: 'prod-A', actual_quantity: 2.0, is_removed: false },
        { id: 'item-2', product_id: 'prod-B', actual_quantity: 5.0, is_removed: false }
    ];

    const updatedItems = [
        // prod-A giảm từ 2 -> 1 (hoàn lại 1 cái)
        { id: 'item-1', product_id: 'prod-A', actual_quantity: 1.0, is_removed: false },
        // prod-B tăng từ 5 -> 7 (xuất thêm 2 cái)
        { id: 'item-2', product_id: 'prod-B', actual_quantity: 7.0, is_removed: false }
    ];

    const { deltas, hasChanges } = calculateExportDeltas({ currentItems, updatedItems });
    assert.equal(hasChanges, true);

    const deltaA = deltas.find(d => d.productId === 'prod-A');
    assert.equal(deltaA.oldQuantity, 2.0);
    assert.equal(deltaA.newQuantity, 1.0);
    assert.equal(deltaA.delta, -1.0); // Giảm xuất 1 cái -> hoàn kho +1
    assert.equal(deltaA.stockRefund, 1.0);
    assert.equal(deltaA.stockDeduction, 0);

    const deltaB = deltas.find(d => d.productId === 'prod-B');
    assert.equal(deltaB.delta, 2.0); // Tăng xuất 2 cái -> trừ kho 2
    assert.equal(deltaB.stockDeduction, 2.0);
    assert.equal(deltaB.stockRefund, 0);
});

test('validateExportStockAvailability chặn khi kho không đủ hàng để tăng xuất', () => {
    const deltas = [
        { productId: 'prod-B', stockDeduction: 5.0, stockRefund: 0 }
    ];
    const availableStockMap = {
        'prod-B': 3.0 // Chỉ còn 3 cái, không đủ để xuất thêm 5 cái
    };

    const res = validateExportStockAvailability({ deltas, availableStockMap });
    assert.equal(res.valid, false);
    assert.equal(res.insufficientProducts.length, 1);
    assert.equal(res.insufficientProducts[0].productId, 'prod-B');
});

test('calculateImportDeltas và validateImportStockReduction chống âm kho khi giảm nhập', () => {
    // Nhập ban đầu 20 cái, muốn sửa giảm về 10 cái (delta = -10)
    const { delta } = calculateImportDeltas({ currentQuantity: 20, newQuantity: 10 });
    assert.equal(delta, -10);

    // Tồn kho hiện tại chỉ còn 5 cái (đã xuất đi 15 cái) -> không được phép giảm 10 cái
    const res1 = validateImportStockReduction({ delta, currentStock: 5 });
    assert.equal(res1.valid, false);
    assert.equal(res1.reason, 'INSUFFICIENT_STOCK_TO_REDUCE');

    // Tồn kho hiện tại còn 12 cái -> giảm 10 cái an toàn (còn 2 cái)
    const res2 = validateImportStockReduction({ delta, currentStock: 12 });
    assert.equal(res2.valid, true);
});

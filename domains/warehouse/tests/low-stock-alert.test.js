import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LOW_STOCK_THRESHOLD,
    filterLowStockItems,
    buildLowStockWarningMessage,
    collectLowStockFromApprovedList
} from '../domain/low-stock-alert.js';
import * as warehouseIndex from '../index.js';

test('LOW_STOCK_THRESHOLD mặc định là 5', () => {
    assert.equal(LOW_STOCK_THRESHOLD, 5);
});

test('index.js re-export đầy đủ các thành phần cảnh báo tồn kho thấp', () => {
    assert.equal(warehouseIndex.LOW_STOCK_THRESHOLD, 5);
    assert.equal(typeof warehouseIndex.filterLowStockItems, 'function');
    assert.equal(typeof warehouseIndex.buildLowStockWarningMessage, 'function');
});

test('filterLowStockItems lọc chính xác sản phẩm có remaining < 5', () => {
    const items = [
        { productName: 'Sản phẩm 1', branch: 'US', remaining: 5 },
        { productName: 'Sản phẩm 2', branch: 'US', remaining: 4.9 },
        { productName: 'Sản phẩm 3', branch: 'UK', remaining: 0 },
        { productName: 'Sản phẩm 4', branch: 'UK', remaining: 10 }
    ];

    const result = filterLowStockItems(items);
    assert.equal(result.length, 2);
    assert.equal(result[0].productName, 'Sản phẩm 2');
    assert.equal(result[1].productName, 'Sản phẩm 3');
});

test('filterLowStockItems trả về mảng rỗng nếu đầu vào không hợp lệ hoặc không có hàng dưới 5', () => {
    assert.deepEqual(filterLowStockItems(null), []);
    assert.deepEqual(filterLowStockItems([]), []);
    assert.deepEqual(filterLowStockItems([
        { productName: 'A', branch: 'US', remaining: 5 },
        { productName: 'B', branch: 'US', remaining: 20 }
    ]), []);
});

test('collectLowStockFromApprovedList thu thập đúng sản phẩm dưới 5 từ luồng cũ', () => {
    const approvedList = [
        {
            product_name: 'Kem chống nắng',
            barcode: 'SP001',
            prefBranch: 'US',
            otherBranch: 'UK',
            otherDeduct: 0,
            finalStockUs: 3,
            finalStockUk: 20
        },
        {
            product_name: 'Bông tẩy trang',
            barcode: 'SP002',
            prefBranch: 'US',
            otherBranch: 'UK',
            otherDeduct: 2,
            finalStockUs: 0,
            finalStockUk: 4
        },
        {
            product_name: 'Kim tiêm',
            barcode: 'SP003',
            prefBranch: 'UK',
            otherBranch: 'US',
            otherDeduct: 0,
            finalStockUs: 10,
            finalStockUk: 15
        }
    ];

    const lowStock = collectLowStockFromApprovedList(approvedList);
    assert.equal(lowStock.length, 3);
    // Kem chống nắng tại US: 3
    assert.equal(lowStock[0].productName, 'Kem chống nắng');
    assert.equal(lowStock[0].branch, 'US');
    assert.equal(lowStock[0].remaining, 3);
    // Bông tẩy trang tại US: 0
    assert.equal(lowStock[1].productName, 'Bông tẩy trang');
    assert.equal(lowStock[1].branch, 'US');
    assert.equal(lowStock[1].remaining, 0);
    // Bông tẩy trang tại UK: 4 (do có bù khác cơ sở và UK còn 4)
    assert.equal(lowStock[2].productName, 'Bông tẩy trang');
    assert.equal(lowStock[2].branch, 'UK');
    assert.equal(lowStock[2].remaining, 4);
});

test('buildLowStockWarningMessage trả về rỗng nếu không có sản phẩm dưới 5', () => {
    assert.equal(buildLowStockWarningMessage([]), '');
    assert.equal(buildLowStockWarningMessage([
        { productName: 'SP An Toàn', branch: 'US', remaining: 8 }
    ]), '');
});

test('buildLowStockWarningMessage định dạng chuẩn tin nhắn cho 1 cơ sở', () => {
    const items = [
        { productName: 'Kem chống nắng', barcode: 'SP001', branch: 'US', remaining: 3 },
        { productName: 'Bông tẩy trang', barcode: 'SP002', branch: 'US', remaining: 1 }
    ];

    const message = buildLowStockWarningMessage(items, s => s);

    assert.match(message, /\[CẢNH BÁO HÀNG GẦN HẾT - CẦN BỔ SUNG\]/);
    assert.match(message, /Cơ sở:<\/b> US/);
    assert.match(message, /Kem chống nắng/);
    assert.match(message, /<code>SP001<\/code>/);
    assert.match(message, /còn <b>3<\/b>/);
    assert.match(message, /Bông tẩy trang/);
    assert.match(message, /<code>SP002<\/code>/);
    assert.match(message, /còn <b>1<\/b>/);
    assert.match(message, /Vui lòng lên kế hoạch nhập bổ sung hàng/);
});

test('buildLowStockWarningMessage định dạng rõ ràng khi có sản phẩm ở nhiều cơ sở', () => {
    const items = [
        { productName: 'Kem chống nắng', barcode: 'SP001', branch: 'US', remaining: 2 },
        { productName: 'Nước muối', barcode: 'SP003', branch: 'UK', remaining: 4 }
    ];

    const message = buildLowStockWarningMessage(items, s => s);

    assert.match(message, /\[CẢNH BÁO HÀNG GẦN HẾT - CẦN BỔ SUNG\]/);
    assert.match(message, /Cơ sở US:<\/b>/);
    assert.match(message, /Kem chống nắng/);
    assert.match(message, /còn <b>2<\/b>/);
    assert.match(message, /Cơ sở UK:<\/b>/);
    assert.match(message, /Nước muối/);
    assert.match(message, /còn <b>4<\/b>/);
});

test('buildLowStockWarningMessage tự động khử trùng lặp sản phẩm cùng cơ sở', () => {
    const items = [
        { productId: 'P1', productName: 'Kem chống nắng', branch: 'US', remaining: 2 },
        { productId: 'P1', productName: 'Kem chống nắng', branch: 'US', remaining: 2 }
    ];

    const message = buildLowStockWarningMessage(items, s => s);
    const count = (message.match(/Kem chống nắng/g) || []).length;
    assert.equal(count, 1);
});

test('buildLowStockWarningMessage escape HTML an toàn', () => {
    const escapeHtml = str => String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const items = [
        { productName: '<script>alert(1)</script>', barcode: '<b>bad</b>', branch: 'US', remaining: 1 }
    ];

    const message = buildLowStockWarningMessage(items, escapeHtml);
    assert.doesNotMatch(message, /<script>/);
    assert.match(message, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

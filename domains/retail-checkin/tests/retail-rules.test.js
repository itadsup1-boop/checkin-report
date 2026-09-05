import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseCheckinCaption,
    validateCheckinPhotos,
    calculateKpiProgress,
    RETAIL_CONFIG
} from '../domain/checkin-rules.js';

import {
    buildCheckinSuccessMessage,
    buildCheckinErrorMessage,
    buildDailySummaryMessage
} from '../domain/retail-messages.js';

test('Retail Rules - parseCheckinCaption bóc tách đúng định dạng', () => {
    // Có dấu ngoặc vuông
    const parsed1 = parseCheckinCaption('[Tạp hóa Minh Phát] - [123 Đường Nguyễn Trãi, Quận 1]');
    assert.deepEqual(parsed1, {
        storeName: 'Tạp hóa Minh Phát',
        storeAddress: '123 Đường Nguyễn Trãi, Quận 1'
    });

    // Không có dấu ngoặc vuông
    const parsed2 = parseCheckinCaption('Cửa hàng Sữa Mẹ Bé - 45 Phố Huế, Hai Bà Trưng, Hà Nội');
    assert.deepEqual(parsed2, {
        storeName: 'Cửa hàng Sữa Mẹ Bé',
        storeAddress: '45 Phố Huế, Hai Bà Trưng, Hà Nội'
    });

    // Thiếu địa chỉ sau dấu gạch
    const parsed3 = parseCheckinCaption('Đại lý Tuấn Anh - ');
    assert.deepEqual(parsed3, {
        storeName: 'Đại lý Tuấn Anh',
        storeAddress: 'Chưa có địa chỉ chi tiết'
    });

    // Sai định dạng: Không có dấu gạch ngang
    assert.equal(parseCheckinCaption('Check in tại tạp hóa Minh Phát'), null);
    assert.equal(parseCheckinCaption(''), null);
    assert.equal(parseCheckinCaption(null), null);
    assert.equal(parseCheckinCaption('A - B'), null); // storeName quá ngắn (< 2 ký tự)
});

test('Retail Rules - validateCheckinPhotos kiểm tra đủ tối thiểu 2 ảnh', () => {
    assert.equal(validateCheckinPhotos(0).valid, false);
    assert.equal(validateCheckinPhotos(1).valid, false);
    assert.equal(validateCheckinPhotos(2).valid, true);
    assert.equal(validateCheckinPhotos(3).valid, true);
});

test('Retail Rules - calculateKpiProgress tính đúng mốc 15 điểm', () => {
    const p1 = calculateKpiProgress(1);
    assert.equal(p1.completed, false);
    assert.equal(p1.remaining, 14);
    assert.equal(p1.progressText, '1/15');

    const p14 = calculateKpiProgress(14);
    assert.equal(p14.completed, false);
    assert.equal(p14.remaining, 1);
    assert.equal(p14.progressText, '14/15');

    const p15 = calculateKpiProgress(15);
    assert.equal(p15.completed, true);
    assert.equal(p15.remaining, 0);
    assert.equal(p15.progressText, '15/15');

    const p17 = calculateKpiProgress(17);
    assert.equal(p17.completed, true);
    assert.equal(p17.remaining, 0);
    assert.equal(p17.progressText, '17/15');
});

test('Retail Messages - buildCheckinSuccessMessage tạo nội dung thông báo đầy đủ', () => {
    const msg = buildCheckinSuccessMessage({
        employeeName: 'Nguyễn Văn A',
        storeName: 'Tạp hóa Minh Phát',
        storeAddress: '123 Nguyễn Trãi',
        timeStr: '09:15:00 - 05/09/2026',
        currentPoints: 5,
        targetPoints: 15,
        remainingPoints: 10,
        completed: false
    });

    assert.ok(msg.includes('Nguyễn Văn A'));
    assert.ok(msg.includes('Tạp hóa Minh Phát'));
    assert.ok(msg.includes('5/15'));
    assert.ok(msg.includes('Còn thiếu: <b>10 điểm</b>'));
});

test('Retail Messages - buildDailySummaryMessage tổng hợp chính xác đạt và chưa đạt', () => {
    const results = [
        { employeeName: 'Trần Văn B', validPoints: 15, isCompleted: true },
        { employeeName: 'Lê Thị C', validPoints: 12, isCompleted: false }
    ];

    const summary = buildDailySummaryMessage({
        dateStr: '05/09/2026',
        results
    });

    assert.ok(summary.includes('Trần Văn B: <b>15/15 điểm</b>'));
    assert.ok(summary.includes('Lê Thị C: 12/15 điểm (Thiếu 3)'));
});

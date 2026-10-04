import test from 'node:test';
import assert from 'node:assert/strict';
import {
    evaluateFormula,
    matchThreshold,
    formatFieldValue,
    calculateDynamicForm
} from '../domain/safe-formula-engine.js';

test('evaluateFormula: tính toán phép cộng, trừ, nhân, chia cơ bản', () => {
    assert.equal(evaluateFormula('{a} + {b}', { a: 10, b: 20 }), 30);
    assert.equal(evaluateFormula('{a} - {b}', { a: 50, b: 15 }), 35);
    assert.equal(evaluateFormula('{a} * {b}', { a: 6, b: 7 }), 42);
    assert.equal(evaluateFormula('{a} / {b}', { a: 100, b: 4 }), 25);
});

test('evaluateFormula: thứ tự ưu tiên toán tử và dấu ngoặc', () => {
    assert.equal(evaluateFormula('({a} + {b}) * {c}', { a: 2, b: 3, c: 4 }), 20);
    assert.equal(evaluateFormula('{a} + {b} * {c}', { a: 2, b: 3, c: 4 }), 14);
    assert.equal(evaluateFormula('({tong_lich} / {so_nhan}) * 100', { tong_lich: 5, so_nhan: 20 }), 25);
});

test('evaluateFormula: an toàn tuyệt đối khi chia cho 0 hoặc mẫu số <= 0', () => {
    assert.equal(evaluateFormula('{a} / {b}', { a: 10, b: 0 }), 0);
    assert.equal(evaluateFormula('{a} / {b}', { a: 10, b: -5 }), 0);
    assert.equal(evaluateFormula('({lich} / {so_nhan}) * 100', { lich: 5, so_nhan: 0 }), 0);
    assert.equal(evaluateFormula('({lich} / {so_nhan}) * 100', { lich: 5 }), 0);
});

test('matchThreshold: kiểm tra các mốc khen thưởng và cảnh báo', () => {
    const thresholds = [
        { operator: '>=', value: 19, badge: '🌟 Khen thưởng (>= 19%)', type: 'reward' },
        { operator: '<', value: 15, badge: '⚠️ Cảnh báo (< 15%)', type: 'warning' }
    ];

    assert.deepEqual(matchThreshold(20, thresholds), {
        matched: true,
        badge: '🌟 Khen thưởng (>= 19%)',
        type: 'reward'
    });

    assert.deepEqual(matchThreshold(19, thresholds), {
        matched: true,
        badge: '🌟 Khen thưởng (>= 19%)',
        type: 'reward'
    });

    assert.deepEqual(matchThreshold(12, thresholds), {
        matched: true,
        badge: '⚠️ Cảnh báo (< 15%)',
        type: 'warning'
    });

    assert.equal(matchThreshold(17, thresholds), null);
});

test('formatFieldValue: định dạng số tiền, %, số nguyên', () => {
    assert.equal(formatFieldValue(15000000, 'currency'), '15.000.000 đ');
    assert.equal(formatFieldValue(25.5, 'percentage'), '25.5%');
    assert.equal(formatFieldValue(20, 'percentage'), '20%');
    assert.equal(formatFieldValue(123, 'number'), '123');
});

test('calculateDynamicForm: tính toán toàn bộ form với trường nhập và tính toán', () => {
    const fields = [
        { key: 'so_nhan', label: 'Số nhận', type: 'number', category: 'INPUT', order_index: 1 },
        { key: 'lich_moi', label: 'Lịch mới', type: 'number', category: 'INPUT', order_index: 2 },
        { key: 'lich_cu', label: 'Lịch cũ', type: 'number', category: 'INPUT', order_index: 3 },
        { key: 'ds_hnay', label: 'Doanh số hôm nay', type: 'currency', category: 'INPUT', order_index: 4 },
        { key: 'tong_lich', label: 'Tổng lịch', type: 'number', category: 'CALCULATED', formula: '{lich_moi} + {lich_cu}', order_index: 5 },
        { key: 'ty_le_lich', label: 'Tỷ lệ lịch', type: 'percentage', category: 'CALCULATED', formula: '({tong_lich} / {so_nhan}) * 100', order_index: 6, thresholds: [
            { operator: '<', value: 25, badge: '⚠️ Cảnh báo (< 25%)', type: 'warning' }
        ]},
        { key: 'ds_thang', label: 'Tổng DS tháng', type: 'currency', category: 'CALCULATED', formula: '{ds_hnay}', is_monthly_cumulative: true, order_index: 7 }
    ];

    const rawInput = {
        so_nhan: '20',
        lich_moi: '3',
        lich_cu: '1',
        ds_hnay: '10.000.000'
    };

    const monthlyPrevious = {
        ds_thang: 50000000
    };

    const res = calculateDynamicForm(fields, rawInput, monthlyPrevious);

    assert.equal(res.values.so_nhan, 20);
    assert.equal(res.values.lich_moi, 3);
    assert.equal(res.values.lich_cu, 1);
    assert.equal(res.values.ds_hnay, 10000000);
    assert.equal(res.values.tong_lich, 4);
    assert.equal(res.values.ty_le_lich, 20);
    assert.equal(res.values.ds_thang, 60000000);

    assert.equal(res.formatted.ds_hnay, '10.000.000 đ');
    assert.equal(res.formatted.ty_le_lich, '20%');
    assert.equal(res.formatted.ds_thang, '60.000.000 đ');

    assert.equal(res.badges.ty_le_lich?.badge, '⚠️ Cảnh báo (< 25%)');
});

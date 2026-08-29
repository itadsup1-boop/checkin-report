import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateBaseQuantity,
    calculateBasePrice,
    formatUnitLabel,
    formatDualUnitDisplay,
    validateConversionConfig,
    DEFAULT_BASE_UNIT
} from '../domain/unit-conversion.js';

test('quy đổi số lượng nhập sang đơn vị cơ sở chuẩn xác', () => {
    // Nhập 2 lọ, mỗi lọ 2.5 ml => 5.0 ml
    assert.equal(calculateBaseQuantity(2, 2.5), 5.0);

    // Nhập 3 hộp găng tay, mỗi hộp 100 chiếc => 300 chiếc
    assert.equal(calculateBaseQuantity(3, 100), 300);

    // Không có hệ số quy đổi (mặc định = 1) => giữ nguyên
    assert.equal(calculateBaseQuantity(10), 10);
    assert.equal(calculateBaseQuantity(10, 0), 10);
    assert.equal(calculateBaseQuantity(10, -1), 10);
});

test('quy đổi giá nhập theo đóng gói về giá theo đơn vị cơ sở', () => {
    // 1 Lọ = 2.5 ml, giá 1 Lọ = 50.000đ => giá cơ sở = 20.000đ/ml
    assert.equal(calculateBasePrice(50000, 2.5), 20000);

    // Xuất 1.5 ml với giá cơ sở 20.000đ/ml => 30.000đ (khớp ví dụ người dùng hỏi)
    assert.equal(1.5 * calculateBasePrice(50000, 2.5), 30000);

    // Không có hệ số quy đổi (mặc định = 1) => giữ nguyên giá đã nhập
    assert.equal(calculateBasePrice(20000), 20000);
    assert.equal(calculateBasePrice(20000, 0), 20000);
    assert.equal(calculateBasePrice(20000, -1), 20000);

    // Làm tròn 2 chữ số thập phân
    assert.equal(calculateBasePrice(100000, 3), 33333.33);
});

test('định dạng nhãn đơn vị tính rõ ràng', () => {
    assert.equal(formatUnitLabel(1.2, 'ml'), '1.2 ml');
    assert.equal(formatUnitLabel(5, 'chiếc'), '5 chiếc');
    assert.equal(formatUnitLabel(10, ''), `10 ${DEFAULT_BASE_UNIT}`);
    assert.equal(formatUnitLabel(10, null), `10 ${DEFAULT_BASE_UNIT}`);
});

test('định dạng hiển thị tồn kho kép (cơ sở + đóng gói)', () => {
    // Không quy đổi
    assert.equal(
        formatDualUnitDisplay({ baseQuantity: 50, baseUnit: 'chiếc' }),
        '50 chiếc'
    );

    // Quy đổi tròn hộp/lọ
    assert.equal(
        formatDualUnitDisplay({
            baseQuantity: 5.0,
            baseUnit: 'ml',
            importUnit: 'Lọ',
            conversionRate: 2.5
        }),
        '5 ml (~2 Lọ)'
    );

    // Quy đổi có phần dở
    assert.equal(
        formatDualUnitDisplay({
            baseQuantity: 3.8,
            baseUnit: 'ml',
            importUnit: 'Lọ',
            conversionRate: 2.5
        }),
        '3.8 ml (~1 Lọ + 1.3 ml)'
    );

    // Số lượng nhỏ hơn 1 đơn vị nhập
    assert.equal(
        formatDualUnitDisplay({
            baseQuantity: 1.2,
            baseUnit: 'ml',
            importUnit: 'Lọ',
            conversionRate: 2.5
        }),
        '1.2 ml'
    );
});

test('xác thực và chuẩn hóa cấu hình đơn vị tính', () => {
    // Trường hợp thông thường không quy đổi
    const normal = validateConversionConfig({ base_unit: 'chiếc' });
    assert.deepEqual(normal, {
        base_unit: 'chiếc',
        import_unit: null,
        conversion_rate: 1.0
    });

    // Trường hợp có quy đổi
    const converted = validateConversionConfig({
        base_unit: 'ml',
        import_unit: 'Lọ',
        conversion_rate: 2.5
    });
    assert.deepEqual(converted, {
        base_unit: 'ml',
        import_unit: 'Lọ',
        conversion_rate: 2.5
    });

    // Hệ số âm hoặc không hợp lệ
    assert.throws(
        () => validateConversionConfig({ base_unit: 'ml', import_unit: 'Lọ', conversion_rate: 0 }),
        /Hệ số quy đổi đóng gói phải là số dương lớn hơn 0/
    );
    assert.throws(
        () => validateConversionConfig({ base_unit: 'ml', import_unit: 'Lọ', conversion_rate: -2 }),
        /Hệ số quy đổi đóng gói phải là số dương lớn hơn 0/
    );
});

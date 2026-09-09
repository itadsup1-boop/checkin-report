import test from 'node:test';
import assert from 'node:assert/strict';
import {
    WarehouseError,
    aggregateOrderItems,
    parseQuantity,
    validateOrderInput
} from '../index.js';

const valid = {
    customer_name: 'Nguyễn Thị A',
    customer_phone: '0901234567',
    doctor_name: 'Bác sĩ An',
    technician_name: 'Kỹ thuật viên Bình',
    branch: 'US',
    idempotency_key: 'test-key',
    services: [
        {
            service_id: '00000000-0000-0000-0000-000000000001',
            items: [{
                product_id: '00000000-0000-0000-0000-000000000011',
                actual_quantity: 2
            }]
        },
        {
            service_id: '00000000-0000-0000-0000-000000000002',
            items: [{
                product_id: '00000000-0000-0000-0000-000000000011',
                actual_quantity: 3
            }]
        }
    ]
};

test('validation giữ sản phẩm theo dịch vụ nhưng aggregate cộng tổng ngầm', () => {
    const normalized = validateOrderInput(valid);
    assert.equal(normalized.services.length, 2);
    assert.equal(normalized.services[0].items[0].actual_quantity, 2);
    assert.equal(normalized.services[1].items[0].actual_quantity, 3);
    const totals = aggregateOrderItems(normalized.services.flatMap(service => service.items));
    assert.equal(totals.get(valid.services[0].items[0].product_id), 5);
});

test('validation nhận số thập phân hợp lệ và vẫn chặn số âm, sai độ chính xác', () => {
    const decimal = validateOrderInput({
        ...valid,
        services: [{
            ...valid.services[0],
            items: [{ ...valid.services[0].items[0], actual_quantity: 1.5 }]
        }]
    });
    assert.equal(decimal.services[0].items[0].actual_quantity, 1.5);
    assert.throws(() => validateOrderInput({
        ...valid,
        services: [{
            ...valid.services[0],
            items: [{ ...valid.services[0].items[0], actual_quantity: -1 }]
        }]
    }), WarehouseError);
    assert.throws(() => validateOrderInput({
        ...valid,
        services: [{
            ...valid.services[0],
            items: [{ ...valid.services[0].items[0], actual_quantity: 1.02 }]
        }]
    }), WarehouseError);
    assert.throws(() => validateOrderInput({ ...valid, branch: 'HN' }), WarehouseError);
});

test('quy tắc số lượng áp dụng riêng theo cấu hình từng sản phẩm', () => {
    assert.equal(parseQuantity(2, 'INTEGER'), 2);
    assert.equal(parseQuantity(1.2, 'DECIMAL'), 1.2);
    assert.equal(parseQuantity('2.300', 'DECIMAL'), 2.3);
    assert.equal(parseQuantity(1.2, 'INTEGER'), null);
    assert.equal(parseQuantity(1.02, 'DECIMAL'), null);
    assert.equal(parseQuantity(1.002, 'DECIMAL'), null);
    assert.equal(parseQuantity(1.2345, 'DECIMAL'), null);
    assert.equal(parseQuantity(0, 'DECIMAL'), null);
});

test('số điện thoại khách hàng chỉ yêu cầu tối thiểu 4 chữ số', () => {
    assert.equal(validateOrderInput({ ...valid, customer_phone: '1234' }).customer_phone, '1234');
    assert.equal(validateOrderInput({ ...valid, customer_phone: '+84 12' }).customer_phone, '+84 12');
    assert.throws(
        () => validateOrderInput({ ...valid, customer_phone: '12 3' }),
        error => error instanceof WarehouseError && error.code === 'INVALID_CUSTOMER_PHONE'
    );
});

test('đơn xuất theo khách bắt buộc có bác sĩ và kỹ thuật viên', () => {
    const normalized = validateOrderInput(valid);
    assert.equal(normalized.doctor_name, 'Bác sĩ An');
    assert.equal(normalized.technician_name, 'Kỹ thuật viên Bình');
    assert.throws(() => validateOrderInput({ ...valid, doctor_name: ' ' }), WarehouseError);
    assert.throws(() => validateOrderInput({ ...valid, technician_name: '' }), WarehouseError);
});

test('sản phẩm bị loại không được cộng vào tổng tồn', () => {
    const totals = aggregateOrderItems([
        { product_id: 'p1', actual_quantity: 4, is_removed: true },
        { product_id: 'p1', actual_quantity: 2, is_removed: false }
    ]);
    assert.equal(totals.get('p1'), 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    WarehouseError,
    aggregateOrderItems,
    validateOrderInput
} from '../index.js';

const valid = {
    customer_name: 'Nguyễn Thị A',
    customer_phone: '0901234567',
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

test('validation chặn số lượng thập phân, âm và cơ sở không hợp lệ', () => {
    assert.throws(
        () => validateOrderInput({
            ...valid,
            services: [{
                ...valid.services[0],
                items: [{ ...valid.services[0].items[0], actual_quantity: 1.5 }]
            }]
        }),
        WarehouseError
    );
    assert.throws(() => validateOrderInput({ ...valid, branch: 'HN' }), WarehouseError);
});

test('sản phẩm bị loại không được cộng vào tổng tồn', () => {
    const totals = aggregateOrderItems([
        { product_id: 'p1', actual_quantity: 4, is_removed: true },
        { product_id: 'p1', actual_quantity: 2, is_removed: false }
    ]);
    assert.equal(totals.get('p1'), 2);
});

import { WAREHOUSE_BRANCHES, WarehouseError } from './constants.js';

function cleanText(value) {
    return String(value ?? '').trim();
}

function positiveInteger(value, fieldName) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new WarehouseError(`${fieldName} phải là số nguyên dương.`, {
            code: 'INVALID_QUANTITY'
        });
    }
    return parsed;
}

export function validateOrderInput(input, { allowDraft = false } = {}) {
    const customerName = cleanText(input?.customer_name);
    const customerPhone = cleanText(input?.customer_phone);
    const branch = cleanText(input?.branch).toUpperCase();
    const idempotencyKey = cleanText(input?.idempotency_key);
    const services = Array.isArray(input?.services) ? input.services : [];

    if (!customerName) throw new WarehouseError('Tên khách hàng là bắt buộc.');
    if (!customerPhone) throw new WarehouseError('Số điện thoại khách hàng là bắt buộc.');
    if (customerPhone.replace(/\D/g, '').length < 4) {
        throw new WarehouseError('Số điện thoại khách hàng phải có ít nhất 4 chữ số.', {
            code: 'INVALID_CUSTOMER_PHONE'
        });
    }
    if (!WAREHOUSE_BRANCHES.includes(branch)) {
        throw new WarehouseError('Cơ sở chỉ được chọn US/MEDITECH hoặc UK.');
    }
    if (!idempotencyKey || idempotencyKey.length > 100) {
        throw new WarehouseError('Khóa chống gửi trùng không hợp lệ.');
    }
    if (services.length === 0) {
        throw new WarehouseError('Đơn phải có ít nhất một dịch vụ.');
    }

    const normalizedServices = services.map((service, serviceIndex) => {
        const serviceId = cleanText(service?.service_id);
        const items = Array.isArray(service?.items) ? service.items : [];
        if (!serviceId) throw new WarehouseError('Dịch vụ không hợp lệ.');

        const normalizedItems = items.map((item, itemIndex) => {
            const productId = cleanText(item?.product_id);
            if (!productId) throw new WarehouseError('Sản phẩm không hợp lệ.');
            const isRemoved = item?.is_removed === true;
            return {
                product_id: productId,
                actual_quantity: positiveInteger(item?.actual_quantity ?? item?.quantity, 'Số lượng sản phẩm'),
                item_source: item?.item_source === 'MANUAL' ? 'MANUAL' : 'TEMPLATE',
                is_removed: isRemoved,
                display_order: Number.isInteger(Number(item?.display_order))
                    ? Number(item.display_order)
                    : itemIndex
            };
        });

        if (!allowDraft && !normalizedItems.some(item => !item.is_removed)) {
            throw new WarehouseError('Mỗi đơn phải còn ít nhất một sản phẩm sử dụng.');
        }

        return {
            service_id: serviceId,
            display_order: Number.isInteger(Number(service?.display_order))
                ? Number(service.display_order)
                : serviceIndex,
            items: normalizedItems
        };
    });

    if (!allowDraft && !normalizedServices.some(service =>
        service.items.some(item => !item.is_removed && item.actual_quantity > 0)
    )) {
        throw new WarehouseError('Đơn phải có ít nhất một sản phẩm thực tế.');
    }

    return {
        customer_name: customerName,
        customer_phone: customerPhone,
        branch,
        idempotency_key: idempotencyKey,
        services: normalizedServices
    };
}

export function aggregateOrderItems(orderItems) {
    const totals = new Map();
    for (const item of orderItems) {
        if (item.is_removed) continue;
        const current = totals.get(item.product_id) || 0;
        totals.set(item.product_id, current + Number(item.actual_quantity));
    }
    return totals;
}

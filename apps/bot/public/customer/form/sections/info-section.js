/**
 * Phần 1 — Thông tin khách hàng: tư vấn viên, loại khách, tên, SĐT, địa chỉ,
 * dịch vụ, quà tặng.
 *
 * Trả về cả node lẫn hàm đọc giá trị, để tầng app.js không phải biết id của
 * từng ô nhập.
 */

import { h } from '../../../shared-ui/core/dom.js';
import { CUSTOMER_TYPES } from '../domain/record-rules.js';
import { card, sectionTitle, field, textInput, selectInput } from '../ui/components.js';

export function createInfoSection() {
    const inputs = {
        consultant: textInput({ placeholder: 'Tên người tư vấn' }),
        customerType: selectInput({ options: CUSTOMER_TYPES, value: 'NEW' }),
        customerName: textInput({ placeholder: 'Họ và tên khách' }),
        phone: textInput({ type: 'tel', placeholder: 'Số điện thoại khách', inputMode: 'tel' }),
        address: textInput({ placeholder: 'Địa chỉ (nếu có)' }),
        service: textInput({ placeholder: 'Dịch vụ khách sử dụng' }),
        gift: textInput({ placeholder: 'Quà tặng kèm (nếu có)' })
    };

    const node = card(
        sectionTitle('Thông tin khách hàng'),
        field({ label: 'Tư vấn viên', required: true, input: inputs.consultant }),
        field({ label: 'Loại khách', required: true, input: inputs.customerType }),
        field({ label: 'Tên khách hàng', required: true, input: inputs.customerName }),
        field({ label: 'Số điện thoại', required: true, input: inputs.phone }),
        field({ label: 'Địa chỉ', input: inputs.address }),
        field({ label: 'Dịch vụ', required: true, input: inputs.service }),
        field({ label: 'Quà tặng', input: inputs.gift })
    );

    return {
        node,
        inputs,
        read: () => ({
            consultant: inputs.consultant.value.trim(),
            customer_type: inputs.customerType.value,
            customer_name: inputs.customerName.value.trim(),
            phone: inputs.phone.value.trim(),
            address: inputs.address.value.trim(),
            service: inputs.service.value.trim(),
            gift: inputs.gift.value.trim()
        })
    };
}

/**
 * Bước 2: thông tin khách hàng.
 *
 * `suggestionSlot` do tầng điều phối sở hữu và truyền vào, KHÔNG tạo tại đây:
 * tra cứu khách cũ chạy nền trong lúc người dùng còn đang gõ số điện thoại, nếu
 * mỗi lần vẽ lại bước này lại sinh một ô mới thì kết quả tra cứu sẽ đổ vào ô đã
 * bị gỡ khỏi màn hình.
 */

import { h } from '../../../../../shared-ui/core/dom.js';
import { textField } from '../../../ui/components.js';

/**
 * @param {object} params
 * @param {object} params.state
 * @param {HTMLElement} params.suggestionSlot
 * @param {(field:'name'|'phone', value:string) => void} params.onChange
 */
export function renderCustomerStep({ state, suggestionSlot, onChange }) {
    return h('div', null,
        h('p', { class: 'section-label' }, 'Thông tin khách hàng nhận dịch vụ'),
        textField({
            label: 'Tên khách hàng',
            iconName: 'user',
            value: state.customerName,
            placeholder: 'VD: Nguyễn Thị A',
            onInput: value => onChange('name', value)
        }),
        textField({
            label: 'Số điện thoại',
            iconName: 'phone',
            value: state.customerPhone,
            placeholder: 'Nhập ít nhất 4 số',
            inputMode: 'tel',
            maxLength: 20,
            onInput: value => onChange('phone', value)
        }),
        suggestionSlot
    );
}

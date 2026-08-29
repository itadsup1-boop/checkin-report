/**
 * Bước 3: chọn dịch vụ.
 *
 * Danh sách dịch vụ và số sản phẩm mẫu đều lấy từ cấu hình Admin, không hardcode.
 * Chưa cấu hình dịch vụ nào thì nói rõ để nhân viên biết phải báo ai, thay vì
 * hiện màn hình trống.
 */

import { h, cx } from '../../../../../shared-ui/core/dom.js';
import { icon } from '../../../../../shared-ui/ui/icons.js';
import { notice } from '../../../ui/components.js';

/**
 * @param {object} params
 * @param {object} params.catalog
 * @param {object} params.state
 * @param {(serviceId:string) => void} params.onToggle
 */
export function renderServiceStep({ catalog, state, onToggle }) {
    if (catalog.services.length === 0) {
        return notice('warn', 'Admin chưa cấu hình dịch vụ nào đang hoạt động.');
    }

    return h('div', null,
        h('p', { class: 'section-label' }, 'Chọn một hoặc nhiều dịch vụ cho khách'),
        h('div', { class: 'stack-sm' },
            catalog.services.map(service => {
                const on = state.selections.has(service.id);
                return h('button', {
                    class: cx('choice', on && 'choice--on'),
                    type: 'button',
                    onClick: () => onToggle(service.id)
                },
                    h('div', { class: 'choice__icon' }, icon('layers', { size: 18 })),
                    h('div', { class: 'choice__main' },
                        h('div', { class: 'choice__title' }, service.service_name),
                        h('div', { class: 'choice__sub' }, `${service.items.length} sản phẩm mẫu`)
                    ),
                    h('div', { class: 'choice__tick' }, on ? icon('check', { size: 14 }) : null)
                );
            })
        )
    );
}

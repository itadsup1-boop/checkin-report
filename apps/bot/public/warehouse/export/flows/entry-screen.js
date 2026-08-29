/**
 * Màn hình chọn loại đơn xuất kho.
 *
 * "Xuất theo khách hàng" chỉ bật khi group đã bật cờ đơn dịch vụ VÀ Admin đã
 * cấu hình ít nhất một dịch vụ — nếu không, server sẽ từ chối đơn nên UI phải
 * nói rõ lý do thay vì cho nhân viên nhập xong rồi mới báo lỗi.
 */

import { h } from '../../../shared-ui/core/dom.js';
import { icon, iconTile } from '../../../shared-ui/ui/icons.js';
import { notice } from '../ui/components.js';

// Ba luồng phân biệt bằng ĐẬM/NHẠT của cùng màu chủ đạo, không phải các màu khác
// nhau: cả ba Mini App kho dùng chung một bộ token (xem theme-tokens.css).
const CUSTOMER_TONE = 'brand';
const QUICK_TONE = 'alt';
const TRANSFER_TONE = 'alt';

function optionCard({ iconName, title, desc, tone, onClick, disabled, disabledReason }) {
    return h('div', null,
        h('button', {
            class: 'option option--compact',
            type: 'button',
            disabled,
            onClick: disabled ? null : onClick
        },
            h('div', { class: 'option__row' },
                iconTile(iconName, { tone }),
                h('div', { class: 'option__info' },
                    h('div', { class: 'option__title' }, title),
                    h('div', { class: 'option__desc' }, desc)
                ),
                icon('chevronRight', { size: 18, class: 'text-muted' })
            )
        ),
        disabled && disabledReason
            ? h('div', { style: { marginTop: '8px' } }, notice('warn', disabledReason))
            : null
    );
}

/**
 * @param {object} params
 * @param {{serviceOrderEnabled:boolean, services:Array, products:Array}} params.catalog
 * @param {(flow:'customer'|'quick'|'transfer')=>void} params.onPick
 */
export function createEntryScreen({ catalog, onPick }) {
    const hasServices = catalog.services.length > 0;
    const customerReady = catalog.serviceOrderEnabled && hasServices;

    let disabledReason = null;
    if (!catalog.serviceOrderEnabled) {
        disabledReason = 'Nhóm này chưa bật đơn xuất theo dịch vụ. Admin cần bật trong Web Admin → Quản lý kho.';
    } else if (!hasServices) {
        disabledReason = 'Admin chưa cấu hình dịch vụ nào. Hãy tạo dịch vụ và mẫu sản phẩm trong Web Admin trước.';
    }

    const noProducts = catalog.products.length === 0;

    return h('div', { class: 'app__body', style: { paddingTop: '16px' } },
        h('div', { class: 'stack' },
            noProducts
                ? notice('warn', 'Danh mục sản phẩm đang trống. Hãy nhập kho hoặc thêm sản phẩm trước khi tạo đơn xuất.')
                : null,

            optionCard({
                iconName: 'users',
                title: 'Xuất theo khách hàng',
                desc: 'Gắn khách hàng, chọn theo dịch vụ.',
                tone: CUSTOMER_TONE,
                disabled: !customerReady,
                disabledReason,
                onClick: () => onPick('customer')
            }),

            optionCard({
                iconName: 'bag',
                title: 'Xuất lẻ',
                desc: 'Xuất nhanh, không cần thông tin khách.',
                tone: QUICK_TONE,
                disabled: noProducts,
                onClick: () => onPick('quick')
            }),

            optionCard({
                iconName: 'arrowLeftRight',
                title: 'Chuyển kho',
                desc: 'Chuyển hàng thật giữa hai cơ sở.',
                tone: TRANSFER_TONE,
                disabled: noProducts,
                onClick: () => onPick('transfer')
            })
        )
    );
}

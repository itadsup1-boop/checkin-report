/**
 * Màn hình chọn loại đơn xuất kho.
 *
 * "Xuất theo khách hàng" chỉ bật khi group đã bật cờ đơn dịch vụ VÀ Admin đã
 * cấu hình ít nhất một dịch vụ — nếu không, server sẽ từ chối đơn nên UI phải
 * nói rõ lý do thay vì cho nhân viên nhập xong rồi mới báo lỗi.
 */

import { h } from '../core/dom.js';
import { icon, iconTile } from '../ui/icons.js';
import { notice } from '../ui/components.js';

const CUSTOMER_ACCENT = '#f43f5e';
const QUICK_ACCENT = '#0891b2';

function optionCard({ iconName, title, desc, tags, accent, onClick, disabled, disabledReason }) {
    return h('div', null,
        h('button', {
            class: 'option',
            type: 'button',
            disabled,
            onClick: disabled ? null : onClick
        },
            h('div', { class: 'option__top' },
                iconTile(iconName, { background: `${accent}15`, color: accent }),
                icon('chevronRight', { size: 20, class: 'text-muted' })
            ),
            h('div', { class: 'option__title' }, title),
            h('div', { class: 'option__desc' }, desc),
            h('div', { class: 'option__tags' },
                tags.map(tag => h('span', {
                    class: 'option__tag',
                    style: { background: `${accent}14`, color: accent }
                }, tag))
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
 * @param {(flow:'customer'|'quick')=>void} params.onPick
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
                desc: 'Tạo đơn gắn với khách hàng cụ thể, chọn một hoặc nhiều dịch vụ, sản phẩm hiển thị tách riêng theo từng dịch vụ.',
                tags: ['Có tên & SĐT khách', 'Nhiều dịch vụ', 'Theo mẫu dịch vụ'],
                accent: CUSTOMER_ACCENT,
                disabled: !customerReady,
                disabledReason,
                onClick: () => onPick('customer')
            }),

            optionCard({
                iconName: 'bag',
                title: 'Xuất lẻ',
                desc: 'Xuất nhanh không cần gắn khách hàng hay dịch vụ. Phù hợp xuất nội bộ, dùng thử, hoặc khách vãng lai.',
                tags: ['Không cần thông tin khách', 'Quét mã nhanh', 'Chọn từ danh mục'],
                accent: QUICK_ACCENT,
                disabled: noProducts,
                onClick: () => onPick('quick')
            }),

            h('div', { class: 'card' },
                h('div', { class: 'card__body' },
                    h('div', {
                        class: 'row-between',
                        style: { marginBottom: '10px', justifyContent: 'flex-start', gap: '8px' }
                    },
                        icon('clipboard', { size: 15, class: 'text-muted' }),
                        h('span', { style: { fontSize: '12px', fontWeight: '700', color: 'var(--muted)' } },
                            'Cả hai loại đơn đều')
                    ),
                    h('div', { class: 'stack-sm' },
                        [
                            'Chọn cơ sở ngay ở bước đầu tiên',
                            'Cảnh báo ngay khi số lượng vượt tồn kho',
                            'Nhân viên tạo đơn phải chờ người có quyền kho duyệt'
                        ].map(text => h('div', {
                            style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--muted)' }
                        },
                            h('span', {
                                style: {
                                    width: '6px', height: '6px', borderRadius: '999px',
                                    background: 'var(--line)', flexShrink: '0'
                                }
                            }),
                            text
                        ))
                    )
                )
            )
        )
    );
}

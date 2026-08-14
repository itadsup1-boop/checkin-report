/**
 * Thành phần UI của màn hình tồn kho.
 * Mỗi hàm trả về HTMLElement thuần, không giữ state — state nằm ở tầng screens.
 */

import { h, cx } from '../../../shared-ui/core/dom.js';
import { icon } from '../../../shared-ui/ui/icons.js';
import { BRANCHES } from '../data/inventory-repo.js';

/* ---------- Tab chọn cơ sở ---------- */

export function branchTabs({ value, onChange }) {
    const options = [
        { code: 'all', label: 'Tất cả' },
        ...BRANCHES.map(branch => ({ code: branch.code, label: branch.short }))
    ];

    return h('div', { class: 'branch-tabs' },
        options.map(option => h('button', {
            class: cx('branch-tabs__item', value === option.code && 'branch-tabs__item--on'),
            type: 'button',
            onClick: () => onChange(option.code)
        }, option.label))
    );
}

/* ---------- Thẻ thống kê ---------- */

export function statCard({ iconName, label, value, hint }) {
    return h('div', { class: 'stat' },
        h('div', { class: 'stat__label' }, icon(iconName, { size: 13 }), label),
        h('div', { class: 'stat__value' }, String(value)),
        hint ? h('div', { class: 'stat__hint' }, hint) : null
    );
}

/** Thẻ "cần chú ý" bấm được để lọc nhanh. */
export function alertStatCard({ value, hint, active, onClick }) {
    return h('button', {
        class: cx('stat', active && 'stat--alert'),
        type: 'button',
        onClick
    },
        h('div', { class: 'stat__label' }, icon('trendingDown', { size: 13 }), 'Cần chú ý'),
        h('div', { class: 'stat__value' }, String(value)),
        h('div', { class: 'stat__hint' }, hint)
    );
}

/* ---------- Dải cảnh báo ---------- */

export function shortageBanner({ outOfStock, lowStock, onClick }) {
    return h('button', { class: 'banner', type: 'button', onClick },
        icon('alert', { size: 17, style: 'flex-shrink:0' }),
        h('div', { class: 'banner__text' },
            h('span', { class: 'strong' }, `${outOfStock} hết hàng, ${lowStock} sắp hết`),
            ' — bấm để lọc nhanh danh sách cần xử lý.'
        ),
        icon('chevronRight', { size: 16 })
    );
}

/* ---------- Ô tìm kiếm ---------- */

export function searchBox({ value, onInput, onClear }) {
    const clearButton = h('button', {
        class: cx(!value && 'hidden'),
        type: 'button',
        'aria-label': 'Xóa tìm kiếm',
        onClick: onClear
    }, icon('x', { size: 15 }));

    const input = h('input', {
        class: 'search__input',
        value: value || '',
        placeholder: 'Tìm tên hoặc mã sản phẩm…',
        onInput: event => {
            clearButton.classList.toggle('hidden', event.target.value === '');
            onInput(event.target.value);
        }
    });

    return h('div', { class: 'search' },
        icon('search', { size: 16, class: 'text-muted' }),
        input,
        clearButton
    );
}

/* ---------- Nhãn tình trạng ---------- */

export function statusBadge(status) {
    return h('span', { class: `badge badge--${status.key}` }, status.label);
}

/* ---------- Dòng sản phẩm ---------- */

/**
 * @param {object} params
 * @param {boolean} params.showSplit hiện "US x / UK y" khi đang xem Tất cả
 */
export function productRow({ item, quantity, status, showSplit, onOpen }) {
    return h('button', { class: 'product', type: 'button', onClick: onOpen },
        h('div', { class: 'product__thumb' }, icon('package', { size: 17 })),
        h('div', { class: 'product__main' },
            h('div', { class: 'product__name' }, item.name),
            h('div', { class: 'product__meta' },
                item.barcode ? h('span', { class: 'product__code' }, item.barcode) : null,
                showSplit
                    ? h('span', { class: 'product__split' }, `· US ${item.stockUS} / UK ${item.stockUK}`)
                    : null
            )
        ),
        h('div', { class: 'product__right' },
            h('div', { class: 'product__qty' }, String(quantity)),
            statusBadge(status)
        ),
        icon('chevronRight', { size: 15, class: 'text-muted' })
    );
}

export function emptyState(message) {
    return h('div', { class: 'empty' }, message);
}

export function loadingScreen(message = 'Đang tải dữ liệu tồn kho…') {
    return h('div', { class: 'center' },
        h('div', { class: 'spinner', style: { marginBottom: '14px' } }),
        h('div', { class: 'strong' }, message)
    );
}

export function errorScreen({ message, onRetry }) {
    return h('div', { class: 'center' },
        h('div', {
            style: {
                width: '68px', height: '68px', borderRadius: '999px',
                background: 'var(--bad-soft)', color: 'var(--bad)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '16px'
            }
        }, icon('alert', { size: 32 })),
        h('div', { style: { fontSize: '17px', fontWeight: '800', marginBottom: '6px' } },
            'Không tải được dữ liệu'),
        h('div', { class: 'text-muted', style: { fontSize: '14px', marginBottom: '18px' } }, message),
        onRetry
            ? h('button', {
                class: 'branch-tabs__item branch-tabs__item--on',
                type: 'button',
                style: { padding: '0 20px', height: '40px' },
                onClick: onRetry
            }, 'Thử lại')
            : null
    );
}

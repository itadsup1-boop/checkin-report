/**
 * Thành phần UI của Mini App nhập kho.
 * Mỗi hàm trả về HTMLElement thuần, không giữ state — state nằm ở tầng steps/app.
 */

import { h, cx } from '../../../shared-ui/core/dom.js';
import { icon } from '../../../shared-ui/ui/icons.js';

/* ---------- Khung màn hình ---------- */

export function topBar({ title, subtitle, onBack }) {
    return h('div', { class: 'topbar' },
        h('div', { class: 'topbar__row' },
            onBack
                ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Quay lại', onClick: onBack },
                    icon('chevronLeft', { size: 18 }))
                : h('div', { class: 'icon-btn icon-btn--ghost' }),
            h('div', { class: 'topbar__text' },
                h('div', { class: 'topbar__title' }, title),
                subtitle ? h('div', { class: 'topbar__sub' }, subtitle) : null
            ),
            h('div', { class: 'topbar__spacer' })
        )
    );
}

export function stepDots({ total, current }) {
    return h('div', { class: 'steps' },
        Array.from({ length: total }, (_, index) => h('div', {
            class: cx('steps__dot',
                index === current && 'steps__dot--on',
                index < current && 'steps__dot--done')
        }))
    );
}

export function bottomBar(...children) {
    return h('div', { class: 'bottombar' }, children);
}

/**
 * @param {object} params
 * @param {'brand'|'dark'|'alt'|'ghost'} [params.variant]
 */
export function button({ label, onClick, disabled, iconName, variant = 'brand', spinning }) {
    return h('button', {
        class: cx('btn', variant === 'dark' && 'btn--dark', variant === 'alt' && 'btn--alt', variant === 'ghost' && 'btn--ghost'),
        type: 'button',
        disabled: Boolean(disabled),
        onClick
    },
        iconName ? icon(iconName, { size: 18, class: spinning ? 'spin' : '' }) : null,
        label
    );
}

/* ---------- Thông báo ---------- */

const NOTICE_ICON = { warn: 'alert', bad: 'alert', ok: 'check', info: 'info' };

export function notice(tone, ...children) {
    return h('div', { class: `notice notice--${tone}` },
        icon(NOTICE_ICON[tone] || 'info', { size: 16, class: 'notice__icon' }),
        h('div', null, children)
    );
}

/* ---------- Chọn cơ sở ---------- */

export function branchOption({ branch, selected, onPick }) {
    return h('button', {
        class: cx('branch-option', selected && 'branch-option--on'),
        type: 'button',
        onClick: () => onPick(branch.code)
    },
        h('div', { class: 'branch-option__icon' }, icon('mapPin', { size: 18 })),
        h('div', { style: { flex: '1', minWidth: '0' } },
            h('div', { class: 'branch-option__name' }, branch.name),
            h('div', { class: 'branch-option__note' }, 'Hàng chỉ cộng vào tồn kho cơ sở này')
        ),
        selected ? icon('check', { size: 18, class: 'text-brand' }) : null
    );
}

/* ---------- Hai nút thêm sản phẩm ---------- */

export function actionTiles({ onScan, onManual }) {
    return h('div', { class: 'action-grid' },
        h('button', { class: 'action-tile action-tile--scan', type: 'button', onClick: onScan },
            icon('camera', { size: 22 }), 'Quét mã sản phẩm'),
        h('button', { class: 'action-tile action-tile--manual', type: 'button', onClick: onManual },
            icon('plus', { size: 22 }), 'Nhập thủ công')
    );
}

/* ---------- Thẻ tổng hợp phiếu ---------- */

export function summaryCard({ itemCount, total, onOpen }) {
    const clickable = itemCount > 0;
    return h('button', {
        class: 'summary-card',
        type: 'button',
        disabled: !clickable,
        onClick: clickable ? onOpen : undefined
    },
        h('div', { class: 'summary-card__icon' }, icon('package', { size: 20 })),
        h('div', { style: { flex: '1', minWidth: '0', textAlign: 'left' } },
            h('div', { class: 'summary-card__title' }, `${itemCount} sản phẩm đã thêm`),
            h('div', { class: 'summary-card__note' }, `Tổng số lượng: +${total}`)
        ),
        clickable ? icon('chevronRight', { size: 17, class: 'text-muted' }) : null
    );
}

/* ---------- Dòng sản phẩm trong phiếu ---------- */

export function itemRow({ item, onRemove }) {
    return h('div', { class: 'item-row' },
        h('div', { class: 'item-row__thumb' }, icon('package', { size: 16 })),
        h('div', { class: 'item-row__main' },
            h('div', { class: 'item-row__name' }, item.productName),
            h('div', { class: 'item-row__meta' },
                icon('barcode', { size: 10 }),
                h('span', { class: 'item-row__code' }, item.barcode),
                item.isNew ? h('span', { class: 'tag-new' }, '· Mới') : null
            )
        ),
        h('div', { class: 'item-row__qty' }, `+${item.quantity}`),
        onRemove
            ? h('button', { class: 'item-row__del', type: 'button', 'aria-label': 'Xóa dòng', onClick: onRemove },
                icon('trash', { size: 15 }))
            : null
    );
}

/* ---------- Ảnh minh chứng ---------- */

export function photoTile({ photo, onRemove }) {
    return h('div', { class: 'photo' },
        h('img', { src: photo.url, alt: 'Ảnh minh chứng' }),
        h('button', { class: 'photo__del', type: 'button', 'aria-label': 'Xóa ảnh', onClick: onRemove },
            icon('x', { size: 12 }))
    );
}

export function photoAddTile({ onClick }) {
    return h('button', { class: 'photo-add', type: 'button', onClick },
        icon('camera', { size: 20 }), 'Chụp / Chọn'
    );
}

/* ---------- Dòng thông tin xác nhận ---------- */

export function reviewRow({ iconName, label, value, onClick }) {
    // Bấm được thì cả dòng là <button> để vùng chạm đủ rộng trên điện thoại.
    return h(onClick ? 'button' : 'div', {
        class: 'review-row',
        type: onClick ? 'button' : null,
        onClick
    },
        h('div', { class: 'review-row__label' }, icon(iconName, { size: 13 }), label),
        h('div', { class: 'review-row__value' },
            value,
            onClick ? icon('chevronRight', { size: 13, class: 'text-muted' }) : null
        )
    );
}

export function totalRow({ total }) {
    return h('div', { class: 'total-row' },
        h('div', { class: 'total-row__label' }, 'Tổng số lượng nhập'),
        h('div', { class: 'total-row__value' }, `+${total}`)
    );
}

/* ---------- Ô nhập ---------- */

export function field({ label, input, note, error }) {
    return h('div', { class: 'field' },
        label ? h('label', { class: 'field__label' }, label) : null,
        input,
        error
            ? h('div', { class: 'field__error' }, icon('alert', { size: 12 }), error)
            : (note ? h('div', { class: 'field__note' }, note) : null)
    );
}

/** Ô nhập số lượng: chỉ nhận chữ số, khớp ràng buộc số nguyên dương của server. */
export function quantityInput({ value, onInput }) {
    const input = h('input', {
        class: 'field__input',
        inputmode: 'numeric',
        placeholder: 'VD: 20',
        value: value || '',
        onInput: event => {
            const digits = event.target.value.replace(/[^0-9]/g, '');
            if (digits !== event.target.value) event.target.value = digits;
            onInput(digits);
        }
    });
    return input;
}

export function emptyState(message) {
    return h('div', { class: 'empty' }, message);
}

export function loadingScreen(message = 'Đang tải danh mục sản phẩm…') {
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
        h('div', { style: { fontSize: '17px', fontWeight: '800', marginBottom: '6px' } }, 'Không mở được màn hình nhập kho'),
        h('div', { class: 'text-muted', style: { fontSize: '14px', marginBottom: '18px' } }, message),
        onRetry
            ? h('div', { style: { width: '100%', maxWidth: '260px' } }, button({ label: 'Thử lại', onClick: onRetry, iconName: 'refresh' }))
            : null
    );
}

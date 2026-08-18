/**
 * Thành phần UI dùng chung cho cả hai luồng xuất kho.
 * Mỗi hàm trả về một HTMLElement thuần, không giữ state — state nằm ở tầng flow.
 */

import { h, cx } from '../../../shared-ui/core/dom.js';
import { icon } from '../../../shared-ui/ui/icons.js';
import { BRANCHES } from '../data/warehouse-repo.js';

/* ---------- Bố cục ---------- */

export function topBar({ title, subtitle, onBack }) {
    return h('div', { class: 'topbar' },
        h('div', { class: 'topbar__row' },
            h('button', { class: 'topbar__back', type: 'button', 'aria-label': 'Quay lại', onClick: onBack },
                icon('chevronLeft', { size: 20 })
            ),
            h('div', { class: 'topbar__titles' },
                h('div', { class: 'topbar__title' }, title),
                subtitle ? h('div', { class: 'topbar__sub' }, subtitle) : null
            ),
            h('div', { class: 'topbar__spacer' })
        )
    );
}

export function stepDots(total, current) {
    return h('div', { class: 'steps' },
        Array.from({ length: total }, (_, index) => h('div', {
            class: cx(
                'steps__dot',
                index === current && 'steps__dot--active',
                index < current && 'steps__dot--done'
            )
        }))
    );
}

export function bottomBar(...children) {
    return h('div', { class: 'bottombar' }, ...children);
}

export function primaryButton({ label, onClick, disabled = false, iconName, variant = 'primary', spinning = false }) {
    return h('button', {
        class: cx('btn', `btn--${variant}`),
        type: 'button',
        disabled,
        onClick
    },
        iconName ? icon(iconName, { size: 18, class: spinning ? 'spin' : '' }) : null,
        label
    );
}

/* ---------- Hiển thị ---------- */

export function notice(tone, ...children) {
    const iconByTone = { ok: 'check', warn: 'alert', bad: 'alert', info: 'info' };
    return h('div', { class: `notice notice--${tone}` },
        h('span', { class: 'notice__icon' }, icon(iconByTone[tone] || 'info', { size: 16 })),
        h('div', null, ...children)
    );
}

export function card({ title, iconName, body, foot }) {
    return h('div', { class: 'card' },
        title ? h('div', { class: 'card__head' },
            iconName ? icon(iconName, { size: 15, class: 'text-brand' }) : null,
            h('span', null, title)
        ) : null,
        body ? h('div', { class: 'card__body' }, body) : null,
        foot || null
    );
}

export function summaryRow(label, value) {
    return h('div', { class: 'row-between', style: { padding: '3px 0' } },
        h('span', { class: 'hint' }, label),
        h('span', { class: 'strong', style: { fontSize: '13px' } }, value)
    );
}

export function emptyState(message) {
    return h('div', { class: 'empty' }, message);
}

/* ---------- Nhập liệu ---------- */

export function textField({ label, iconName, value, placeholder, onInput, inputMode, hint, maxLength = 120 }) {
    const input = h('input', {
        class: 'field__input',
        value: value || '',
        placeholder: placeholder || '',
        maxlength: maxLength,
        ...(inputMode ? { inputmode: inputMode } : {}),
        onInput: event => onInput(event.target.value)
    });

    return h('label', { class: 'field' },
        h('span', { class: 'field__label' },
            iconName ? icon(iconName, { size: 13 }) : null,
            label
        ),
        input,
        hint ? h('span', { class: 'field__hint' }, hint) : null
    );
}

export function stepper({ value, onChange, over = false, min = 0, step = 1, allowDecimal = false }) {
    const round = next => Number(Number(next).toFixed(1));
    const changeFromInput = event => {
        const next = Number(event.target.value);
        const hasValidPrecision = Math.abs(next * 10 - Math.round(next * 10)) <= 1e-7;
        if (!Number.isFinite(next) || next < min || (allowDecimal ? !hasValidPrecision : !Number.isInteger(next))) {
            event.target.value = String(value);
            return;
        }
        onChange(round(next), { render: false });
    };
    return h('div', { class: 'stepper' },
        h('button', {
            class: 'stepper__btn', type: 'button', 'aria-label': 'Giảm',
            onClick: () => onChange(round(Math.max(min, Number(value) - step)))
        }, icon('minus', { size: 13 })),
        h('input', {
            class: cx('stepper__value', over && 'stepper__value--over'),
            type: 'number',
            inputMode: allowDecimal ? 'decimal' : 'numeric',
            min: String(min),
            step: String(step),
            value: String(value),
            'aria-label': 'Số lượng',
            onChange: changeFromInput
        }),
        h('button', {
            class: 'stepper__btn', type: 'button', 'aria-label': 'Tăng',
            onClick: () => onChange(round(Number(value) + step))
        }, icon('plus', { size: 13 }))
    );
}

/* ---------- Chọn cơ sở ---------- */

export function branchPicker({ selected, onSelect, subtitle = 'Chọn cơ sở phát sinh đơn xuất kho' }) {
    return h('div', null,
        h('p', { class: 'section-label' }, subtitle),
        h('div', { class: 'stack-sm' },
            BRANCHES.map(branch => {
                const on = selected === branch.code;
                return h('button', {
                    class: cx('choice', on && 'choice--on'),
                    type: 'button',
                    onClick: () => onSelect(branch.code)
                },
                    h('div', { class: 'choice__icon' }, icon('mapPin', { size: 18 })),
                    h('div', { class: 'choice__main' },
                        h('div', { class: 'choice__title' }, branch.name),
                        h('div', { class: 'choice__sub' }, 'Kho hàng độc lập')
                    ),
                    on ? icon('check', { size: 18, class: 'text-brand' }) : null
                );
            })
        )
    );
}

/* ---------- Nhãn tồn kho ---------- */

/**
 * Badge tồn kho theo cơ sở đang chọn.
 * Không có đơn vị tính vì bảng tk_products không lưu trường đơn vị.
 */
export function stockBadge(quantity) {
    const tone = quantity === 0 ? 'out' : quantity <= 3 ? 'low' : 'ok';
    return h('span', { class: `badge badge--${tone}` }, `Tồn ${quantity}`);
}

/* ---------- Màn hình kết quả ---------- */

/**
 * Màn hình kết quả.
 * `onClose` giữ lại hành vi "HOÀN TẤT & ĐÓNG" của Mini App xuất kho cũ: nhân viên
 * gửi xong thường muốn đóng luôn để quay về khung chat.
 */
export function successScreen({ title, message, rows, onExit, onClose }) {
    return h('div', { class: 'screen-center' },
        h('div', { class: 'success__badge' }, icon('check', { size: 38, stroke: 3 })),
        h('div', { style: { fontSize: '18px', fontWeight: '800', marginBottom: '6px' } }, title),
        h('div', { class: 'text-muted', style: { fontSize: '14px', marginBottom: '22px', lineHeight: '1.6' } }, message),
        rows?.length
            ? h('div', {
                class: 'card',
                style: { width: '100%', textAlign: 'left', marginBottom: '22px' }
            }, h('div', { class: 'card__body' }, rows.map(([label, value]) => summaryRow(label, value))))
            : null,
        onClose
            ? h('div', { style: { width: '100%', marginBottom: '14px' } },
                h('button', { class: 'btn btn--primary', type: 'button', onClick: onClose },
                    icon('check', { size: 17 }), 'Hoàn tất & đóng')
            )
            : null,
        h('button', { class: 'btn-link', type: 'button', onClick: onExit }, 'Tạo đơn khác')
    );
}

export function loadingScreen(message = 'Đang tải dữ liệu kho…') {
    return h('div', { class: 'screen-center' },
        h('div', { class: 'spinner', style: { marginBottom: '14px' } }),
        h('div', { class: 'strong' }, message)
    );
}

export function errorScreen({ message, onRetry }) {
    return h('div', { class: 'screen-center' },
        h('div', {
            class: 'success__badge',
            style: { background: 'var(--bad-soft)', color: 'var(--bad)', boxShadow: 'none' }
        }, icon('alert', { size: 34 })),
        h('div', { style: { fontSize: '17px', fontWeight: '800', marginBottom: '6px' } }, 'Không tải được dữ liệu'),
        h('div', { class: 'text-muted', style: { fontSize: '14px', marginBottom: '20px' } }, message),
        onRetry
            ? h('button', { class: 'btn btn--primary', type: 'button', onClick: onRetry },
                icon('refresh', { size: 17 }), 'Thử lại')
            : null
    );
}

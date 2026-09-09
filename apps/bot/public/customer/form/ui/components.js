/**
 * Thành phần UI của Mini App hồ sơ khách hàng.
 *
 * Dựng bằng h() thay vì chuỗi HTML — tên khách, địa chỉ và dịch vụ là dữ liệu
 * người dùng gõ, không được nối thẳng vào innerHTML.
 */

import { h, cx } from '../../../shared-ui/core/dom.js';

/* ---------- Bố cục ---------- */

export function card(...children) {
    return h('div', { class: 'card' }, children);
}

export function sectionTitle(text) {
    return h('div', { class: 'section-title' }, text);
}

/* ---------- Trường nhập ---------- */

export function field({ label, required, input, hint }) {
    return h('div', { class: 'form-group' },
        h('label', null, label, required ? h('span', { class: 'required' }, ' *') : null),
        input,
        hint ? h('div', { class: 'field-hint' }, hint) : null
    );
}

export function textInput({ type = 'text', placeholder, value, inputMode, disabled }) {
    return h('input', {
        type,
        class: 'form-control',
        placeholder,
        value: value || '',
        disabled: Boolean(disabled),
        ...(inputMode ? { inputmode: inputMode } : {})
    });
}

export function selectInput({ options, value }) {
    return h('select', { class: 'form-control', value: value || '' },
        options.map(option => h('option', { value: option.value }, option.label)));
}

/** Hai trường cạnh nhau trên một hàng. */
export function row(...children) {
    return h('div', { class: 'form-row' }, children);
}

/* ---------- Chọn chế độ nộp ảnh ---------- */

export function radioOption({ name, value, checked, title, description, onChange }) {
    const input = h('input', {
        type: 'radio', name, value, checked: Boolean(checked),
        onChange: event => { if (event.target.checked) onChange(value); }
    });
    return h('label', { class: 'media-mode' },
        input,
        h('div', null,
            h('div', { class: 'media-mode__title' }, title),
            h('div', { class: 'media-mode__desc' }, description)
        )
    );
}

/* ---------- Ảnh xem trước ---------- */

export function previewItem({ src, isVideo, onRemove }) {
    return h('div', { class: 'preview-item' },
        h('img', { src }),
        isVideo ? h('span', { class: 'video-badge' }, 'VIDEO') : null,
        h('button', {
            class: 'remove-btn', type: 'button',
            onClick: event => { event.preventDefault(); event.stopPropagation(); onRemove(); }
        }, '✕')
    );
}

/** Ảnh đại diện cho tệp video — SVG nội tuyến, không tải thêm gì. */
export const VIDEO_THUMB =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'"
    + " fill='%2364748b'%3E%3Cpath d='M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0"
    + " .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z'/%3E%3C/svg%3E";

/* ---------- Thông báo & trạng thái ---------- */

export function createAlert() {
    const node = h('div', { class: 'alert' });
    return {
        node,
        show(message) {
            node.textContent = message;
            node.style.display = 'block';
            globalThis.scrollTo?.({ top: 0, behavior: 'smooth' });
        },
        hide() { node.style.display = 'none'; }
    };
}

/** Lớp phủ khi đang gửi, kèm thanh tiến độ tải lên. */
export function createProgressOverlay() {
    const bar = h('div', { class: 'progress-bar' });
    const percent = h('div', { class: 'progress-text' }, '0%');
    const node = h('div', { class: 'loading-overlay' },
        h('div', { class: 'loading-card' },
            h('div', { class: 'spinner' }),
            h('div', { class: 'loading-title' }, 'Đang gửi hồ sơ…'),
            h('div', { class: 'progress-track' }, bar),
            percent
        )
    );
    node.style.display = 'none';
    return {
        node,
        show() { bar.style.width = '0%'; percent.textContent = '0%'; node.style.display = 'flex'; },
        hide() { node.style.display = 'none'; },
        set(value) { bar.style.width = `${value}%`; percent.textContent = `${value}%`; }
    };
}

export function successScreen({ description, onClose }) {
    return h('div', { class: 'success-screen' },
        h('div', { class: 'success-icon' }, '✅'),
        h('div', { class: 'success-title' }, 'Đã ghi nhận hồ sơ'),
        h('div', { class: 'success-desc' }, description),
        h('button', { class: cx('btn', 'btn-success'), type: 'button', onClick: onClose },
            'Hoàn tất & đóng')
    );
}

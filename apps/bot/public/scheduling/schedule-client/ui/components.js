/**
 * Thành phần UI của Mini App lịch khách.
 *
 * Tất cả dựng bằng h() thay vì chuỗi HTML. Bản cũ nối thẳng tên khách, số điện
 * thoại và tên nhân viên vào innerHTML — một cái tên chứa dấu ngoặc nhọn là đủ
 * làm hỏng danh sách. Chỉ có tab Báo bù escape thủ công, bốn tab còn lại thì không.
 */

import { h, cx, replaceChildren } from '../../../shared-ui/core/dom.js';

/* ---------- Ô thông báo ---------- */

/** Hộp thông báo tự ẩn sau 5 giây, giữ đúng hành vi bản cũ. */
export function createAlert() {
    const node = h('div', { class: 'alert' });
    let timer = null;

    function show(message, isError = true) {
        node.textContent = message;
        node.className = `alert ${isError ? 'alert-error' : 'alert-success'}`;
        node.style.display = 'block';
        clearTimeout(timer);
        timer = setTimeout(() => { node.style.display = 'none'; }, 5000);
    }

    /** Thông báo tiến trình: không tự ẩn, dùng khi đang tải ảnh lên. */
    function progress(message) {
        node.textContent = message;
        node.className = 'alert alert-progress';
        node.style.display = 'block';
        clearTimeout(timer);
    }

    return { node, show, progress };
}

/* ---------- Form ---------- */

export function field({ label, input, inline }) {
    return h('div', { class: cx('form-group', inline && 'form-group--inline') },
        label ? h('label', null, label) : null,
        input
    );
}

export function textInput({ id, type = 'text', placeholder, value, inputMode, rows }) {
    if (rows) {
        return h('textarea', { id, class: 'form-control', rows, placeholder, value: value || '' });
    }
    return h('input', {
        id, type, class: 'form-control', placeholder,
        value: value || '',
        ...(inputMode ? { inputmode: inputMode } : {})
    });
}

export function selectInput({ id, options, value, onChange }) {
    return h('select', {
        id, class: 'form-control',
        value: value || '',
        ...(onChange ? { onChange: event => onChange(event.target.value) } : {})
    }, options.map(option => h('option', { value: option.value }, option.label)));
}

export function button({ label, onClick, variant, size, id, style }) {
    return h('button', {
        id,
        class: cx('btn', variant && `btn-${variant}`, size === 'sm' && 'btn-sm'),
        type: 'button',
        onClick,
        ...(style ? { style } : {})
    }, label);
}

export function card(...children) {
    return h('div', { class: 'card' }, children);
}

export function sectionTitle(text) {
    return h('h3', { class: 'section-title' }, text);
}

/* ---------- Danh sách ---------- */

export function loader(text = 'Đang tải...') {
    return h('div', { class: 'loader' }, text);
}

export function emptyText(text, tone) {
    return h('p', { class: cx('empty-text', tone && `empty-text--${tone}`) }, text);
}

/**
 * Một dòng trên dòng thời gian.
 * @param {object} params
 * @param {string} params.time cột giờ bên trái; bỏ trống thì dòng xếp dọc
 */
export function timelineItem({ time, children, dimmed, stacked, tone }) {
    return h('div', {
        class: cx('timeline-item', stacked && 'timeline-item--stacked', tone && `timeline-item--${tone}`),
        ...(dimmed ? { style: { opacity: '.5' } } : {})
    },
        time ? h('div', { class: 'time' }, time) : null,
        h('div', { class: 'details' }, children)
    );
}

export function badge(text, tone) {
    return h('span', { class: cx('badge', tone && `badge--${tone}`) }, text);
}

/* ---------- Hộp thoại ---------- */

/**
 * Modal ẩn/hiện bằng class `show`, giống bản cũ nên CSS không phải đổi.
 * @returns {{node:HTMLElement, body:HTMLElement, open:Function, close:Function}}
 */
export function createModal({ title, footer }) {
    const body = h('div');
    const node = h('div', { class: 'modal-overlay' },
        h('div', { class: 'card modal-card' },
            h('h3', { class: 'modal-title' }, title),
            body,
            h('div', { class: 'modal-actions' }, footer)
        )
    );
    return {
        node,
        body,
        open: () => node.classList.add('show'),
        close: () => node.classList.remove('show'),
        setBody: (...children) => replaceChildren(body, ...children)
    };
}

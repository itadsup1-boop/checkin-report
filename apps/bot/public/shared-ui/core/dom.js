/**
 * Lớp tạo DOM tối giản.
 *
 * Dùng createElement thay vì innerHTML để tên khách hàng, tên sản phẩm
 * (dữ liệu do người dùng nhập) không bao giờ bị chèn HTML.
 */

/**
 * h('div', { class: 'card', onClick: fn }, child1, child2)
 * - class / className: chuỗi hoặc mảng (phần tử falsy bị bỏ)
 * - dataset: object
 * - style: object
 * - onXxx: gán listener
 * - thuộc tính khác: setAttribute, riêng value/checked/disabled gán trực tiếp
 */
export function h(tag, props = null, ...children) {
    const node = document.createElement(tag);

    if (props) {
        for (const [key, value] of Object.entries(props)) {
            if (value == null || value === false) continue;

            if (key === 'class' || key === 'className') {
                node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
            } else if (key === 'dataset') {
                Object.assign(node.dataset, value);
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(node.style, value);
            } else if (key === 'html') {
                // Chỉ dùng cho SVG icon nội bộ, không bao giờ cho dữ liệu người dùng.
                node.innerHTML = value;
            } else if (key.startsWith('on') && typeof value === 'function') {
                node.addEventListener(key.slice(2).toLowerCase(), value);
            } else if (key === 'value' || key === 'checked' || key === 'disabled') {
                node[key] = value;
            } else {
                node.setAttribute(key, value === true ? '' : String(value));
            }
        }
    }

    append(node, children);
    return node;
}

function append(parent, children) {
    for (const child of children) {
        if (child == null || child === false) continue;
        if (Array.isArray(child)) {
            append(parent, child);
        } else if (child instanceof Node) {
            parent.appendChild(child);
        } else {
            parent.appendChild(document.createTextNode(String(child)));
        }
    }
}

/** Xóa sạch rồi đặt nội dung mới. */
export function replaceChildren(parent, ...children) {
    parent.textContent = '';
    append(parent, children);
    return parent;
}

export function el(id) {
    return document.getElementById(id);
}

/** Gộp tên class có điều kiện. */
export function cx(...values) {
    return values.filter(Boolean).join(' ');
}

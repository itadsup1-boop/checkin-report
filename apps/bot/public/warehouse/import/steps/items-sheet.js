/**
 * Sheet xem lại và xóa các dòng đã thêm vào phiếu nhập.
 * Chỉ hiển thị + xóa; việc thêm nằm ở scan-sheet và manual-add-sheet.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { icon } from '../../../shared-ui/ui/icons.js';
import { totalQuantity } from '../domain/import-draft.js';
import { itemRow, emptyState } from '../ui/components.js';

/**
 * @param {object} params
 * @param {() => Array} params.getItems
 * @param {(index:number) => void} params.onRemove
 * @param {() => void} params.onClose
 */
export function createItemsSheet({ getItems, onRemove, onClose }) {
    const listSlot = h('div', { class: 'sheet__body' });
    const footSlot = h('div', { class: 'sheet__foot' });
    const titleSlot = h('div', { class: 'sheet__title' });

    function render() {
        const items = getItems();

        replaceChildren(titleSlot,
            icon('package', { size: 16 }),
            `Danh sách đã thêm (${items.length})`
        );

        replaceChildren(listSlot,
            items.length
                ? h('div', { class: 'rows' },
                    items.map((item, index) => itemRow({
                        item,
                        onRemove: () => {
                            onRemove(index);
                            render();
                        }
                    })))
                : emptyState('Chưa có sản phẩm nào trong phiếu')
        );

        replaceChildren(footSlot,
            h('div', {
                style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
            },
                h('span', { style: { fontSize: '12.5px', color: 'var(--muted)' } }, 'Tổng số lượng'),
                h('span', { style: { fontSize: '18px', fontWeight: '800', color: 'var(--brand)' } },
                    `+${totalQuantity(items)}`)
            )
        );
    }

    render();

    return h('div', { class: 'sheet' },
        h('div', { class: 'sheet__mask', onClick: onClose }),
        h('div', { class: 'sheet__panel' },
            h('div', { class: 'sheet__head' },
                titleSlot,
                h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đóng', onClick: onClose },
                    icon('x', { size: 16 }))
            ),
            listSlot,
            footSlot
        )
    );
}

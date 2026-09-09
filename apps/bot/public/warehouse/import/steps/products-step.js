/**
 * Bước 2: thêm sản phẩm vào phiếu — quét mã hoặc nhập tay.
 *
 * Bước này không tự giữ danh sách: nó đọc qua getItems() và báo thay đổi lên app,
 * để danh sách vẫn còn nguyên khi nhân sự đi qua lại giữa các bước.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { totalQuantity } from '../domain/import-draft.js';
import { actionTiles, summaryCard, notice } from '../ui/components.js';

/**
 * @param {object} params
 * @param {() => Array} params.getItems
 * @param {() => void} params.onScan
 * @param {() => void} params.onManual
 * @param {() => void} params.onOpenList
 */
export function createProductsStep({ getItems, onScan, onManual, onOpenList }) {
    const root = h('div');

    function render() {
        const items = getItems();
        replaceChildren(root,
            h('div', { class: 'hint' }, 'Quét mã vạch hoặc nhập tay để thêm sản phẩm vào phiếu'),
            actionTiles({ onScan, onManual }),
            summaryCard({
                itemCount: items.length,
                total: totalQuantity(items),
                onOpen: onOpenList
            }),
            items.length === 0
                ? h('div', { style: { marginTop: '12px' } },
                    notice('warn', 'Cần thêm ít nhất 1 sản phẩm để tiếp tục.'))
                : null
        );
    }

    render();
    return { root, refresh: render };
}

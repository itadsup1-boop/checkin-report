/**
 * Màn hình tổng quan tồn kho.
 *
 * Ba cách thu hẹp danh sách, kết hợp được với nhau:
 *   - Tab cơ sở: Tất cả / US / UK
 *   - Tìm theo tên hoặc mã vạch
 *   - Lọc "cần chú ý" (hết hàng hoặc sắp hết)
 *
 * Toàn bộ lọc chạy trên dữ liệu đã tải, không gọi lại máy chủ — danh mục chỉ vài
 * chục mặt hàng nên lọc tại máy vừa nhanh vừa đỡ tốn 3G của nhân sự.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { stockOf, stockStatus, summarize, branchName } from '../data/inventory-repo.js';
import {
    branchTabs, statCard, alertStatCard, shortageBanner,
    searchBox, productRow, emptyState
} from '../ui/components.js';
import { createProductDetailSheet } from './product-detail.js';

export function createInventoryOverview({ items }) {
    const root = h('div', { style: { display: 'contents' } });

    const state = {
        branch: 'all',
        query: '',
        onlyShortage: false,
        openedProduct: null
    };

    /* ---------- Dữ liệu dẫn xuất ---------- */

    function visibleItems() {
        const keyword = state.query.trim().toLowerCase();
        return items.filter(item => {
            if (keyword
                && !item.name.toLowerCase().includes(keyword)
                && !item.barcode.toLowerCase().includes(keyword)) {
                return false;
            }
            if (state.onlyShortage) {
                const status = stockStatus(stockOf(item, state.branch));
                if (status.key === 'ok') return false;
            }
            return true;
        });
    }

    /* ---------- Các vùng render riêng ---------- */

    // Tách vùng để khi gõ tìm kiếm chỉ vẽ lại danh sách, không vẽ lại ô input
    // (vẽ lại input sẽ làm mất con trỏ đang gõ trên điện thoại).
    const tabsSlot = h('div');
    const statsSlot = h('div');
    const bannerSlot = h('div');
    const listSlot = h('div');
    const sheetSlot = h('div');

    /** Vẽ lại mọi vùng phụ thuộc cơ sở/lọc. Không vẽ lại ô tìm kiếm. */
    function refresh() {
        renderTabs();
        renderSubtitle();
        renderStats();
        renderBanner();
        renderList();
    }

    // Tab phải vẽ lại theo state, không chỉ vẽ một lần lúc mở: nếu không, bấm US
    // thì số liệu đổi nhưng ô đang chọn vẫn nằm ở "Tất cả".
    function renderTabs() {
        replaceChildren(tabsSlot,
            branchTabs({
                value: state.branch,
                onChange: code => {
                    state.branch = code;
                    refresh();
                }
            })
        );
    }

    function renderStats() {
        const summary = summarize(items, state.branch);

        replaceChildren(statsSlot,
            h('div', { class: 'stats' },
                statCard({
                    iconName: 'barChart',
                    label: 'Tổng số lượng',
                    value: summary.totalQuantity,
                    hint: `${summary.productCount} mặt hàng`
                }),
                alertStatCard({
                    value: summary.needAttention,
                    hint: `${summary.outOfStock} hết · ${summary.lowStock} sắp hết`,
                    active: state.onlyShortage,
                    onClick: () => {
                        state.onlyShortage = !state.onlyShortage;
                        refresh();
                    }
                })
            )
        );
    }

    function renderBanner() {
        const summary = summarize(items, state.branch);
        const canDisplay = summary.needAttention > 0 && !state.onlyShortage;

        replaceChildren(bannerSlot,
            canDisplay
                ? shortageBanner({
                    outOfStock: summary.outOfStock,
                    lowStock: summary.lowStock,
                    onClick: () => {
                        state.onlyShortage = true;
                        refresh();
                    }
                })
                : null
        );
    }

    function renderList() {
        const visible = visibleItems();

        replaceChildren(listSlot,
            state.onlyShortage
                ? h('button', {
                    class: 'filter-off',
                    type: 'button',
                    onClick: () => {
                        state.onlyShortage = false;
                        refresh();
                    }
                }, 'Bỏ lọc "cần chú ý"')
                : null,

            h('div', { class: 'section-label' }, `${visible.length} sản phẩm`),

            visible.length === 0
                ? emptyState(items.length === 0
                    ? 'Chưa có sản phẩm nào trong kho'
                    : 'Không tìm thấy sản phẩm phù hợp')
                : h('div', { class: 'rows' },
                    visible.map(item => {
                        const quantity = stockOf(item, state.branch);
                        return productRow({
                            item,
                            quantity,
                            status: stockStatus(quantity),
                            showSplit: state.branch === 'all',
                            onOpen: () => openProduct(item)
                        });
                    })
                )
        );
    }

    function openProduct(item) {
        state.openedProduct = item;
        replaceChildren(sheetSlot, createProductDetailSheet({
            item,
            onClose: () => {
                state.openedProduct = null;
                replaceChildren(sheetSlot);
            }
        }));
    }

    /* ---------- Khung màn hình ---------- */

    const subtitleSlot = h('div', { class: 'topbar__sub' });

    function renderSubtitle() {
        replaceChildren(subtitleSlot,
            state.branch === 'all' ? 'Toàn hệ thống' : branchName(state.branch)
        );
    }

    function render() {
        replaceChildren(root,
            h('div', { class: 'topbar' },
                h('div', { class: 'topbar__title' }, 'Tồn kho'),
                subtitleSlot,
                tabsSlot
            ),
            h('div', { class: 'body' },
                statsSlot,
                bannerSlot,
                searchBox({
                    value: state.query,
                    onInput: value => {
                        state.query = value;
                        renderList();
                    },
                    // Bấm nút xóa: dựng lại cả khung để ô tìm kiếm nhận value mới.
                    onClear: () => {
                        state.query = '';
                        render();
                    }
                }),
                listSlot
            ),
            sheetSlot
        );

        refresh();
    }

    render();
    return root;
}

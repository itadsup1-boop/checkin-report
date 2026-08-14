/**
 * Luồng "Xuất lẻ": không gắn khách hàng, không theo mẫu dịch vụ.
 *
 * Gửi tới POST /api/warehouse/export/request với payload { chat_id, branch, items }
 * trong đó items = [{ barcode, quantity }] — đúng shape mà endpoint cũ đang đọc,
 * nên luồng duyệt/trừ tồn phía sau không thay đổi gì.
 *
 * Endpoint này chưa lưu ghi chú (bảng tk_warehouse_transactions không có cột note)
 * nên UI không hiển thị ô ghi chú để tránh mất dữ liệu người dùng vừa nhập.
 */

import { h, replaceChildren, cx } from '../../../shared-ui/core/dom.js';
import { icon } from '../../../shared-ui/ui/icons.js';
import {
    topBar, bottomBar, primaryButton, notice, branchPicker,
    stepper, stockBadge, successScreen, emptyState
} from '../ui/components.js';
import { apiPost } from '../../../shared-ui/core/api.js';
import { createDraftStore } from '../../../shared-ui/core/draft.js';
import { branchName, localStock } from '../data/warehouse-repo.js';
import { alertUser, notifySuccess, notifyError, closeApp, tapFeedback } from '../../../shared-ui/core/telegram.js';
import { openScanner } from '../../../shared-ui/ui/scanner.js';

export function createQuickExportFlow({ catalog, onExit }) {
    const draft = createDraftStore('quick');
    const root = h('div', { style: { display: 'contents' } });

    const state = {
        branch: null,
        query: '',
        cart: new Map(), // productId -> quantity
        cartOpen: false,
        submitting: false,
        submitted: false,
        scanFlash: false
    };

    const saved = draft.load();
    if (saved?.branch) {
        state.branch = saved.branch;
        for (const [productId, quantity] of saved.cart || []) {
            if (catalog.products.some(product => product.id === productId)) {
                state.cart.set(productId, Number(quantity) || 0);
            }
        }
    }

    const persist = () => draft.save({ branch: state.branch, cart: [...state.cart.entries()] });

    /* ---------- Dữ liệu dẫn xuất ---------- */

    const cartLines = () => [...state.cart.entries()]
        .map(([productId, quantity]) => {
            const product = catalog.products.find(item => item.id === productId);
            if (!product) return null;
            const available = localStock(catalog.stock, productId, state.branch);
            return { product, quantity, available, over: quantity > available };
        })
        .filter(Boolean);

    const totalQty = () => cartLines().reduce((sum, line) => sum + line.quantity, 0);
    const shortageLines = () => cartLines().filter(line => line.over);

    const filteredProducts = () => {
        const keyword = state.query.trim().toLowerCase();
        if (!keyword) return catalog.products;
        return catalog.products.filter(product =>
            product.product_name.toLowerCase().includes(keyword) ||
            product.barcode.toLowerCase().includes(keyword)
        );
    };

    /* ---------- Thao tác ---------- */

    function setQuantity(productId, quantity) {
        if (quantity <= 0) state.cart.delete(productId);
        else state.cart.set(productId, quantity);
        persist();
        render();
    }

    function addToCart(product) {
        const available = localStock(catalog.stock, product.id, state.branch);
        if (available <= 0) {
            alertUser(`"${product.product_name}" đã hết tại ${branchName(state.branch)}.`);
            return;
        }
        tapFeedback();
        setQuantity(product.id, (state.cart.get(product.id) || 0) + 1);
    }

    async function handleScan() {
        state.scanFlash = true;
        render();
        await openScanner({
            onDetected: code => {
                const product = catalog.products.find(item => item.barcode === code);
                if (!product) {
                    alertUser('Mã này chưa có trong kho. Hãy nhập sản phẩm trước.');
                    return;
                }
                addToCart(product);
                state.cartOpen = true;
                render();
            }
        });
        state.scanFlash = false;
        render();
    }

    async function submit() {
        if (state.submitting || state.cart.size === 0) return;
        if (shortageLines().length > 0) {
            alertUser('Còn sản phẩm vượt tồn kho. Hãy giảm số lượng trước khi gửi.');
            return;
        }

        state.submitting = true;
        render();
        try {
            const items = cartLines().map(line => ({
                barcode: line.product.barcode,
                quantity: line.quantity
            }));
            await apiPost('/api/warehouse/export/request', { branch: state.branch, items });
            draft.clear();
            notifySuccess();
            state.submitted = true;
            state.cartOpen = false;
        } catch (error) {
            notifyError();
            alertUser(error.message);
        } finally {
            state.submitting = false;
            render();
        }
    }

    /* ---------- Render ---------- */

    // Khai báo trước render() vì render() gắn thẳng node này vào cây DOM.
    const listContainer = h('div', {
        class: 'app__body',
        style: { paddingTop: '12px', paddingBottom: '96px' }
    });

    function renderProductRow(product) {
        const inCart = state.cart.get(product.id) || 0;
        const available = localStock(catalog.stock, product.id, state.branch);
        const over = inCart > available;

        return h('div', { class: cx('product', inCart > 0 && 'product--in-cart') },
            h('div', { class: 'product__thumb' }, icon('package', { size: 17 })),
            h('div', { class: 'product__main' },
                h('div', { class: 'product__name' }, product.product_name),
                h('div', { class: 'product__meta' },
                    product.barcode ? h('span', { class: 'product__code' }, product.barcode) : null,
                    stockBadge(available)
                )
            ),
            inCart > 0
                ? stepper({
                    value: inCart,
                    over,
                    onChange: quantity => setQuantity(product.id, quantity)
                })
                : h('button', {
                    class: 'product__add',
                    type: 'button',
                    disabled: available <= 0,
                    'aria-label': `Thêm ${product.product_name}`,
                    onClick: () => addToCart(product)
                }, icon('plus', { size: 16 }))
        );
    }

    function renderCartSheet() {
        const lines = cartLines();
        return h('div', { class: 'sheet' },
            h('div', {
                class: 'sheet__mask',
                onClick: () => { state.cartOpen = false; render(); }
            }),
            h('div', { class: 'sheet__panel' },
                h('div', { class: 'sheet__head' },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                        h('button', {
                            class: 'topbar__back', type: 'button', 'aria-label': 'Đóng',
                            onClick: () => { state.cartOpen = false; render(); }
                        }, icon('chevronLeft', { size: 16 })),
                        h('span', { class: 'strong' }, 'Giỏ xuất kho')
                    ),
                    h('span', { class: 'hint' }, `${lines.length} sản phẩm`)
                ),
                h('div', { class: 'sheet__body' },
                    h('div', { class: 'stack-sm' },
                        shortageLines().length > 0
                            ? notice('bad', 'Một số sản phẩm vượt tồn kho, hãy kiểm tra lại trước khi gửi.')
                            : null,
                        lines.length === 0
                            ? emptyState('Giỏ trống, hãy thêm sản phẩm')
                            : lines.map(line => h('div', {
                                class: cx('product', line.over && 'product--in-cart')
                            },
                                h('div', { class: 'product__main' },
                                    h('div', { class: 'product__name' }, line.product.product_name),
                                    h('div', {
                                        class: cx('product__code', line.over && 'text-bad'),
                                        style: { marginTop: '3px', fontFamily: 'inherit', fontSize: '11px' }
                                    }, `Tồn ${branchName(state.branch)}: ${line.available}${line.over ? ' · Vượt tồn kho' : ''}`)
                                ),
                                stepper({
                                    value: line.quantity,
                                    over: line.over,
                                    onChange: quantity => setQuantity(line.product.id, quantity)
                                }),
                                h('button', {
                                    class: 'btn-mini btn-mini--danger',
                                    type: 'button',
                                    'aria-label': 'Bỏ khỏi giỏ',
                                    onClick: () => setQuantity(line.product.id, 0)
                                }, icon('trash', { size: 14 }))
                            ))
                    )
                ),
                h('div', { class: 'sheet__foot' },
                    h('div', { class: 'row-between', style: { marginBottom: '10px' } },
                        h('span', { class: 'hint' }, 'Tổng số lượng'),
                        h('span', { class: 'total__value' }, String(totalQty()))
                    ),
                    primaryButton({
                        label: state.submitting ? 'Đang gửi…' : 'Gửi yêu cầu xuất kho',
                        iconName: state.submitting ? 'loader' : 'send',
                        spinning: state.submitting,
                        disabled: state.submitting || lines.length === 0,
                        onClick: submit
                    })
                )
            )
        );
    }

    function render() {
        // Bước 1: chọn cơ sở
        if (!state.branch) {
            replaceChildren(root,
                topBar({ title: 'Cơ sở', subtitle: 'Xuất lẻ · Bước 1/2', onBack: onExit }),
                h('div', { class: 'app__body' },
                    branchPicker({
                        selected: state.branch,
                        onSelect: code => { state.branch = code; persist(); render(); }
                    })
                )
            );
            return;
        }

        // Kết quả
        if (state.submitted) {
            replaceChildren(root, successScreen({
                title: 'Đã gửi yêu cầu xuất kho',
                message: `Đơn xuất lẻ tại ${branchName(state.branch)} đang chờ người có quyền kho duyệt.`,
                rows: [
                    ['Cơ sở', branchName(state.branch)],
                    ['Số mặt hàng', String(state.cart.size)],
                    ['Tổng số lượng', String(totalQty())]
                ],
                onExit,
                onClose: () => closeApp()
            }));
            return;
        }

        const products = filteredProducts();

        // Nút xóa tìm kiếm được bật/tắt trực tiếp trong onInput: gõ chữ chỉ vẽ lại
        // danh sách, không render lại cả màn hình, nên input không bị mất focus.
        const clearButton = h('button', {
            class: cx('hidden'),
            type: 'button',
            'aria-label': 'Xóa tìm kiếm',
            onClick: () => { state.query = ''; render(); }
        }, icon('x', { size: 15, class: 'text-muted' }));
        if (state.query) clearButton.classList.remove('hidden');

        replaceChildren(root,
            // Thanh tìm kiếm + quét mã
            h('div', { class: 'topbar' },
                h('div', { class: 'topbar__row', style: { marginBottom: '10px' } },
                    h('button', {
                        class: 'topbar__back', type: 'button', 'aria-label': 'Đổi cơ sở',
                        onClick: () => { state.branch = null; render(); }
                    }, icon('chevronLeft', { size: 17 })),
                    h('div', { style: { flex: '1', minWidth: '0' } },
                        h('div', { class: 'topbar__title', style: { textAlign: 'left' } }, 'Xuất kho lẻ'),
                        h('div', {
                            class: 'topbar__sub',
                            style: { textAlign: 'left', display: 'flex', alignItems: 'center', gap: '4px' }
                        }, icon('mapPin', { size: 11, class: 'text-brand' }), branchName(state.branch))
                    )
                ),
                h('div', { class: 'searchbar' },
                    h('div', { class: 'searchbar__box' },
                        icon('search', { size: 16, class: 'text-muted' }),
                        h('input', {
                            class: 'searchbar__input',
                            value: state.query,
                            placeholder: 'Tìm tên hoặc mã sản phẩm…',
                            onInput: event => {
                                state.query = event.target.value;
                                clearButton.classList.toggle('hidden', state.query === '');
                                renderList();
                            }
                        }),
                        clearButton
                    ),
                    h('button', {
                        class: cx('searchbar__scan', state.scanFlash && 'searchbar__scan--flash'),
                        type: 'button', 'aria-label': 'Quét mã vạch',
                        onClick: handleScan
                    }, icon('scan', { size: 19 }))
                )
            ),

            // Danh sách sản phẩm
            listContainer,

            // Giỏ nổi
            state.cart.size > 0 && !state.cartOpen
                ? h('button', {
                    class: 'cartbar', type: 'button',
                    onClick: () => { state.cartOpen = true; render(); }
                },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
                        h('div', { style: { position: 'relative', display: 'flex' } },
                            icon('cart', { size: 18 }),
                            h('span', { class: 'cartbar__count' }, String(state.cart.size))
                        ),
                        h('span', { style: { fontSize: '13px', fontWeight: '600' } },
                            `Xem giỏ · ${totalQty()} sản phẩm`)
                    ),
                    h('span', {
                        style: { fontSize: '13px', fontWeight: '800', color: 'var(--brand)' }
                    }, 'Gửi đơn →')
                )
                : null,

            state.cartOpen ? renderCartSheet() : null
        );

        renderList(products);
    }

    function renderList(products = filteredProducts()) {
        replaceChildren(listContainer,
            shortageLines().length > 0
                ? h('div', { style: { marginBottom: '12px' } },
                    notice('bad', `${shortageLines().length} sản phẩm trong giỏ vượt tồn kho hiện có.`))
                : null,
            h('div', { class: 'section-label' },
                `${products.length} sản phẩm${state.query ? ` khớp "${state.query}"` : ''}`),
            products.length === 0
                ? emptyState('Không tìm thấy sản phẩm phù hợp')
                : h('div', { class: 'stack-sm' }, products.map(renderProductRow))
        );
    }

    render();
    return root;
}

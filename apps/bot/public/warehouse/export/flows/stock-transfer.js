/**
 * Luồng "Chuyển kho": chuyển hàng THẬT từ cơ sở này sang cơ sở kia, không gắn
 * khách hàng hay dịch vụ. Khác "Xuất lẻ" ở chỗ hàng không rời khỏi tồn kho hệ
 * thống — chỉ chuyển từ cơ sở nguồn sang cơ sở đích và có ngay ở đó.
 *
 * Cơ sở đích luôn là cơ sở còn lại — hệ thống chỉ có hai cơ sở (US/UK) nên
 * không cần màn hình chọn riêng, tránh người dùng chọn nhầm giống cơ sở nguồn.
 *
 * Gửi tới POST /api/warehouse/stock-transfers, xử lý trừ/cộng tồn NGAY (1 bước,
 * không chờ xác nhận nhận hàng) — vì telegram_groups không gắn cứng vào một cơ
 * sở nên không có cách nào giới hạn ai được "xác nhận đã nhận" ở đầu kia.
 */

import { h, replaceChildren, cx } from '../../../shared-ui/core/dom.js';
import { icon } from '../../../shared-ui/ui/icons.js';
import {
    topBar, primaryButton, notice, branchPicker,
    stepper, stockBadge, successScreen, emptyState
} from '../ui/components.js';
import { newIdempotencyKey } from '../../../shared-ui/core/api.js';
import { createDraftStore } from '../../../shared-ui/core/draft.js';
import { branchName, otherBranch, localStock, submitStockTransfer } from '../data/warehouse-repo.js';
import { alertUser, notifySuccess, notifyError, closeApp, tapFeedback } from '../../../shared-ui/core/telegram.js';
import { openScanner } from '../../../shared-ui/ui/scanner.js';

export function createStockTransferFlow({ catalog, onExit }) {
    const draft = createDraftStore('stock-transfer');
    const root = h('div', { style: { display: 'contents' } });

    const state = {
        fromBranch: null,
        query: '',
        cart: new Map(), // productId -> quantity
        cartOpen: false,
        submitting: false,
        submitted: false,
        scanFlash: false
    };

    const saved = draft.load();
    if (saved?.fromBranch) {
        state.fromBranch = saved.fromBranch;
        for (const [productId, quantity] of saved.cart || []) {
            if (catalog.products.some(product => product.id === productId)) {
                state.cart.set(productId, Number(quantity) || 0);
            }
        }
    }

    const persist = () => draft.save({ fromBranch: state.fromBranch, cart: [...state.cart.entries()] });
    const toBranch = () => otherBranch(state.fromBranch);

    /* ---------- Dữ liệu dẫn xuất ---------- */

    const cartLines = () => [...state.cart.entries()]
        .map(([productId, quantity]) => {
            const product = catalog.products.find(item => item.id === productId);
            if (!product) return null;
            const available = localStock(catalog.stock, productId, state.fromBranch);
            return { product, quantity, available, over: quantity > available };
        })
        .filter(Boolean);

    const totalQty = () => Number(cartLines().reduce((sum, line) => sum + line.quantity, 0).toFixed(1));
    const shortageLines = () => cartLines().filter(line => line.over);
    const allowsDecimal = product => product.quantity_mode === 'DECIMAL';

    const filteredProducts = () => {
        const keyword = state.query.trim().toLowerCase();
        if (!keyword) return catalog.products;
        return catalog.products.filter(product =>
            product.product_name.toLowerCase().includes(keyword) ||
            product.barcode.toLowerCase().includes(keyword)
        );
    };

    /* ---------- Thao tác ---------- */

    function setQuantity(productId, quantity, { render: shouldRender = true } = {}) {
        const product = catalog.products.find(item => item.id === productId);
        const normalized = Number(Number(quantity).toFixed(1));
        if (!product || !Number.isFinite(normalized)) return;
        if (!allowsDecimal(product) && !Number.isInteger(normalized)) {
            alertUser(`"${product.product_name}" chỉ cho phép chuyển số nguyên.`);
            return;
        }
        if (normalized <= 0) state.cart.delete(productId);
        else state.cart.set(productId, normalized);
        persist();
        if (shouldRender) render();
    }

    function addToCart(product) {
        const available = localStock(catalog.stock, product.id, state.fromBranch);
        if (available <= 0) {
            alertUser(`"${product.product_name}" đã hết tại ${branchName(state.fromBranch)}.`);
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
            alertUser('Còn sản phẩm vượt tồn kho tại cơ sở nguồn. Hãy giảm số lượng trước khi gửi.');
            return;
        }

        state.submitting = true;
        render();
        try {
            const items = cartLines().map(line => ({
                product_id: line.product.id,
                quantity: line.quantity
            }));
            await submitStockTransfer({
                fromBranch: state.fromBranch,
                toBranch: toBranch(),
                items,
                idempotencyKey: newIdempotencyKey()
            });
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
        const available = localStock(catalog.stock, product.id, state.fromBranch);
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
                    min: allowsDecimal(product) ? 0.1 : 0,
                    step: allowsDecimal(product) ? 0.1 : 1,
                    allowDecimal: allowsDecimal(product),
                    over,
                    onChange: (quantity, options) => setQuantity(product.id, quantity, options)
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
                        h('span', { class: 'strong' }, 'Phiếu chuyển kho')
                    ),
                    h('span', { class: 'hint' }, `${lines.length} sản phẩm`)
                ),
                h('div', { class: 'sheet__body' },
                    h('div', { class: 'stack-sm' },
                        shortageLines().length > 0
                            ? notice('bad', 'Một số sản phẩm vượt tồn kho tại cơ sở nguồn, hãy kiểm tra lại trước khi gửi.')
                            : null,
                        lines.length === 0
                            ? emptyState('Chưa chọn sản phẩm nào để chuyển')
                            : lines.map(line => h('div', {
                                class: cx('product', line.over && 'product--in-cart')
                            },
                                h('div', { class: 'product__main' },
                                    h('div', { class: 'product__name' }, line.product.product_name),
                                    h('div', {
                                        class: cx('product__code', line.over && 'text-bad'),
                                        style: { marginTop: '3px', fontFamily: 'inherit', fontSize: '11px' }
                                    }, `Tồn ${branchName(state.fromBranch)}: ${line.available}${line.over ? ' · Vượt tồn kho' : ''}`)
                                ),
                                stepper({
                                    value: line.quantity,
                                    min: allowsDecimal(line.product) ? 0.1 : 0,
                                    step: allowsDecimal(line.product) ? 0.1 : 1,
                                    allowDecimal: allowsDecimal(line.product),
                                    over: line.over,
                                    onChange: (quantity, options) => setQuantity(line.product.id, quantity, options)
                                }),
                                h('button', {
                                    class: 'btn-mini btn-mini--danger',
                                    type: 'button',
                                    'aria-label': 'Bỏ khỏi phiếu',
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
                        label: state.submitting ? 'Đang gửi…' : 'Gửi phiếu chuyển kho',
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
        // Bước 1: chọn cơ sở nguồn
        if (!state.fromBranch) {
            replaceChildren(root,
                topBar({ title: 'Cơ sở nguồn', subtitle: 'Chuyển kho · Bước 1/2', onBack: onExit }),
                h('div', { class: 'app__body' },
                    branchPicker({
                        selected: state.fromBranch,
                        onSelect: code => { state.fromBranch = code; persist(); render(); }
                    })
                )
            );
            return;
        }

        // Kết quả
        if (state.submitted) {
            replaceChildren(root, successScreen({
                title: 'Đã chuyển kho thành công',
                message: `Hàng đã chuyển từ ${branchName(state.fromBranch)} sang ${branchName(toBranch())}.`,
                rows: [
                    ['Từ', branchName(state.fromBranch)],
                    ['Đến', branchName(toBranch())],
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
                        onClick: () => { state.fromBranch = null; render(); }
                    }, icon('chevronLeft', { size: 17 })),
                    h('div', { style: { flex: '1', minWidth: '0' } },
                        h('div', { class: 'topbar__title', style: { textAlign: 'left' } }, 'Chuyển kho'),
                        h('div', {
                            class: 'topbar__sub',
                            style: { textAlign: 'left', display: 'flex', alignItems: 'center', gap: '4px' }
                        }, icon('mapPin', { size: 11, class: 'text-brand' }),
                            `${branchName(state.fromBranch)} → ${branchName(toBranch())}`)
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

            // Phiếu nổi
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
                            `Xem phiếu · ${totalQty()} sản phẩm`)
                    ),
                    h('span', {
                        style: { fontSize: '13px', fontWeight: '800', color: 'var(--brand)' }
                    }, 'Gửi phiếu →')
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
                    notice('bad', `${shortageLines().length} sản phẩm trong phiếu vượt tồn kho hiện có.`))
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

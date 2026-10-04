/**
 * Sheet nhập tay: tìm sản phẩm có sẵn hoặc tạo sản phẩm mới.
 *
 * Gợi ý lấy từ danh mục THẬT (`/api/warehouse/products`), không có danh sách mẫu.
 *
 * Ba điểm bắt buộc giữ đúng, đều xuất phát từ sự cố thật đã làm mất tên sản phẩm:
 *  1. Chọn sản phẩm có sẵn -> KHÓA cả mã lẫn tên, không cho sửa.
 *  2. Sản phẩm mới -> mã do máy chủ đề xuất (`/api/warehouse/next-barcode`) nhưng
 *     VẪN cho nhân sự sửa thành mã mong muốn.
 *  3. Dù chọn mã nào, lúc bấm Thêm vẫn kiểm tra mã có đang thuộc sản phẩm khác —
 *     và máy chủ còn kiểm tra lại lần nữa ở tầng database.
 *
 * Sheet KHÔNG tự đóng sau khi thêm: nhân sự thường nhập nhiều mặt hàng một lượt.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { icon } from '../../../shared-ui/ui/icons.js';
import { suggestBarcode } from '../data/import-repo.js';
import {
    checkBarcodeOwnership, parseQuantity, normalizeProductName, normalizeBarcode
} from '../domain/import-draft.js';
import { field, quantityInput, button, notice } from '../ui/components.js';

const MAX_SUGGESTIONS = 5;

/**
 * @param {object} params
 * @param {Array<{barcode:string, name:string}>} params.products danh mục thật
 * @param {Map<string,string>} params.barcodeOwners
 * @param {() => Array} params.getItems các dòng đang có trong phiếu (đọc lúc cần)
 * @param {(item:object) => void} params.onAdd
 * @param {() => void} params.onClose
 */
export function createManualAddSheet({ products, barcodeOwners, getItems, onAdd, onClose }) {
    const state = {
        query: '',
        picked: null,     // {barcode, name} khi chọn sản phẩm có sẵn
        quantity: '',
        customCode: '',
        codeError: '',
        justAdded: null
    };

    // Tách slot: ô tìm kiếm và ô số lượng KHÔNG được vẽ lại khi đang gõ, nếu không
    // con trỏ nhập trên điện thoại bị nhảy về đầu.
    const bodySlot = h('div', { class: 'sheet__body' });
    const feedbackSlot = h('div');
    const suggestionSlot = h('div');
    const detailSlot = h('div');
    const footSlot = h('div', { class: 'sheet__foot' });

    /* ---------- Dữ liệu dẫn xuất ---------- */

    function matchingProducts() {
        const keyword = state.query.trim().toLowerCase();
        if (!keyword || state.picked) return [];
        return products
            .filter(product =>
                product.name.toLowerCase().includes(keyword)
                || product.barcode.toLowerCase().includes(keyword))
            .slice(0, MAX_SUGGESTIONS);
    }

    /** Tên đang gõ trùng khít một sản phẩm có sẵn -> không phải sản phẩm mới. */
    function exactMatch() {
        const typed = normalizeProductName(state.query);
        if (!typed) return null;
        return products.find(product => normalizeProductName(product.name) === typed) || null;
    }

    function isCreatingNew() {
        return Boolean(state.query.trim()) && !state.picked && !exactMatch();
    }

    function finalCode() {
        if (state.picked) return state.picked.barcode;
        return normalizeBarcode(state.customCode);
    }

    function canSubmit() {
        if (!parseQuantity(state.quantity)) return false;
        if (state.picked) return true;
        const match = exactMatch();
        if (match) return true;
        return Boolean(state.query.trim()) && Boolean(finalCode()) && !state.codeError;
    }

    /* ---------- Hành vi ---------- */

    function pick(product) {
        state.picked = { barcode: product.barcode, name: product.name };
        state.query = product.name;
        state.customCode = '';
        state.codeError = '';
        render();
    }

    function clearPick() {
        state.picked = null;
        state.customCode = '';
        state.codeError = '';
        render();
    }

    function onQueryInput(value) {
        state.query = value;
        if (state.picked) state.picked = null;
        renderSuggestions();
        renderDetail();
        renderFoot();
    }

    function validateCode(code) {
        const trimmed = normalizeBarcode(code);
        if (!trimmed) {
            state.codeError = 'Mã vạch không được để trống.';
            return;
        }
        const verdict = checkBarcodeOwnership({
            barcode: trimmed,
            productName: state.query,
            barcodeOwners,
            items: getItems()
        });
        state.codeError = verdict.ok ? '' : verdict.message;
    }

    function onCodeInput(value) {
        state.customCode = value;
        validateCode(value);
        renderDetail();
        renderFoot();
    }

    /** Xin mã đề xuất từ máy chủ; không ghi đè nếu nhân sự đã kịp tự gõ. */
    async function fillSuggestedCode({ force = false } = {}) {
        if (!force && state.customCode) return;
        try {
            const suggested = await suggestBarcode();
            if (!force && state.customCode) return;
            state.customCode = suggested;
            validateCode(suggested);
        } catch (_) {
            state.codeError = 'Không lấy được mã đề xuất. Hãy tự nhập mã vạch.';
        }
        renderDetail();
        renderFoot();
    }

    function submit() {
        if (!canSubmit()) return;

        const match = exactMatch();
        const source = state.picked || (match ? { barcode: match.barcode, name: match.name } : null);
        const barcode = source ? source.barcode : finalCode();
        const productName = source ? source.name : state.query.trim();

        // Chốt chặn cuối ở phía máy: kể cả khi nhân sự sửa mã rồi bấm ngay.
        const verdict = checkBarcodeOwnership({
            barcode, productName, barcodeOwners, items: getItems()
        });
        if (!verdict.ok) {
            state.codeError = verdict.message;
            renderDetail();
            renderFoot();
            return;
        }

        const quantity = parseQuantity(state.quantity);
        onAdd({ barcode, productName, quantity, isNew: !source });

        state.justAdded = { barcode, productName, quantity, isNew: !source };
        state.query = '';
        state.picked = null;
        state.quantity = '';
        state.customCode = '';
        state.codeError = '';
        render();
    }

    /* ---------- Render từng vùng ---------- */

    function renderFeedback() {
        const items = getItems();
        replaceChildren(feedbackSlot,
            state.justAdded
                ? notice('ok',
                    'Đã thêm ',
                    h('span', { class: 'strong' }, state.justAdded.productName),
                    ` +${state.justAdded.quantity} vào phiếu.`)
                : null,
            items.length
                ? h('div', {
                    style: {
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: 'var(--surface)', borderRadius: 'var(--r-lg)',
                        padding: '10px 13px', marginBottom: '14px'
                    }
                },
                    h('span', { style: { fontSize: '12px', color: 'var(--muted)' } }, 'Đã thêm trong phiếu này'),
                    h('span', { style: { fontSize: '12px', fontWeight: '800', color: 'var(--brand)' } },
                        `${items.length} sản phẩm`)
                )
                : null
        );
    }

    function renderSuggestions() {
        const matches = matchingProducts();
        replaceChildren(suggestionSlot,
            matches.length
                ? h('div', { class: 'suggestions' },
                    h('div', { class: 'suggestions__head' }, 'Gợi ý từ danh mục hiện có'),
                    matches.map(product => h('button', {
                        class: 'suggestion', type: 'button', onClick: () => pick(product)
                    },
                        icon('package', { size: 15, class: 'text-muted' }),
                        h('div', { style: { flex: '1', minWidth: '0' } },
                            h('div', { class: 'suggestion__name' }, product.name),
                            h('div', { class: 'suggestion__code' }, product.barcode)
                        )
                    ))
                )
                : null
        );
    }

    function renderDetail() {
        const match = exactMatch();
        const shown = state.picked || (match ? { barcode: match.barcode, name: match.name } : null);

        replaceChildren(detailSlot,
            shown
                ? h('div', { class: 'picked', style: { marginTop: '14px' } },
                    h('div', { class: 'picked__head' },
                        h('div', { class: 'picked__badge' }, icon('check', { size: 12 }), 'Sản phẩm có sẵn — đã khóa thông tin'),
                        h('button', { class: 'picked__change', type: 'button', onClick: clearPick }, 'Đổi')
                    ),
                    h('div', { class: 'picked__name' }, shown.name),
                    h('div', { class: 'picked__code' }, icon('barcode', { size: 11 }), shown.barcode)
                )
                : null,

            isCreatingNew()
                ? h('div', { class: 'new-box', style: { marginTop: '14px' } },
                    h('div', { class: 'new-box__head' },
                        icon('packagePlus', { size: 13 }), 'Chưa có trong hệ thống — sẽ tạo sản phẩm mới'),
                    field({
                        label: 'Mã vạch cho sản phẩm mới',
                        input: h('div', { class: 'code-row' },
                            h('input', {
                                class: `field__input field__input--mono${state.codeError ? ' field__input--bad' : ''}`,
                                placeholder: 'Bấm để nhận mã đề xuất…',
                                value: state.customCode,
                                onFocus: () => fillSuggestedCode(),
                                onInput: event => onCodeInput(event.target.value)
                            }),
                            h('button', {
                                class: 'code-row__btn',
                                type: 'button',
                                'aria-label': 'Lấy mã đề xuất khác',
                                onClick: () => fillSuggestedCode({ force: true })
                            }, icon('refresh', { size: 16 }))
                        ),
                        note: 'Mã do máy chủ đề xuất, bạn sửa được nhưng phải là mã chưa tồn tại.',
                        error: state.codeError || null
                    })
                )
                : null
        );
    }

    function renderFoot() {
        const items = getItems();
        replaceChildren(footSlot,
            button({
                label: 'Thêm vào phiếu',
                iconName: 'plus',
                variant: 'dark',
                disabled: !canSubmit(),
                onClick: submit
            }),
            items.length
                ? button({
                    label: `Xong, quay lại phiếu (${items.length} sản phẩm)`,
                    variant: 'ghost',
                    onClick: onClose
                })
                : null
        );
    }

    /** Dựng lại toàn bộ thân sheet — chỉ gọi khi form được reset, không gọi khi đang gõ. */
    function render() {
        replaceChildren(bodySlot,
            feedbackSlot,
            field({
                label: 'Tên sản phẩm',
                input: h('div', { class: 'search-wrap' },
                    h('div', { class: 'search-wrap__icon' }, icon('search', { size: 15 })),
                    h('input', {
                        class: 'field__input',
                        placeholder: 'Gõ tên để tìm hoặc tạo mới…',
                        value: state.query,
                        onInput: event => onQueryInput(event.target.value)
                    }),
                    state.query
                        ? h('button', {
                            class: 'search-wrap__clear', type: 'button', 'aria-label': 'Xóa',
                            onClick: () => { state.query = ''; clearPick(); }
                        }, icon('x', { size: 15 }))
                        : null
                )
            }),
            suggestionSlot,
            detailSlot,
            field({
                label: 'Số lượng nhập',
                input: quantityInput({
                    value: state.quantity,
                    onInput: value => { state.quantity = value; renderFoot(); }
                })
            })
        );

        renderFeedback();
        renderSuggestions();
        renderDetail();
        renderFoot();
    }

    render();

    return h('div', { class: 'sheet' },
        h('div', { class: 'sheet__mask', onClick: onClose }),
        h('div', { class: 'sheet__panel' },
            h('div', { class: 'sheet__head' },
                h('div', { class: 'sheet__title' }, icon('edit', { size: 16 }), 'Nhập thủ công'),
                h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đóng', onClick: onClose },
                    icon('x', { size: 16 }))
            ),
            bodySlot,
            footSlot
        )
    );
}

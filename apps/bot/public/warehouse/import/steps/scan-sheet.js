/**
 * Sheet hiện sau khi quét được một mã vạch.
 *
 * Hai nhánh:
 *   - Mã đã có trong hệ thống  -> hiện tên cũ, KHÓA tên, chỉ hỏi số lượng.
 *   - Mã chưa có               -> hỏi tên sản phẩm mới + số lượng.
 *
 * Nhánh nào là do MÁY CHỦ trả lời (`/api/products/by-barcode`), không phải do máy
 * tự đoán. Tra cứu thất bại thì KHÔNG mở nhánh "sản phẩm mới": nếu mã đó thật ra
 * đã tồn tại, đặt tên mới sẽ ghi đè tên sản phẩm cũ — đã xảy ra một lần và làm
 * mất tên "Cannula 23g". Lúc đó chỉ báo lỗi và cho quét lại.
 *
 * Số lần quét trùng để xác nhận do BarcodeScanner tự lo (đọc trùng mã trong
 * 1200ms + kiểm tra checksum), nên ở đây không đếm lại.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { icon } from '../../../shared-ui/ui/icons.js';
import { lookupBarcode } from '../data/import-repo.js';
import { parseQuantity } from '../domain/import-draft.js';
import { field, quantityInput, button, notice, loadingScreen } from '../ui/components.js';

/**
 * @param {object} params
 * @param {string} params.barcode mã vừa quét
 * @param {(item:{barcode:string, productName:string, quantity:number, isNew:boolean}) => void} params.onConfirm
 * @param {() => void} params.onClose
 * @param {() => void} params.onScanAgain
 */
export function createScanSheet({ barcode, onConfirm, onClose, onScanAgain }) {
    const bodySlot = h('div', { class: 'sheet__body' }, loadingScreen('Đang tra mã vạch…'));
    const footSlot = h('div', { class: 'sheet__foot' });

    const state = { quantity: '', productName: '', existing: null, donVi: null };

    /**
     * Nhãn ô số lượng và dòng nhắc quy đổi.
     *
     * Admin cấu hình "1 Lọ = 2.5 ml" thì nhân viên CHỈ gõ số lọ; máy chủ tự nhân
     * hệ số khi lưu. Phải nói rõ đang gõ đơn vị nào, nếu không người ta gõ số ml
     * và kho lệch đúng bằng hệ số.
     */
    function nhanSoLuong() {
        const dv = state.donVi;
        return dv ? `Số lượng nhập (${dv.importUnit})` : 'Số lượng nhập';
    }

    // Giữ một tham chiếu tới dòng nhắc để cập nhật CHỮ khi gõ, thay vì vẽ lại cả
    // ô nhập — vẽ lại sẽ làm mất con trỏ và bàn phím điện thoại tự đóng.
    let hintNode = null;

    function chuQuyDoi() {
        const dv = state.donVi;
        if (!dv) return '';
        const so = parseQuantity(state.quantity);
        if (so > 0) {
            const thanh = Math.round(so * dv.rate * 10) / 10;
            return `${so} ${dv.importUnit} = ${thanh} ${dv.baseUnit} sẽ được cộng vào kho`;
        }
        return `1 ${dv.importUnit} = ${dv.rate} ${dv.baseUnit}`;
    }

    function dongQuyDoi() {
        if (!state.donVi) return null;
        hintNode = h('div', { class: 'field__hint' }, chuQuyDoi());
        return hintNode;
    }

    function renderFound(productName) {
        replaceChildren(bodySlot,
            notice('ok', 'Đã nhận diện sản phẩm có sẵn trong hệ thống.'),
            h('div', { class: 'picked' },
                h('div', { class: 'picked__head' },
                    h('div', { class: 'picked__badge' }, icon('check', { size: 12 }), 'Sản phẩm có sẵn — tên đã khóa')
                ),
                h('div', { class: 'picked__name' }, productName),
                h('div', { class: 'picked__code' }, icon('barcode', { size: 11 }), barcode)
            ),
            field({
                label: nhanSoLuong(),
                input: quantityInput({ value: state.quantity, onInput: onQuantity })
            }),
            dongQuyDoi()
        );
        renderFoot();
    }

    function renderNew() {
        replaceChildren(bodySlot,
            notice('warn', 'Mã vạch mới, chưa có trong hệ thống. Nhập tên sản phẩm để tạo mới.'),
            h('div', { class: 'picked', style: { background: 'var(--surface)', borderColor: 'var(--line-soft)' } },
                h('div', { class: 'field__label', style: { marginBottom: '2px' } }, 'Mã vạch quét được'),
                h('div', { class: 'picked__code' }, icon('barcode', { size: 11 }), barcode)
            ),
            field({
                label: 'Tên sản phẩm mới',
                input: h('input', {
                    class: 'field__input',
                    placeholder: 'VD: Kem massage đá lạnh',
                    value: state.productName,
                    onInput: event => {
                        state.productName = event.target.value;
                        renderFoot();
                    }
                })
            }),
            field({
                label: 'Số lượng nhập',
                input: quantityInput({ value: state.quantity, onInput: onQuantity })
            })
        );
        renderFoot();
    }

    function renderLookupFailed(message) {
        replaceChildren(bodySlot,
            notice('bad',
                h('div', { class: 'strong', style: { marginBottom: '4px' } },
                    `Không kiểm tra được mã vạch "${barcode}".`),
                message,
                h('div', { style: { marginTop: '6px' } },
                    'Hãy thử lại để tránh đặt nhầm tên cho sản phẩm đã có trong hệ thống.')
            )
        );
        replaceChildren(footSlot,
            button({ label: 'Quét lại', iconName: 'scan', variant: 'alt', onClick: () => { onClose(); onScanAgain(); } }),
            button({ label: 'Đóng', variant: 'ghost', onClick: onClose })
        );
    }

    function onQuantity(value) {
        state.quantity = value;
        if (hintNode) hintNode.textContent = chuQuyDoi();
        renderFoot();
    }

    function renderFoot() {
        const quantity = parseQuantity(state.quantity);
        const name = state.existing || state.productName.trim();
        const ready = Boolean(quantity && name);

        replaceChildren(footSlot,
            button({
                label: state.existing ? 'Thêm vào phiếu' : 'Tạo sản phẩm & thêm vào phiếu',
                iconName: 'plus',
                disabled: !ready,
                onClick: () => {
                    if (!ready) return;
                    onConfirm({ barcode, productName: name, quantity, isNew: !state.existing });
                }
            })
        );
    }

    lookupBarcode(barcode)
        .then(({ exists, product }) => {
            if (exists && product?.product_name) {
                state.existing = product.product_name;
                // Chỉ coi là có quy đổi khi Admin đã đặt đơn vị đóng gói VÀ hệ số > 1.
                const rate = Number(product.conversion_rate) || 1;
                state.donVi = product.import_unit && rate > 1
                    ? { importUnit: product.import_unit, baseUnit: product.base_unit || 'chiếc', rate }
                    : null;
                renderFound(product.product_name);
            } else {
                renderNew();
            }
        })
        .catch(error => renderLookupFailed(error.message || 'Máy chủ từ chối yêu cầu.'));

    return h('div', { class: 'sheet' },
        h('div', { class: 'sheet__mask', onClick: onClose }),
        h('div', { class: 'sheet__panel' },
            h('div', { class: 'sheet__head' },
                h('div', { class: 'sheet__title' }, icon('scan', { size: 17 }), 'Mã vừa quét'),
                h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đóng', onClick: onClose },
                    icon('x', { size: 16 }))
            ),
            bodySlot,
            footSlot
        )
    );
}

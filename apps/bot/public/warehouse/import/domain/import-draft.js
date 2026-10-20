/**
 * Quy tắc của phiếu nhập kho — hàm thuần, không DOM, không network.
 *
 * Tách riêng vì đây là chỗ dễ sai nhất và đã từng gây mất dữ liệu thật: nhân sự
 * gõ một mã vạch đang thuộc sản phẩm khác thì tên sản phẩm cũ bị ghi đè và tồn
 * kho hai mặt hàng bị gộp làm một (UK nhập "Cannula 23g" mã 002, sau đó US nhập
 * "Kim canula27g" cũng mã 002 -> tên cũ biến mất).
 *
 * Ba lớp chặn trùng mã, lớp này là lớp đầu:
 *   1. Ở đây (client): báo ngay lúc nhân sự bấm Thêm, không để họ điền xong cả phiếu.
 *   2. import-routes.js đọc tk_products trước khi ghi.
 *   3. Mệnh đề WHERE của ON CONFLICT ở database — chặn cả khi hai cơ sở lưu cùng lúc.
 * Lớp 1 chỉ để báo sớm cho dễ chịu; KHÔNG được coi nó là chốt an toàn.
 */

export const MAX_PROOF_IMAGES = 6;

/** So tên bỏ qua hoa/thường và khoảng trắng thừa — khớp cách server so sánh. */
export function normalizeProductName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeBarcode(value) {
    return String(value || '').trim();
}

/**
 * Kiểm tra mã vạch có đang thuộc về sản phẩm khác không.
 *
 * @param {object} params
 * @param {string} params.barcode
 * @param {string} params.productName tên mà nhân sự đang định dùng
 * @param {Map<string,string>} params.barcodeOwners mã vạch -> tên sản phẩm trong danh mục
 * @param {Array<{barcode:string, productName:string}>} params.items các dòng đã có trong phiếu
 * @returns {{ok:true} | {ok:false, owner:string, scope:'catalog'|'draft', message:string}}
 */
export function checkBarcodeOwnership({ barcode, productName, barcodeOwners, items }) {
    const code = normalizeBarcode(barcode);
    const typed = normalizeProductName(productName);

    const catalogOwner = barcodeOwners.get(code);
    if (catalogOwner && normalizeProductName(catalogOwner) !== typed) {
        return {
            ok: false,
            scope: 'catalog',
            owner: catalogOwner,
            message: `Mã "${code}" đang là sản phẩm "${catalogOwner}" trong hệ thống.\n\n`
                + `Nếu đúng là sản phẩm đó, hãy chọn "${catalogOwner}" trong danh sách gợi ý.\n`
                + 'Nếu là sản phẩm mới, hãy dùng mã vạch khác.'
        };
    }

    const draftOwner = items.find(item => normalizeBarcode(item.barcode) === code);
    if (draftOwner && normalizeProductName(draftOwner.productName) !== typed) {
        return {
            ok: false,
            scope: 'draft',
            owner: draftOwner.productName,
            message: `Mã "${code}" đã được dùng cho "${draftOwner.productName}" trong phiếu này.`
        };
    }

    return { ok: true };
}

/**
 * Cộng dồn một dòng vào phiếu.
 * Cùng mã vạch thì cộng số lượng thay vì tạo dòng thứ hai — server cũng gộp theo
 * mã nên tách dòng chỉ làm nhân sự khó đối chiếu.
 *
 * @returns {Array} danh sách mới (không sửa mảng cũ)
 */
export function addItem(items, { barcode, productName, quantity, isNew }) {
    const code = normalizeBarcode(barcode);
    const index = items.findIndex(item => normalizeBarcode(item.barcode) === code);

    if (index >= 0) {
        const merged = [...items];
        merged[index] = { ...merged[index], quantity: merged[index].quantity + quantity };
        return merged;
    }

    return [...items, {
        barcode: code,
        productName: String(productName || '').trim(),
        quantity,
        isNew: Boolean(isNew)
    }];
}

export function removeItem(items, index) {
    return items.filter((_, current) => current !== index);
}

export function totalQuantity(items) {
    return items.reduce((sum, item) => sum + item.quantity, 0);
}

/** Số lượng nhập phải là số nguyên dương — server từ chối mọi giá trị khác. */
export function parseQuantity(value) {
    const quantity = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}

/**
 * Điều kiện để đi tiếp từng bước. Trả về lý do bằng tiếng Việt để UI nói rõ vì
 * sao nút đang khóa, thay vì chỉ làm nút xám.
 *
 * @returns {{ok:boolean, reason?:string}}
 */
export function checkStep(stepKey, { branch, items, photos }) {
    if (stepKey === 'branch' && !branch) {
        return { ok: false, reason: 'Hãy chọn cơ sở nhận hàng.' };
    }
    if (stepKey === 'products' && items.length === 0) {
        return { ok: false, reason: 'Cần thêm ít nhất 1 sản phẩm để tiếp tục.' };
    }
    if (stepKey === 'photos' && photos.length === 0) {
        return { ok: false, reason: 'Cần ít nhất 1 ảnh minh chứng để xác nhận nhập kho.' };
    }
    return { ok: true };
}

/** Payload gửi lên /api/warehouse/import — giữ đúng tên field mà server đọc. */
export function toApiItems(items) {
    return items.map(item => ({
        barcode: item.barcode,
        product_name: item.productName,
        quantity: item.quantity
    }));
}

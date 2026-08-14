/**
 * Nguồn dữ liệu của Mini App nhập kho.
 *
 * KHÔNG có danh mục mẫu hardcode: sản phẩm, mã vạch và mã đề xuất đều lấy từ API
 * thật. Danh mục rỗng thì UI hiển thị trạng thái rỗng chứ không bịa ra sản phẩm.
 */

import { apiGet, warehouseAuthQuery, launchParams } from '../../../shared-ui/core/api.js';
import { getInitData } from '../../../shared-ui/core/telegram.js';

export { BRANCHES, branchName } from '../../../shared-ui/core/branches.js';

/** Trùng với xhr.timeout cũ. Quá mốc này thì báo rõ để nhân sự KHÔNG bấm gửi lại. */
export const SUBMIT_TIMEOUT_MS = 60000;

/**
 * Toàn bộ danh mục sản phẩm đang hoạt động.
 * @returns {Promise<Array<{id:string, barcode:string, name:string}>>}
 */
export async function loadProducts() {
    const data = await apiGet('/api/warehouse/products');
    return (data.products || []).map(row => ({
        id: row.id,
        barcode: String(row.barcode || '').trim(),
        name: String(row.product_name || '').trim()
    }));
}

/** Map mã vạch -> tên sản phẩm đang sở hữu mã đó, để chặn ghi đè mã. */
export function toBarcodeOwners(products) {
    return new Map(products.filter(product => product.barcode).map(product => [product.barcode, product.name]));
}

/**
 * Tra một mã vạch vừa quét.
 *
 * QUAN TRỌNG: tra cứu thất bại KHÔNG được coi là "sản phẩm mới". Trước đây lỗi
 * mạng cũng mở ô nhập tên, nên nhân sự đặt tên mới cho một mã đã tồn tại và ghi
 * đè tên sản phẩm cũ. Hàm này ném lỗi để tầng UI bắt buộc phải báo và cho thử lại.
 *
 * @returns {Promise<{exists:boolean, product:?{product_name:string}}>}
 */
export async function lookupBarcode(barcode) {
    const data = await apiGet(`/api/products/by-barcode/${encodeURIComponent(barcode)}`);
    return { exists: Boolean(data.exists), product: data.product || null };
}

/**
 * Mã vạch chưa ai dùng, do máy chủ đề xuất.
 *
 * Chỉ là GỢI Ý cho đỡ phải tự nghĩ mã — nhân sự vẫn sửa được, và lúc lưu máy chủ
 * còn kiểm tra lại lần nữa ở tầng database để chặn trường hợp hai cơ sở cùng lúc
 * nhận cùng một mã đề xuất rồi cùng bấm lưu.
 */
export async function suggestBarcode() {
    const data = await apiGet('/api/warehouse/next-barcode');
    return String(data.barcode || '');
}

/**
 * Gửi phiếu nhập kho kèm ảnh minh chứng.
 *
 * Dùng XMLHttpRequest chứ không dùng fetch vì cần tiến độ tải lên: ảnh minh chứng
 * qua 3G có thể mất vài chục giây, không có thanh tiến độ thì nhân sự tưởng treo
 * và bấm gửi nhiều lần -> nhập kho trùng.
 *
 * @param {object} params
 * @param {string} params.branch 'US' | 'UK'
 * @param {Array} params.items đã qua toApiItems()
 * @param {File[]} params.files ảnh đã nén
 * @param {(percent:number) => void} [params.onProgress] 0..99 khi đang tải, 100 khi xong
 * @returns {Promise<object>} body JSON của server khi thành công
 */
export function submitImport({ branch, items, files, onProgress }) {
    const { chatId, ts, sig, action } = launchParams();
    const initData = getInitData();

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('items', JSON.stringify(items));
    formData.append('ts', ts);
    formData.append('sig', sig);
    formData.append('action', action);
    formData.append('branch', branch);
    for (const file of files) formData.append('media_files', file);

    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('POST', `/api/warehouse/import?${warehouseAuthQuery()}`, true);
        request.timeout = SUBMIT_TIMEOUT_MS;
        if (initData) request.setRequestHeader('x-telegram-init-data', initData);

        request.upload.onprogress = event => {
            if (!event.lengthComputable) return;
            const raw = Math.round((event.loaded / event.total) * 100);
            // Chặn ở 99% khi vẫn đang tải: 100% mà màn hình còn chờ thì nhân sự
            // tưởng xong rồi và đóng Mini App giữa lúc server chưa ghi xong.
            onProgress?.(Math.min(99, raw));
        };
        request.upload.onload = () => onProgress?.(100);

        request.onload = () => {
            let body = null;
            try {
                body = JSON.parse(request.responseText);
            } catch (_) {
                reject(new Error('Máy chủ trả về dữ liệu không đọc được.'));
                return;
            }
            if (request.status >= 200 && request.status < 300 && body?.success) {
                resolve(body);
                return;
            }
            reject(new Error(body?.message || `Lỗi tải lên (${request.status}).`));
        };

        request.onerror = () => reject(new Error('Lỗi kết nối máy chủ.'));
        request.ontimeout = () => reject(new Error(
            'Tải ảnh quá 60 giây nhưng máy chủ chưa phản hồi. Vui lòng kiểm tra mạng và thử lại; '
            + 'không bấm gửi liên tục để tránh nhập kho trùng.'
        ));

        request.send(formData);
    });
}

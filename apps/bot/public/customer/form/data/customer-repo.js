/**
 * Gửi hồ sơ khách hàng lên máy chủ.
 *
 * Dùng XMLHttpRequest chứ không dùng fetch vì cần tiến độ tải lên: hồ sơ có thể
 * kèm tới 20 ảnh/video, qua 3G mất khá lâu. Không có thanh tiến độ thì nhân viên
 * tưởng treo và bấm gửi lại -> tạo hồ sơ trùng.
 *
 * Xác thực giống các Mini App khác của bot: chữ ký `chat_id` + `ts` + `sig` trong
 * form, và `initData` qua header `x-telegram-init-data`.
 */

import { getInitData, getLaunchParams } from '../../../shared-ui/core/telegram.js';

export const SAVE_ENDPOINT = '/api/customer/save';
export const MAX_MEDIA_FILES = 20;

/** Chữ ký do bot phát hành khi mở Mini App; hỗ trợ cả 4 dạng đường vào. */
export function getAuthParams() {
    const { chatId, ts, sig } = getLaunchParams({ defaultAction: 'customer' });
    return { chatId, ts, sig };
}

export function getTelegramUserId() {
    return globalThis.Telegram?.WebApp?.initDataUnsafe?.user?.id || '';
}

/**
 * @param {object} params
 * @param {object} params.fields các trường của biểu mẫu (đã chuẩn hoá số tiền)
 * @param {File[]} params.files ảnh/video khi chọn chế độ tải trong Mini App
 * @param {string} params.mediaMode
 * @param {(percent:number) => void} [params.onProgress]
 * @returns {Promise<{media_mode:string, message:string}>}
 */
export function saveCustomerRecord({ fields, files, mediaMode, onProgress }) {
    const { chatId, ts, sig } = getAuthParams();

    const formData = new FormData();
    formData.append('telegram_id', getTelegramUserId());
    formData.append('chat_id', chatId);
    formData.append('ts', ts);
    formData.append('sig', sig);
    formData.append('media_mode', mediaMode);

    for (const [name, value] of Object.entries(fields)) {
        formData.append(name, value);
    }
    for (const file of files) {
        formData.append('media_files', file);
    }

    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('POST', SAVE_ENDPOINT, true);

        const initData = getInitData();
        if (initData) request.setRequestHeader('x-telegram-init-data', initData);

        request.upload.onprogress = event => {
            if (!event.lengthComputable) return;
            onProgress?.(Math.round((event.loaded / event.total) * 100));
        };

        request.onload = () => {
            let body = null;
            try {
                body = JSON.parse(request.responseText);
            } catch (_) {
                reject(new Error('Lỗi phản hồi từ máy chủ!'));
                return;
            }
            if (request.status >= 200 && request.status < 300 && body?.success) {
                resolve(body);
                return;
            }
            reject(new Error(body?.message || `Lỗi tải lên (${request.status})`));
        };

        request.onerror = () => reject(new Error('Lỗi kết nối máy chủ!'));
        request.send(formData);
    });
}

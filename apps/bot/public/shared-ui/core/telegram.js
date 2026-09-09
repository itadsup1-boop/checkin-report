/**
 * Bọc Telegram WebApp SDK để phần UI không phụ thuộc trực tiếp vào window.Telegram.
 * Mọi hàm đều an toàn khi mở ngoài Telegram (trả về no-op) để còn debug được trên desktop.
 */

const webApp = globalThis.Telegram?.WebApp || null;

export function initTelegram() {
    webApp?.ready();
    webApp?.expand();
    return webApp;
}

export function getInitData() {
    return webApp?.initData || '';
}

/**
 * Tham số ký do bot phát hành khi mở Mini App.
 *
 * Có ba đường vào và cả ba đều phải hoạt động:
 *
 * 1. Nút trong nhóm dùng deep link `t.me/<bot>/<app>?startapp=<action>_<gid>_<ts>_<sig>`.
 *    Telegram đưa chuỗi này vào `initDataUnsafe.start_param`.
 * 2. router.html nhận start_param rồi chuyển hướng sang
 *    `warehouse_export.html?payload=<action>_<gid>_<ts>_<sig>`.
 * 3. Lệnh `/start whexport_...` mở trực tiếp với `?chat_id=&ts=&sig=&action=`.
 *
 * Dạng gộp có thứ tự: [action, chatId, ts, sig].
 *
 * `defaultAction` chỉ dùng khi KHÔNG có action nào trong URL — mỗi Mini App truyền
 * action của mình ('whexport' / 'whimport' / 'whinventory') để không mượn nhầm
 * action của chức năng khác khi bị mở thiếu tham số.
 */
export function getLaunchParams({ defaultAction = 'whexport' } = {}) {
    const params = new URLSearchParams(location.search);

    const packed =
        webApp?.initDataUnsafe?.start_param ||
        params.get('payload') ||
        params.get('startapp') ||
        params.get('tgWebAppStartParam') ||
        '';

    if (packed) {
        const parts = String(packed).split('_');
        if (parts.length >= 4) {
            return {
                chatId: parts[1],
                ts: parts[2],
                sig: parts[3],
                action: parts[0] || defaultAction
            };
        }
    }

    return {
        chatId: params.get('chat_id') || '',
        ts: params.get('ts') || '',
        sig: params.get('sig') || '',
        action: params.get('action') || defaultAction
    };
}

export function alertUser(message) {
    if (webApp?.showAlert) {
        webApp.showAlert(message);
        return;
    }
    globalThis.alert?.(message);
}

/**
 * Popup xác nhận Có/Không hiện GIỮA màn hình.
 *
 * Dùng showConfirm gốc của Telegram — đây chính là popup hệ thống, không phải
 * hộp thoại web tự vẽ, nên luôn nổi lên trên mọi nội dung và theo đúng giao diện
 * sáng/tối của Telegram. Chỉ khi mở ngoài Telegram (debug trên desktop) mới lùi
 * về window.confirm.
 *
 * Telegram giới hạn message tối đa 256 ký tự — gọi chỗ dùng phải tự cắt ngắn nếu
 * liệt kê nhiều dòng.
 *
 * @returns {Promise<boolean>} true nếu người dùng bấm Có/OK
 */
export function confirmUser(message) {
    if (webApp?.showConfirm) {
        return new Promise(resolve => webApp.showConfirm(message, resolve));
    }
    return Promise.resolve(globalThis.confirm?.(message) ?? false);
}

export function notifySuccess() {
    webApp?.HapticFeedback?.notificationOccurred?.('success');
}

export function notifyError() {
    webApp?.HapticFeedback?.notificationOccurred?.('error');
}

export function tapFeedback() {
    webApp?.HapticFeedback?.impactOccurred?.('light');
}

export function closeApp(delayMs = 0) {
    if (!webApp?.close) return;
    if (delayMs > 0) {
        setTimeout(() => webApp.close(), delayMs);
        return;
    }
    webApp.close();
}

export function isInsideTelegram() {
    return Boolean(webApp && webApp.initData);
}

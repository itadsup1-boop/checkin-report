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
 */
export function getLaunchParams() {
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
                action: parts[0] || 'whexport'
            };
        }
    }

    return {
        chatId: params.get('chat_id') || '',
        ts: params.get('ts') || '',
        sig: params.get('sig') || '',
        action: params.get('action') || 'whexport'
    };
}

export function alertUser(message) {
    if (webApp?.showAlert) {
        webApp.showAlert(message);
        return;
    }
    globalThis.alert?.(message);
}

export function confirmUser(message) {
    return globalThis.confirm?.(message) ?? false;
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

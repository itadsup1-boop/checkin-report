/**
 * HTTP client cho Mini App kho.
 *
 * Mọi request BẮT BUỘC mang đủ chữ ký do bot phát hành (chat_id + ts + sig + action)
 * và initData của Telegram, vì middleware authenticateTelegramMiniApp ở server
 * xác thực dựa trên cả hai. Không được bỏ bớt tham số nào.
 */

import { getInitData, getLaunchParams } from './telegram.js';

/**
 * Action mặc định của Mini App đang chạy, dùng khi URL không mang action nào.
 * Mỗi app gọi configureWarehouseApi() một lần trong app.js để mọi request trong
 * app đó dùng cùng một action — nếu để mỗi nơi tự đặt mặc định thì query string
 * và FormData có thể mang hai action khác nhau.
 */
let defaultAction = 'whexport';

export function configureWarehouseApi({ action } = {}) {
    if (action) defaultAction = action;
}

export function launchParams() {
    return getLaunchParams({ defaultAction });
}

export class ApiError extends Error {
    constructor(message, { code, details, status } = {}) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.details = details;
        this.status = status;
    }
}

/** Chuỗi query xác thực dùng chung cho mọi endpoint kho. */
export function warehouseAuthQuery() {
    const { chatId, ts, sig, action } = launchParams();
    return new URLSearchParams({
        chat_id: chatId,
        ts,
        sig,
        action,
        initData: getInitData()
    }).toString();
}

/** Các field xác thực cần nhúng vào body của request POST. */
export function warehouseAuthBody() {
    const { chatId, ts, sig, action } = launchParams();
    return { chat_id: chatId, ts, sig, action, initData: getInitData() };
}

async function request(path, options = {}) {
    let response;
    try {
        response = await fetch(path, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Init-Data': getInitData(),
                ...(options.headers || {})
            }
        });
    } catch (cause) {
        throw new ApiError('Mất kết nối mạng. Hãy kiểm tra Internet rồi thử lại.', { cause });
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
        throw new ApiError(data.message || 'Không thể kết nối máy chủ.', {
            code: data.code,
            details: data.details,
            status: response.status
        });
    }
    return data;
}

export function apiGet(path, extraQuery = {}) {
    const query = new URLSearchParams(extraQuery).toString();
    const separator = query ? '&' : '';
    return request(`${path}?${warehouseAuthQuery()}${separator}${query}`);
}

export function apiPost(path, body = {}) {
    return request(path, {
        method: 'POST',
        body: JSON.stringify({ ...warehouseAuthBody(), ...body })
    });
}

/** Khóa chống gửi trùng đơn; server dùng để idempotent hóa thao tác duyệt. */
export function newIdempotencyKey() {
    return (
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
    );
}
